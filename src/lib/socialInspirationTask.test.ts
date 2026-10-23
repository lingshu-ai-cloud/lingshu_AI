import assert from 'node:assert/strict';
import { cachedProductInspirationCandidate, inspirationTaskInput, inspirationTaskSource, resumeOrCreateInspirationTask, type InspirationTaskPort } from './socialInspirationTask';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';

const candidate = { id: 'candidate-1', title: '参考演示', sourceUrl: 'https://example.com/video/1', sourceVersion: 'v1' };
assert.equal(inspirationTaskInput(candidate).creationMode, 'viral_replication');
assert.equal(inspirationTaskInput(candidate).programRef, undefined, 'a project is not required');
assert.equal(inspirationTaskInput({ ...candidate, context: { audience: '已验证受众' } }).audience, '已验证受众');
assert.equal(inspirationTaskSource(candidate).sourceVersion, 'v1');
assert.equal(inspirationTaskSource({ ...candidate, sourceUrl: 'local://trend_videos_sample' }).sourceRef, 'local://trend_videos_sample');
assert.throws(() => inspirationTaskSource({ ...candidate, sourceUrl: 'javascript:alert(1)' }));
const keys: string[] = [];
let starts = 0;
let adds = 0;
let task = { taskId: 'task-1', version: '1', status: 'draft', sources: [] } as unknown as SocialContentTaskDetail;
const port: InspirationTaskPort = {
  createTask: async (_input, key) => { keys.push(key!); return task; },
  getTask: async () => task,
  addSource: async (_id, source) => {
    adds++;
    task = { ...task, sources: [{ ...source, sourceVersion: source.sourceVersion || null, sourceId: 'source-1', taskId: task.taskId, status: 'active', purpose: source.purpose || null, createdAt: '' }] };
    return { source: task.sources[0], task };
  },
  startTask: async () => { starts++; task = { ...task, status: 'producing' }; return task; },
};
assert.equal((await resumeOrCreateInspirationTask(candidate, undefined, port)).task.status, 'producing');
assert.equal((await resumeOrCreateInspirationTask(candidate, undefined, port)).task.taskId, 'task-1');
assert.equal(keys[0], keys[1], 'repeated candidate uses persistent server idempotency');
assert.equal(adds, 1, 'resume does not duplicate reference');
assert.equal(starts, 1, 'resume does not restart active production');
task = { ...task, status: 'needs_input' };
const failed = await resumeOrCreateInspirationTask(candidate, undefined, { ...port, startTask: async () => { throw new Error('事实待补充'); } });
assert.equal(failed.task.taskId, 'task-1');
assert.equal(failed.warning, '事实待补充', 'blocked start preserves original task and actionable reason');
console.log('social inspiration direct replication tests passed');
const { soleInspirationCreationAccount } = await import('./socialInspirationTask');
const owned = { programId: 'p1', accountId: 'a1', status: 'active', connectionId: 'connected' } as any;
assert.equal(soleInspirationCreationAccount([owned], 'p1'), 'a1');
assert.equal(soleInspirationCreationAccount([owned, { ...owned, accountId: 'a2' }], 'p1'), '', 'multiple accounts are never arbitrarily routed');
assert.equal(soleInspirationCreationAccount([owned], 'other'), '', 'another operating context cannot supply the target');
assert.equal(soleInspirationCreationAccount([{ ...owned, connectionId: null }], 'p1'), '', 'unconnected account cannot become the default');

const { parseCreateSocialTask } = await import('../../server/starter198/socialContentValidation');
const longCandidate = { ...candidate, title: '长标题'.repeat(100), context: {
  programRef: { objectType: 'social_program', id: 'program-1', version: '2' },
  targetAccountRef: { objectType: 'social_owned_account', id: 'account-1', version: '3' },
  accountPlaybookRef: { objectType: 'account_playbook' as const, id: 'playbook-1', version: '4', accountRef: 'account-1' },
} };
const parsed = parseCreateSocialTask(inspirationTaskInput(longCandidate));
assert.equal(parsed.referenceMode, 'single_source_fidelity');
assert.deepEqual(parsed.programRef, longCandidate.context.programRef);
assert.deepEqual(parsed.targetAccountRef, longCandidate.context.targetAccountRef);
assert.equal(parsed.title.length, 120);
assert.throws(() => parseCreateSocialTask({ ...inspirationTaskInput(candidate), referenceMode: 'unknown' }));
assert.throws(() => parseCreateSocialTask({ ...inspirationTaskInput(candidate), programRef: { objectType: 'social_program', id: 'p' } }));

const { parseSocialSource } = await import('../../server/starter198/socialContentValidation');
assert.equal(parseSocialSource(inspirationTaskSource(longCandidate)).label.length, 160);

const cachedCandidate = {...candidate,cachedReference:{recordId:'actual-cache-record',status:'ready' as const},context:{themeId:'product_value' as const}};
assert.equal(inspirationTaskSource(candidate).cachedReferenceRecordId,undefined,'arbitrary candidate IDs are never cache authority');
assert.equal(inspirationTaskSource(cachedCandidate).cachedReferenceRecordId,'actual-cache-record');
assert.equal(parseSocialSource(inspirationTaskSource(cachedCandidate)).cachedReferenceRecordId,'actual-cache-record');
assert.equal(inspirationTaskInput(cachedCandidate).themeId,'product_value','only explicit preset is transported');
assert.throws(()=>inspirationTaskSource({...cachedCandidate,cachedReference:{recordId:'',status:'ready'}}),/不会自动重新采集/);
let cachedAdds=0,cachedStarts=0;
let cacheTask={taskId:'cache-task',version:'1',status:'draft',sources:[],theme:null} as unknown as SocialContentTaskDetail;
const cachePort: InspirationTaskPort={createTask:async input=>{assert.equal(input.themeId,'product_value');return cacheTask;},getTask:async()=>cacheTask,addSource:async(_id,source)=>{cachedAdds++;assert.equal(source.cachedReferenceRecordId,'actual-cache-record');return {task:cacheTask,source:{} as never};},startTask:async()=>{cachedStarts++;return cacheTask;}};
const pending=await resumeOrCreateInspirationTask(cachedCandidate,undefined,cachePort);
assert.equal(pending.task.taskId,'cache-task');assert.match(pending.warning??'',/确认制作主题/);assert.equal(cachedAdds,0);assert.equal(cachedStarts,0);
cacheTask={...cacheTask,theme:{themeId:'product_value',inputKind:'preset',topic:'',classificationStatus:'confirmed'}};
await resumeOrCreateInspirationTask(cachedCandidate,undefined,cachePort);
assert.equal(cachedAdds,1);assert.equal(cachedStarts,1);

const readyVideo={id:'display-only-id',recordId:'server-record',title:'已有38秒参考',sourceUrl:'https://example.com/38',duration:38,status:'analyzed',canManage:true,aiAnalysis:{analysisMode:'exact',analysisQuality:'video',analysisRunId:'server-run',contentSha256:'a'.repeat(64)}} as import('./inspirationTypes').TrendVideo;
const normalCandidate=cachedProductInspirationCandidate(readyVideo);
assert.equal(normalCandidate.id,'server-record');assert.equal(inspirationTaskInput(normalCandidate).themeId,'product_value');
assert.equal(inspirationTaskSource(normalCandidate).cachedReferenceRecordId,'server-record');
for(const bad of [{...readyVideo,canManage:false},{...readyVideo,recordId:undefined},{...readyVideo,status:'pending'},
 {...readyVideo,aiAnalysis:{...readyVideo.aiAnalysis,analysisMode:'strategy'}},
 {...readyVideo,aiAnalysis:{...readyVideo.aiAnalysis,analysisQuality:'metadata'}},
 {...readyVideo,aiAnalysis:{...readyVideo.aiAnalysis,analysisRunId:''}},
 {...readyVideo,aiAnalysis:{...readyVideo.aiAnalysis,contentSha256:''}}])
 assert.throws(()=>cachedProductInspirationCandidate(bad as import('./inspirationTypes').TrendVideo),/不会自动重新采集/);
const sourceText=(await import('node:fs')).readFileSync(new URL('../components/inspiration/useInspirationCreation.ts',import.meta.url),'utf8');
assert.match(sourceText,/resumeOrCreateInspirationTask\(cachedProductInspirationCandidate\(video,/,'normal page action uses the tested cache adapter');
