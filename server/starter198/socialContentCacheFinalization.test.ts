import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { initialSceneCacheInputFingerprint, initialSceneSourceHashes, type InitialSceneQualityReport } from './socialContentInitialSceneCache.js';
import { prepareSocialCacheFinalization, completeSocialCacheFinalization } from './socialContentCacheFinalization.js';
import { socialRequestHash } from './socialContentValidation.js';
import { SOCIAL_SCENE_CACHE_COLLECTION } from './socialContentSceneReworkService.js';
import { admitContentExecutionJob, readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { runWithContentExecutionContext } from '../contentExecution/context.js';

test('cache write failure resumes the same artifact after source workspace cleanup with zero provider calls', async () => {
  const f = await prepared();
  f.tables.workflow_runs!.find(r=>r.id==='run')!.status='running';
  const temp = await mkdtemp(path.join(os.tmpdir(), 'social-finalization-'));
  const scope = { tenantId: 't', taskId: 'content', runId: 'run' };
  const fetchBefore = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw Error('network_forbidden'); };
  try {
    const source = path.join(temp, 'original-scene.mp4');
    await writeFile(source, await readFile(f.local));
    const artifact = f.tables.starter_social_content_artifacts![0]!;
    const content = artifact.content as Record<string, any>;
    const report: InitialSceneQualityReport = { schemaVersion: 'initial-scene-quality.v1',
      visual: {passed:true,failures:[]} as any, scenes: {passed:true,issues:[],checkedScenes:2}, audio:{ok:true,error:null} };
    const asset = { ...f.context.cache.scenes[0]!.result.asset, localPath: source, url: source };
    const input = { ...scope, handoff: f.handoff, plan: f.context.plan, baseline: f.context.baseline,
      execution: content.assetSupplyExecution, assets: [asset], productionSceneIds: f.context.cache.scenes.map(s=>s.productionSceneId),
      manifest: f.context.cache.renderInput.sourceManifest, voicePath: source, bgmUrl: null, report };
    content.technicalQualityReport = report;
    content.initialSceneSourceHashes = await initialSceneSourceHashes(input);
    content.initialSceneCacheInput = initialSceneCacheInputFingerprint(input);
    artifact.content_hash = socialRequestHash({resourceRef:artifact.resource_ref,content});
    // The original fixture's manual receipts are replaced by actual automatic
    // G4 observations produced by the cache writer in this test.
    f.tables.starter_social_production_receipts = [];
    const job = await admitContentExecutionJob({dataStore:f.store,...scope,userId:'owner',taskType:'social_content_weekly'});
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,action:()=>prepareSocialCacheFinalization(input)});
    const createBefore = f.store.create.bind(f.store);
    let failOnce = true;
    f.store.create = async (collection, value) => {
      if (collection===SOCIAL_SCENE_CACHE_COLLECTION && failOnce) { failOnce=false; throw Error('injected_cache_write_failure'); }
      return createBefore(collection,value);
    };
    const persisted = await readContentExecutionJob(f.store,'t','content','run');
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,checkpoints:persisted!.checkpoints,action:async()=>{
      await assert.rejects(completeSocialCacheFinalization({...scope,repository:f.repository,artifactId:'artifact'}),/injected_cache_write_failure/);
    }});
    await rm(temp,{recursive:true,force:true});
    // A fresh context simulates a worker restart; only sealed source bytes are available.
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,checkpoints:persisted!.checkpoints,action:async()=>{
      await completeSocialCacheFinalization({...scope,repository:f.repository,artifactId:'artifact'});
      await completeSocialCacheFinalization({...scope,repository:f.repository,artifactId:'artifact'});
    }});
    assert.equal(f.tables[SOCIAL_SCENE_CACHE_COLLECTION]?.length,1);
    assert.equal(f.tables.starter_social_content_artifacts?.length,1);
    assert.equal(f.tables.content_execution_jobs?.length,1);
    assert.equal(providerCalls,0);
  } finally {
    globalThis.fetch=fetchBefore;
    await rm(temp,{recursive:true,force:true});
    await rm(path.resolve('data/social-content-cache-finalization',socialRequestHash(scope)),{recursive:true,force:true});
    await rm(path.resolve('data/social-content-scene-cache',socialRequestHash(['t','content','run','artifact'])),{recursive:true,force:true});
    await f.cleanup();
  }
});

test('an older artifact without cache or a recovery snapshot stays blocked',async()=>{
  const f=await prepared();
  f.tables.workflow_runs!.find(r=>r.id==='run')!.status='running';
  try {
    const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'t',taskId:'content',runId:'run',userId:'owner',taskType:'social_content_weekly'});
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,action:async()=>{
      await assert.rejects(completeSocialCacheFinalization({repository:f.repository,tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact'}),/user_input_required:weekly_scene_cache_recovery_snapshot_missing/);
    }});
    assert.equal(f.tables[SOCIAL_SCENE_CACHE_COLLECTION]?.length??0,0);
  } finally {await f.cleanup();}
});

test('a changed private recovery snapshot is rejected before cache writes',async()=>{
  const f=await prepared();
  f.tables.workflow_runs!.find(r=>r.id==='run')!.status='running';
  const scope={tenantId:'t',taskId:'content',runId:'run'};
  try {
    const job=await admitContentExecutionJob({dataStore:f.store,...scope,userId:'owner',taskType:'social_content_weekly'});
    const input={...scope,voicePath:f.local,bgmUrl:null,assets:[],execution:{shots:[]}} as any;
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,action:()=>prepareSocialCacheFinalization(input)});
    const saved=await readContentExecutionJob(f.store,'t','content','run');
    const ref=saved!.checkpoints['social.scene_cache_recovery']!.payload as {path:string};
    const snapshotBytes=await readFile(ref.path);
    const snapshot=JSON.parse(snapshotBytes.toString()) as {files:Array<{path:string}>};
    const mediaPath=snapshot.files[0]!.path,originalMedia=await readFile(mediaPath);
    await writeFile(mediaPath,'wrong-source-bytes');
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,checkpoints:saved!.checkpoints,action:async()=>{
      await assert.rejects(completeSocialCacheFinalization({...scope,repository:f.repository,artifactId:'artifact'}),/scene_cache_recovery_bytes_changed/);
    }});
    await writeFile(mediaPath,originalMedia);
    await writeFile(ref.path,'tampered');
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,checkpoints:saved!.checkpoints,action:async()=>{
      await assert.rejects(completeSocialCacheFinalization({...scope,repository:f.repository,artifactId:'artifact'}),/scene_cache_recovery_snapshot_changed/);
    }});
    await rm(ref.path);
    await runWithContentExecutionContext({dataStore:f.store,jobId:job.id,checkpoints:saved!.checkpoints,action:async()=>{
      await assert.rejects(completeSocialCacheFinalization({...scope,repository:f.repository,artifactId:'artifact'}),/user_input_required:weekly_scene_cache_recovery_media_missing/);
    }});
    assert.equal(f.tables[SOCIAL_SCENE_CACHE_COLLECTION]?.length??0,0);
  } finally {
    await rm(path.resolve('data/social-content-cache-finalization',socialRequestHash(scope)),{recursive:true,force:true});
    await f.cleanup();
  }
});
