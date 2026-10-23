import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeSourceVideoJob, buildYtDlpArgs, type SourceAnalysisAdapters } from '../routes/videos.js';
import { AnalysisLeaseRegistry } from './analysisLease.js';
import { DownloadBudget } from './downloadExecution.js';
import { store } from '../storage/index.js';
import { createVideoDownloadRuntime } from '../videos/videoDownloadRuntime.js';
import { createVideoDownloadFallbacks } from '../videos/videoDownloadFallbacks.js';
import { runApifyActorDatasetItems } from '../videos/apifyFallbackRuntime.js';
const originalFetch = globalThis.fetch;
let unexpectedNetwork = 0;
globalThis.fetch = (async () => { unexpectedNetwork++; throw Error('isolated source analysis forbids external network'); }) as typeof fetch;
const unexpected = (): never => { throw Error('unexpected download adapter in isolated test'); };
const canUseApifyVideoFallback = () => Boolean(process.env.APIFY_TOKEN);
const fallbacks = createVideoDownloadFallbacks({ canUseApifyVideoFallback, recordApifyVideoFallbackUse: unexpected, runApifyActorDatasetItems });
// Run the real download orchestration and file checks through existing ports;
// the injected executor must never resolve a local tool or contact a live API.
const { downloadVideoForAnalysis } = createVideoDownloadRuntime({
  isWeeklyOriginalAccountCollectionRecord: () => false,
  ytDlpPythonPath: () => '/isolated/python', buildYtDlpArgs, crawlerExecEnv: () => ({}),
  execYtDlpWithCookieFallback: unexpected, apifyTenantIdFromRecord: () => 'isolated',
  canUseApifyVideoFallback, ...fallbacks,
  extractPoster: unexpected, probeDuration: unexpected, persistMaterials: unexpected, loadMaterials: unexpected,
  readTikTokPublicApi: async () => { throw Error('isolated public API unavailable'); },
});
const original = {getById: store.getById, update: store.update};
const ops = process.env.CRAWLER_OPS_WORKER_ENABLED;
const apify=process.env.APIFY_TOKEN;
delete process.env.APIFY_TOKEN;
process.env.CRAWLER_OPS_WORKER_ENABLED = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-analysis-'));
let row!: Record<string, any>;
let failWrite = false;
store.getById = (async () => structuredClone(row)) as typeof store.getById;
store.update = (async (_col: string, _id: string, patch: any) => {
  if (failWrite && JSON.parse(patch.aiAnalysis || '{}').analysisQuality === 'video') return false;
  Object.assign(row, patch); return true;
}) as typeof store.update;
const reset = () => { row = {id:'isolated-analysis-adapter',tenantId:'isolated',title:'fixture',aiAnalysis:JSON.stringify({requestedAnalysisMode:'exact'})}; };
const adapters: SourceAnalysisAdapters = {
  lease: new AnalysisLeaseRegistry(path.join(dir,'locks')),
  download: async () => { const filePath=path.join(dir,'video.mp4'); fs.writeFileSync(filePath,'isolated media fixture'); return {filePath,fileName:'video.mp4',mimeType:'video/mp4',size:22}; },
  compressPreview: async () => { throw Error('isolated preview unavailable'); },
  analyze: async () => ({analysis: {summary:'Injected provider observation',theme:'fixture',firstTenSeconds:{atmosphere:'fixture',audioVisual:'fixture',camera:'fixture'},coarseStructure:[{description:'fixture'}],scriptDetails15s:[{time:'0-10',visual:'fixture'}]} as any,source:'fixture-video'}),
};
const run = () => analyzeSourceVideoJob({record:row,sourceUrl:'https://www.youtube.com/watch?v=fixture01',title:'fixture',platform:'youtube',skipYoutubeUrlAnalysis:true,suppressOpsRequeue:true}, adapters);
try {
  reset(); await run();
  let result = JSON.parse(row.aiAnalysis);
  assert.equal(result.analysisQuality,'video'); assert.equal(result.gemini.summary,'Injected provider observation');
  assert.equal(fs.existsSync(path.join(dir,'video.mp4')),false,'temporary bytes are cleaned after persisted result');
  reset(); const analyze=adapters.analyze;
  adapters.analyze=async () => {throw Error('analysis provider timeout');};
  await assert.rejects(run(),/analysis provider timeout/);
  result=JSON.parse(row.aiAnalysis); assert.notEqual(result.analysisQuality,'video'); assert.equal(result.geminiStatus,'video_failed');
  assert.equal(fs.existsSync(path.join(dir,'video.mp4')),false);
  adapters.analyze=analyze;
  reset(); process.env.CRAWLER_OPS_WORKER_ENABLED='1';
  adapters.analyze=async()=>{throw Error('exact_analysis_retryable: 404 Model not exist.');};
  await assert.rejects(run(),/Model not exist/);
  result=JSON.parse(row.aiAnalysis);assert.equal(result.downloadStatus,'manual_required');assert.equal(result.geminiStatus,'video_failed');assert.equal(result.analysisQueueState,'failed');assert.equal(result.analysisRetryable,false);assert.notEqual(result.downloadStatus,'ops_queued');
  adapters.analyze=analyze;process.env.CRAWLER_OPS_WORKER_ENABLED='0';
  reset(); failWrite=true;
  await assert.rejects(run(),/video_analysis_writeback_failed/);
  assert.notEqual(JSON.parse(row.aiAnalysis).analysisQuality,'video');
  failWrite=false;
  // Exercise the real download adapter and its file validation without network.
  const execute = (async (_cmd:any,args:string[]) => {
    assert.equal(_cmd, '/isolated/python');
    const out=args[args.indexOf('-o')+1].replace('%(ext)s','mp4'); fs.writeFileSync(out,Buffer.alloc(2048)); return {stdout:'',stderr:''};
  }) as any;
  const media=await downloadVideoForAnalysis({sourceUrl:'https://www.tiktok.com/@fixture/video/1234567890123456789',title:'fixture',platform:'tiktok',allowCookieFallback:false},execute);
  assert.equal(media.size,2048); fs.unlinkSync(media.filePath);
  let clock=0, attempts=0;
  const budget=new DownloadBudget(100,()=>clock);
  await assert.rejects(downloadVideoForAnalysis({sourceUrl:'https://www.youtube.com/watch?v=fixture01',title:'fixture',platform:'youtube',allowCookieFallback:false},(async (_cmd:any,_args:any,options:any)=>{
    attempts+=1; assert.equal(options.timeout,100); clock=101; throw Error('network timeout');
  }) as any,budget),/下载累计超时/);
  assert.equal(attempts,1,'an exhausted attempt cannot start another format or cookie channel');
  const fetchOriginal=globalThis.fetch;
  const keys=['APIFY_TOKEN','APIFY_FACEBOOK_VIDEO_FALLBACK_ENABLED','APIFY_TIKTOK_VIDEO_DAILY_LIMIT','APIFY_TIKTOK_VIDEO_TENANT_DAILY_LIMIT'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let actorCalls=0, shellCalls=0;
  try {
    Object.assign(process.env,{APIFY_TOKEN:'isolated-token',APIFY_FACEBOOK_VIDEO_FALLBACK_ENABLED:'1',APIFY_TIKTOK_VIDEO_DAILY_LIMIT:'999999',APIFY_TIKTOK_VIDEO_TENANT_DAILY_LIMIT:'999999'});
    globalThis.fetch=(async()=>{actorCalls+=1;return new Response(JSON.stringify({data:{id:'isolated-run',defaultDatasetId:'isolated-dataset',status:'RUNNING'}}));}) as typeof fetch;
    await assert.rejects(downloadVideoForAnalysis({sourceUrl:'https://www.facebook.com/reel/123456789',title:'fixture',platform:'facebook',allowCookieFallback:false},(async()=>{shellCalls+=1;throw Error('must not start after actor timeout');}) as any,new DownloadBudget(30)),/下载累计超时/);
    assert.ok(actorCalls>=1); assert.equal(shellCalls,0,'Apify consumes the same total deadline before yt-dlp fallback');
  } finally {
    globalThis.fetch=fetchOriginal;
    for(const key of keys) if(saved[key]===undefined) delete process.env[key]; else process.env[key]=saved[key];
  }

  await assert.rejects(downloadVideoForAnalysis({sourceUrl:'https://www.tiktok.com/@fixture/video/1234567890123456789',title:'fixture',platform:'tiktok',allowCookieFallback:false},(async()=>({stdout:'',stderr:''})) as any),/did not produce/);
  assert.equal(unexpectedNetwork,0,'all provider traffic must remain inside explicit fixtures');
} finally {
  globalThis.fetch=originalFetch;
  Object.assign(store,original);
  if(apify===undefined) delete process.env.APIFY_TOKEN; else process.env.APIFY_TOKEN=apify;
  if (ops === undefined) delete process.env.CRAWLER_OPS_WORKER_ENABLED; else process.env.CRAWLER_OPS_WORKER_ENABLED=ops;
  fs.rmSync(dir,{recursive:true,force:true});
}
console.log('Actual candidate download adapter and analysis/writeback orchestration success/failure passed (isolated providers)');
