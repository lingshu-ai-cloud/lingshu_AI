import test from 'node:test';
import assert from 'node:assert/strict';
import type { SocialInspirationCollectionRun } from '../../shared/contracts/socialContentWorkflow.js';
import {planTerminalDiscoverySourceRetry} from './retryPlan.js';

const run={runId:'parent',status:'failed',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{fetched:0,accepted:0}},failureDetails:[{mode:'momentum',platform:'tiktok',queryRef:'query',error:'Apify TikTok HTTP 402 not-enough-usage-to-run-paid-actor'},{mode:'momentum',platform:'instagram',queryRef:'query',error:'Instagram 抓取无可用视频'}]} as unknown as SocialInspirationCollectionRun;
test('only exact rejected sources can be planned; unproven settlement stays excluded and grants nothing',()=>{
 const original=structuredClone(run),plan=planTerminalDiscoverySourceRetry(run);
 assert.deepEqual(plan.eligibleSources,[{mode:'momentum',platform:'tiktok',queryRef:'query'}]);
 assert.equal(plan.unresolvedSources[0]!.platform,'instagram');assert.equal(plan.wholeRunRetryEligible,false);
 assert.equal(plan.authorizesExecution,false);assert.equal(plan.grantsAdditionalDailyQuota,false);
 assert.deepEqual(run,original);
});
test('running/unknown, existing results and mixed timeout failures never become new attempts',()=>{
 assert.deepEqual(planTerminalDiscoverySourceRetry({...run,status:'running'}).eligibleSources,[]);
 assert.deepEqual(planTerminalDiscoverySourceRetry({...run,modeStats:{momentum:{...run.modeStats.momentum!,accepted:1}}}).eligibleSources,[]);
 const timeout={...run,failureDetails:[{...run.failureDetails![0]!,error:'HTTP 402 not-enough-usage-to-run-paid-actor; later socket timeout'}]};
 assert.deepEqual(planTerminalDiscoverySourceRetry(timeout).eligibleSources,[]);
 assert.equal(planTerminalDiscoverySourceRetry({...run,failureDetails:[run.failureDetails![0]!]}).wholeRunRetryEligible,true);
});
