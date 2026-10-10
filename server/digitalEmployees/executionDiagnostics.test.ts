import assert from 'node:assert/strict';
import { analysisWait, collectionWait, postFullyPublished, publishingPlatformsCovered, publishingWait, followupComplete, followupOutcome, followupWait, waitState, basicTaskWait } from './executionDiagnostics.js';
import { taskNeedsAttention } from '../../src/lib/taskExecutionState.js';
const now = Date.parse('2026-09-06T10:00:00Z');
assert.equal(collectionWait([{status:'queued',createdAt:new Date(now-60_000).toISOString()}],now).requiresAttention,false);
assert.equal(collectionWait([{status:'queued',createdAt:new Date(now-360_000).toISOString()}],now).kind,'service');
assert.equal(collectionWait([{status:'running',leasedUntil:new Date(now-1).toISOString()}],now).kind,'service');
assert.equal(collectionWait([{status:'failed'}],now).kind,'service');
assert.equal(collectionWait([{status:'done'}],now).kind,'input');
const delivered = {status:'published',platformPostId:'receipt-1'};
const partial = {stats:{status:'partial',targetAccountIds:['a','b'],publishResults:{a:delivered,b:{status:'failed'}}}};
assert.equal(postFullyPublished(partial),false);
assert.equal(postFullyPublished({stats:{status:'published'}}),false,'a status alone is not a receipt');
assert.equal(postFullyPublished({stats:{targetAccountIds:['a','b'],publishResults:{a:delivered}}}),false);
assert.equal(postFullyPublished({stats:{targetAccountIds:['a','b'],publishResults:{a:delivered,b:delivered}}}),true);
assert.equal(postFullyPublished({platform_post_id:'real',stats:{status:'published'}}),true);
assert.equal(publishingWait([partial],true,now).requiresAttention,true);
assert.equal(publishingWait([{published_at:new Date(now+60_000).toISOString(),stats:{status:'scheduled'}}],true,now).kind,'scheduled');
assert.equal(publishingWait([{stats:{status:'scheduled'}}],false,now).kind,'service');
assert.equal(publishingWait([{stats:{status:'awaiting_manual_publish'}}],true,now).kind,'manual');
assert.equal(followupComplete([]),false);
assert.equal(followupComplete([{status:'sent',provider_message_id:'id'},{status:'approved'}]),false);
assert.equal(followupComplete([{status:'partial_sent',provider_message_id:'id'}]),false);
assert.equal(followupComplete([{status:'sent'}]),false);
assert.equal(followupComplete([{status:'sent',provider_message_id:'id'},{status:'read',provider_message_id:'id2'}]),true);
for (const kind of ['queued','processing','scheduled','data'] as const) {
 assert.equal(taskNeedsAttention({status:'waiting_external',blocked_reason:'explanation',output:{waitState:waitState(kind,'explanation')}}),false);
}
for (const kind of ['input','service','manual'] as const) assert.equal(taskNeedsAttention({status:'waiting_external',output:{waitState:waitState(kind,'reason')}}),true);
assert.equal(taskNeedsAttention({status:'succeeded',blocked_reason:'old error'}),false);
assert.equal(taskNeedsAttention({status:'waiting_approval',blocked_reason:'approval'}),false);
assert.equal(taskNeedsAttention({status:'failed'}),true);
assert.equal(basicTaskWait('customer_attribution','').kind,'data');
console.log('Execution diagnostics: queue, timeout, receipts, partial completion and attention tests passed');

// Frozen, explicit production choices must survive missing reference evidence.
const { buildContentBatchPlan } = await import('./contentBatchPlan.js');
const { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } = await import('./domain.js');
const { normalizeVideoPlan } = await import('../../src/lib/videoCreationPlan.js');
const config = normalizeDigitalEmployeeConfig({enabledWorkflows:['viral_clone','product_content'],focusProducts:'Press'});
const product = normalizeVideoPlan({route:'product',productName:'Press',theme:'Product introduction',platform:'youtube',language:'en'});
const clone = normalizeVideoPlan({...product,route:'clone',referenceId:'reference-missing',materialIds:['material-1']});
const input = {goalId:'test',config,goal:normalizeWeeklyGoal({videoPlans:[clone],contentPlatforms:['youtube']},config),evidence:{products:[{id:'p',name:'Press',materialIds:['material-1']}],exactAnalysisIds:[],materialIds:['material-1']},versions:{configVersion:1,policyVersion:'1',factsVersion:'1'}};
assert.equal(buildContentBatchPlan(input).status,'blocked','all-clone requests cannot silently fall back');
const mixed=buildContentBatchPlan({...input,goal:{...input.goal,videoPlans:[clone,product]}});
assert.equal(mixed.status,'planned');
assert.deepEqual(mixed.orders.map(order=>order.route),['clone','product']);
assert.equal(mixed.orders[0].videoPlan?.referenceId,'reference-missing');
assert.match(mixed.disabledRoutes[0].reason,/精确分析/);
console.log('Explicit clone-only and mixed production route tests passed');

assert.equal(analysisWait([{aiAnalysis:{downloadStatus:'downloading'}}]).kind,'processing');
assert.equal(analysisWait([{aiAnalysis:{crawlerOpsStatus:'failed',analysisError:'timeout'}}]).kind,'service');
assert.equal(analysisWait([{aiAnalysis:{analysisQuality:'metadata'}}]).kind,'input');

// Creating content must not depend on publishing credentials. Missing targets
// are still represented as unbound, never as an invented publication account.
const publishConfig=normalizeDigitalEmployeeConfig({...config,enabledWorkflows:['product_content','content_publish'],publishingTargets:[]});
const noAccount=buildContentBatchPlan({...input,config:publishConfig,goal:{...input.goal,videoPlans:[product]}});
assert.equal(noAccount.status,'planned');
assert.equal(noAccount.orders[0].accountId,'');
const automatic=buildContentBatchPlan({...input,config:publishConfig,goal:{...input.goal,videoPlans:undefined}});
assert.equal(automatic.status,'planned');
assert.ok(automatic.orders.every(order=>order.accountId===''));
console.log('Content production without publishing credentials passed');

assert.equal(publishingPlatformsCovered(['youtube','tiktok'],[{platform:'youtube',accountIds:['a']}]),false);
assert.equal(publishingPlatformsCovered(['youtube'],[{platform:'youtube',accountIds:[]}]),false);
assert.equal(publishingPlatformsCovered(['youtube'],[{platform:'youtube',accountIds:['a']}]),true);

assert.equal(followupOutcome([{status:'sent',provider_message_id:'id'},{status:'blocked'}]).complete,false);
assert.equal(followupOutcome([{status:'sent',provider_message_id:'id'},{status:'blocked'}]).settled,true);
assert.equal(followupWait([{status:'blocked',exclusion_reason:'send_outcome_unknown'}]).kind,'manual');
assert.equal(followupOutcome([{status:'blocked'}]).complete,false);
