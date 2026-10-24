import {withDigitalEmployeeRunLock} from '../digitalEmployees/runControl.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture} from './customerManualTakeover.fixture.js';
import {createLocalCustomerSimulation, type PreviewAiPorts} from './localPreviewSimulation.js';
import {createLocalPreviewProfileAnalysis,defaultLocalPreviewProfilePorts,type LocalPreviewProfilePorts} from './localPreviewProfileAnalysis.js';
import {classifyContextTags} from '../messenger/contextTags.js';
import {buyerConversationFingerprint} from './businessProfile.js';
const ai:PreviewAiPorts={generate:async()=>{throw Error('unexpected_reply');},translate:async()=>{throw Error('unexpected_translation');},run:async action=>({value:await action(),audit:[]})};
function deferred(){let resolve!:()=>void;return {promise:new Promise<void>(r=>{resolve=r;}),resolve:()=>resolve()};}
async function until(check:()=>boolean){for(let n=0;n<1000&&!check();n++)await setImmediate();assert.ok(check(),'expected async task to start');}
function ports(classify:LocalPreviewProfilePorts['classify']):LocalPreviewProfilePorts{return {...defaultLocalPreviewProfilePorts,enabled:()=>true,classify,run:ai.run,schedule:()=>{}};}
const classify=(turns:Parameters<typeof classifyContextTags>[0])=>classifyContextTags(turns,async()=>JSON.stringify({items:[{tag:'明确交期',messageId:turns.at(-1)!.id,excerpt:'within 30 days'}]}));

test('new buyer silently schedules original classifier; latest human correction and saved draft survive successful analysis',async()=>{
 const f=fixture(),gate=deferred();let calls=0;
 const service=createLocalCustomerSimulation(f.store,ai,ports(async turns=>{calls++;await gate.promise;return classify(turns);}));
 const s=await service.start('tenant','owner','mock-async-profile');
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'async-profile-001',text:'Please quote face cream within 30 days'});
 await until(()=>calls===1);
 const during=(await service.drafts('tenant','owner'))[0].patch;
 assert.equal(during.profileAnalysisStatus,'analyzing');assert.equal(during.profileAnalysisHasResult,false);
 await service.correctTag('tenant','owner','mock-async-profile',['明确交期'],{tag:'明确交期',replacement:'交期人工确认',dimension:'risk',reason:'排期需核实',expectedUpdatedAt:null},[]);
 await service.saveDraft('tenant','owner','mock-async-profile','保存中的人工回复');
 gate.resolve();await service.profile.idle();
 const patch=(await service.drafts('tenant','owner'))[0].patch;
 assert.equal(patch.profileAnalysisStatus,'succeeded');assert.equal(patch.profileAnalysisHasResult,true);
 assert.deepEqual(patch.tags,['交期人工确认']);assert.match(patch.product!,/客户原文.*face cream/);
 assert.ok(patch.bant);assert.equal(patch.pendingDraft,'保存中的人工回复');assert.equal(calls,1);
 await service.drafts('tenant','owner');await service.start('tenant','owner','mock-async-profile');assert.equal(calls,1,'reads never run a paid analysis');
 assert.equal((await service.profile.idle()),undefined);
});

test('new buyer fingerprint discards an old result and processes latest message without parallel classifiers',async()=>{
 const f=fixture(),gate=deferred();let calls=0,active=0,maxActive=0;
 const service=createLocalCustomerSimulation(f.store,ai,ports(async turns=>{calls++;active++;maxActive=Math.max(active,maxActive);if(calls===1)await gate.promise;active--;return classify(turns);}));
 const s=await service.start('tenant','owner','mock-profile-race');
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'profile-race-001',text:'old request within 30 days'});await until(()=>calls===1);
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'profile-race-002',text:'new face cream request within 30 days'});
 gate.resolve();await service.profile.idle();
 const patch=(await service.drafts('tenant','owner'))[0].patch;
 assert.equal(calls,2);assert.equal(maxActive,1);assert.match(patch.product!,/new face cream/);
 assert.equal(patch.profileAnalysisResultFingerprint,buyerConversationFingerprint(patch.timeline!));
 assert.equal(patch.contextTagEvidence?.[0].messageId,patch.timeline!.at(-1)!.id);
});

test('failure keeps last-good fields and corrections, backs off durably, and explicit recovery reruns only admitted pending work',async()=>{
 const f=fixture();let now=Date.now(),calls=0,fail=false;const scheduled:Array<()=>void>=[];
 const profilePorts={...ports(async turns=>{calls++;if(fail)throw Error('controlled_failure');return classify(turns);}),now:()=>now,schedule:(fn:()=>void)=>{scheduled.push(fn);}};
 const service=createLocalCustomerSimulation(f.store,ai,profilePorts),s=await service.start('tenant','owner','mock-retry-profile');
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'retry-profile-001',text:'first cream within 30 days'});await service.profile.idle();
 const prior=(await service.drafts('tenant','owner'))[0].patch;fail=true;
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'retry-profile-002',text:'changed product within 30 days'});await service.profile.idle();
 const failed=(await service.drafts('tenant','owner'))[0].patch;
 assert.equal(failed.profileAnalysisStatus,'failed');assert.equal(failed.profileAnalysisHasResult,true);assert.equal(failed.product,prior.product);assert.deepEqual(failed.bant,prior.bant);
 assert.equal(failed.profileAnalysisResultFingerprint,prior.profileAnalysisResultFingerprint);assert.notEqual(failed.profileAnalysisBuyerFingerprint,failed.profileAnalysisResultFingerprint);
 const persisted=await service.session('tenant','owner',s.sessionId);assert.equal(persisted.profileAnalysis?.retryAt,now+60_000);assert.equal(scheduled.length,1);
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'retry-profile-002',text:'changed product within 30 days'});await service.profile.idle();
 const duplicate=await service.session('tenant','owner',s.sessionId);assert.equal(duplicate.profileAnalysis?.retryAt,persisted.profileAnalysis?.retryAt);assert.equal(duplicate.profileAnalysis?.attempts,1);assert.equal(calls,2,'duplicate webhook must not reset retry budget or call a model');
 const recreated=createLocalCustomerSimulation(f.store,ai,profilePorts);await recreated.drafts('tenant','owner');assert.equal(calls,2);
 await recreated.profile.recover('tenant','owner',[s.sessionId]);await recreated.profile.idle();assert.equal(calls,2,'backoff cannot be bypassed by recovery');
 now+=60_000;fail=false;await recreated.profile.recover('tenant','owner',[s.sessionId]);await recreated.profile.idle();
 const recovered=(await recreated.drafts('tenant','owner'))[0].patch;assert.equal(recovered.profileAnalysisStatus,'succeeded');assert.match(recovered.product!,/changed product/);assert.equal(calls,3);
 await assert.rejects(recreated.profile.recover('tenant','other',[s.sessionId]),/preview_session_not_found/);
});

test('disabled capability records honest status without any classifier or model calls',async()=>{
 const f=fixture();let calls=0;
 const service=createLocalCustomerSimulation(f.store,ai,{...ports(async()=>{calls++;throw Error('unexpected');}),enabled:()=>false});
 const s=await service.start('tenant','owner','mock-disabled-profile');
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'disabled-profile-1',text:'Hello cream buyer'});await service.profile.idle();
 const patch=(await service.drafts('tenant','owner'))[0].patch;
 assert.equal(patch.profileAnalysisStatus,'disabled');assert.equal(patch.profileAnalysisErrorCode,'preview_profile_analysis_disabled');assert.equal(patch.profileAnalysisHasResult,false);assert.equal(calls,0);
 await service.profile.recover('tenant','owner',[s.sessionId]);assert.equal(calls,0);
});

test('enqueue retains wakeup when new pending work arrives while the last task is settling',async()=>{
 const f=fixture();let tick=Date.now(),calls=0,injected=false;
 const seed=createLocalCustomerSimulation(f.store,ai,{...ports(classify),enabled:()=>false}),s=await seed.start('tenant','owner','mock-settle-race');
 await seed.act('tenant','owner',s.sessionId,'inbound',{eventId:'settle-race-001',text:'first within 30 days'});
 const load=()=>seed.session('tenant','owner',s.sessionId);
 const engine=createLocalPreviewProfileAnalysis({read:async()=>{
  const row=await load();
  if(row.profileAnalysis?.status==='succeeded'&&!injected){
   injected=true;const turn={...row.customer!.timeline[0],id:'settle-new',body:'second within 30 days',timestamp:++tick};row.customer!.timeline.push(turn);
   await seed.store.update('sessions',s.sessionId,{customer:row.customer,profileAnalysis:{status:'pending',fingerprint:buyerConversationFingerprint(row.customer!.timeline),updatedAt:new Date(tick).toISOString(),attempts:0,retryAt:0}});
   engine.enqueue('tenant','owner',s.sessionId);return load();
  }
  return row;
 },update:async(id,patch)=>{assert.equal(await seed.store.update('sessions',id,patch),true);}},ports(async turns=>{calls++;return classify(turns);}));
 await engine.inbound(await load());await engine.idle();
 assert.equal(calls,2);assert.match((await seed.drafts('tenant','owner'))[0].patch.product!,/second/);
});

test('failed and discarded calls retain sanitized provider audit without claiming successful classification',async()=>{
 const f=fixture();const gate=deferred();let calls=0;
 const entry={startedAt:new Date().toISOString(),endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions',status:503,requestId:'controlled-request',completionId:null,model:'controlled-model',usage:{total_tokens:12},privatePrompt:'must-not-persist'};
 const controlled={...ports(classify),run:(async(action:()=>Promise<unknown>)=>{
  calls++;if(calls===1){await gate.promise;throw Object.assign(Error('controlled'),{previewAiAudit:[entry,{endpoint:'https://private-secret@evil.invalid',startedAt:entry.startedAt}]});}
  return {value:await action(),audit:[{...entry,status:200,requestId:'successful-request'}]};
 }) as LocalPreviewProfilePorts['run']};
 const service=createLocalCustomerSimulation(f.store,ai,controlled),s=await service.start('tenant','owner','mock-audit-profile');
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'audit-profile-001',text:'first within 30 days'});await until(()=>calls===1);
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'audit-profile-002',text:'second within 30 days'});gate.resolve();await service.profile.idle();
 const saved=await service.session('tenant','owner',s.sessionId);
 assert.equal(saved.profileAnalysis?.status,'succeeded');assert.equal(saved.ai_audit?.length,2);assert.equal(saved.ai_audit?.[0].requestId,'controlled-request');assert.equal(saved.ai_audit?.[0].status,503);
 assert.doesNotMatch(JSON.stringify(saved.ai_audit),/must-not-persist|private-secret|evil/);
 const failing=createLocalCustomerSimulation(f.store,ai,{...ports(classify),run:(async()=>{throw Object.assign(Error('failure'),{previewAiAudit:[{...entry,startedAt:new Date(Date.parse(entry.startedAt)+1000).toISOString()}]});}) as LocalPreviewProfilePorts['run']});
 await failing.act('tenant','owner',s.sessionId,'inbound',{eventId:'audit-profile-003',text:'third within 30 days'});await failing.profile.idle();
 const failed=await failing.session('tenant','owner',s.sessionId);assert.equal(failed.profileAnalysis?.status,'failed');assert.equal(failed.ai_audit?.length,3);assert.equal(failed.profileResult?.fingerprint,saved.profileResult?.fingerprint);
});

test('a delayed reply saving an old session cannot erase analysis audit, repeated request IDs at different times remain distinct',async()=>{
 const f=fixture(),gate=deferred();let replyStarted=false,calls=0;
 const entry=(when:string)=>({startedAt:when,endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions',status:200,requestId:'repeated-provider-id',completionId:null,model:'controlled-model',usage:{total_tokens:10}});
 const controlledAi:PreviewAiPorts={...ai,generate:async()=>{replyStarted=true;await gate.promise;return {status:200,factVersion:'facts',body:{draft:'human-review draft',verification:{status:'verified',issues:[]}}};},run:async action=>({value:await action(),audit:[entry('2026-10-24T01:00:00.000Z')]})};
 const profilePorts={...ports(classify),run:(async(action:()=>Promise<unknown>)=>({value:await action(),audit:[entry(`2026-10-24T02:00:0${calls++}.000Z`)]})) as LocalPreviewProfilePorts['run']};
 const service=createLocalCustomerSimulation(f.store,controlledAi,profilePorts),started=await service.start('tenant','owner','mock-audit-save-race');
 await service.act('tenant','owner',started.sessionId,'inbound',{eventId:'audit-save-race-001',text:'cream within 30 days'});await service.profile.idle();
 const stale=await service.session('tenant','owner',started.sessionId),reply=service.generate(stale,'controlled-reply-123',new AbortController().signal);await until(()=>replyStarted);
 await service.act('tenant','owner',started.sessionId,'inbound',{eventId:'audit-save-race-002',text:'new cream within 30 days'});await service.profile.idle();
 const before=await service.session('tenant','owner',started.sessionId);assert.equal(before.ai_audit?.length,2);
 gate.resolve();await reply;
 const after=await service.session('tenant','owner',started.sessionId);assert.equal(after.ai_audit?.length,3);assert.equal(new Set(after.ai_audit?.map(row=>row.startedAt)).size,3);assert.equal(after.profileResult?.fingerprint,before.profileResult?.fingerprint);assert.equal(after.customer?.timeline.length,2,'old reply save cannot erase newer inbound messages');
});


test('detached background analysis waits for the same preview lock rather than inheriting stale reentrancy',async()=>{
 const f=fixture(),modelGate=deferred(),holdGate=deferred();let modelStarted=false,holding=false;
 const service=createLocalCustomerSimulation(f.store,ai,ports(async turns=>{modelStarted=true;await modelGate.promise;return classify(turns);}));
 const s=await service.start('tenant','owner','mock-profile-lock');
 await service.act('tenant','owner',s.sessionId,'inbound',{eventId:'profile-lock-001',text:'cream within 30 days'});await until(()=>modelStarted);
 const hold=withDigitalEmployeeRunLock('tenant',`preview-${s.sessionId}`,async()=>{holding=true;await holdGate.promise;});await until(()=>holding);
 modelGate.resolve();for(let i=0;i<10;i++)await setImmediate();
 assert.equal((await service.session('tenant','owner',s.sessionId)).profileAnalysis?.status,'analyzing','profile result must wait for the active exclusive writer');
 holdGate.resolve();await hold;await service.profile.idle();assert.equal((await service.session('tenant','owner',s.sessionId)).profileAnalysis?.status,'succeeded');
});
