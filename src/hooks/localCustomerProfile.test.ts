import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingLocalCustomerProfile} from '../../shared/contracts/localCustomerProfile';
import {restoreLocalCustomerPatch} from './localCustomerProfile';
import type {CustomerProfile} from '../types/customer';
const correction={tag:'明确交期',replacement:'交期待确认',dimension:'risk' as const,reason:'仅为期望',updatedAt:'2026-10-24T06:53:55.464Z',evidence:[{messageId:'original',excerpt:'within 30 days'}]};
const timeline=[{id:'new',actor:'buyer',body:'Please quote face cream',type:'messenger',title:'消息',time:'刚刚'}] as CustomerProfile['timeline'];
const seed={id:'mock-example',isMock:true,product:'机器视觉',outboundProduct:'CNC',estimatedValue:'USD 50000',summary:'机器视觉大单',nextStep:'确认视觉方案',intentScore:90,intentSignals:['大单'],tags:['机器视觉','交期待确认','退订'],contextTagCorrections:[correction],timeline:[],orders:[{id:'seed',total:'50000',status:'paid',createdAt:'2026-01-01'}],pendingDraft:'已保存人工草稿',bant:{level:'hot'},progressionGoal:{label:'旧采购进度'},spinGuidance:{statement:'旧建议'},sourcePostTitle:'旧机器视觉素材',simulation:{goal:'旧目标'}} as unknown as CustomerProfile;

test('controlled inbound invalidates seed demand and suggestions while preserving corrections and contact restrictions',()=>{
 const result=pendingLocalCustomerProfile({...seed,timeline});
 assert.match(result.product,/待分析/);assert.equal(result.outboundProduct,'');assert.match(result.summary,/尚未分析/);
 assert.equal(result.bant,undefined);assert.equal(result.progressionGoal,undefined);assert.equal(result.spinGuidance,undefined);assert.equal(result.simulation,undefined);
 assert.deepEqual(result.orders,[]);assert.deepEqual(result.tags,['退订','交期待确认']);assert.deepEqual(result.contextTagCorrections,[correction]);
 assert.equal(result.sourcePostTitle,undefined);assert.equal(result.intentScore,0);
});
test('only matching buyer evidence can retain uncorrected tags; correction evidence snapshot stays separate',()=>{
 const result=pendingLocalCustomerProfile({...seed,timeline,tags:['明确需求','旧视觉'],contextTagEvidence:[{tag:'明确需求',messageId:'new',excerpt:'face cream'},{tag:'旧视觉',messageId:'absent',excerpt:'vision'}]});
 assert.deepEqual(result.tags,['明确需求','交期待确认']);assert.equal(result.contextTagEvidence.length,1);assert.equal(result.contextTagCorrections[0].evidence?.[0].messageId,'original');
});
test('poll restores authoritative inbound profile without overwriting saved local draft or matching translation',()=>{
 const current={...seed,timeline:[{...timeline[0],translatedBody:'请报价面霜'}]};
 const patch={timeline,localSimulation:{sessionId:'session'},pendingDraft:'server older draft'};
 const polled=restoreLocalCustomerPatch(current,patch,true);
 assert.equal(polled.pendingDraft,'已保存人工草稿');assert.equal(polled.timeline[0].translatedBody,'请报价面霜');assert.match(polled.product,/待分析/);assert.equal(polled.bant,undefined);assert.deepEqual(polled.contextTagCorrections,[correction]);
 const refreshed=restoreLocalCustomerPatch(seed,{...patch,pendingDraft:'持久保存的回复'});
 assert.equal(refreshed.pendingDraft,'持久保存的回复');assert.match(refreshed.product,/待分析/);
});
test('tag correction or saved draft alone does not invalidate untouched stage fixtures',()=>{
 const restored=restoreLocalCustomerPatch(seed,{tags:['手工标签']});
 assert.equal(restored.product,'机器视觉');assert.equal(restored.bant,seed.bant);
});

test('in-flight older poll cannot replace a just-saved human correction or revive its old replacement',()=>{
 const newer={...correction,replacement:'销售已确认无需赶工',updatedAt:'2026-10-24T08:00:00.000Z',reason:'最新人工核实'};
 const current={...seed,tags:['退订',newer.replacement],contextTagCorrections:[newer]};
 const restored=restoreLocalCustomerPatch(current,{timeline,localSimulation:{sessionId:'session'},tags:['交期待确认','机器视觉'],contextTagCorrections:[correction]},true);
 assert.deepEqual(restored.tags,['退订',newer.replacement]);assert.deepEqual(restored.contextTagCorrections,[newer]);
 assert.equal(restored.pendingDraft,seed.pendingDraft);
 const latestRemoval={...newer,replacement:null,updatedAt:'2026-10-24T09:00:00.000Z'};
 const removed=restoreLocalCustomerPatch({...current,contextTagCorrections:[latestRemoval],tags:[]},{tags:[newer.replacement],contextTagCorrections:[newer]},true);
 assert.deepEqual(removed.tags,[]);assert.deepEqual(removed.contextTagCorrections,[latestRemoval]);
});
test('newer authoritative correction replaces stale local replacement without duplicate labels',()=>{
 const newer={...correction,replacement:'最新人工标签',updatedAt:'2026-10-24T08:00:00.000Z'};
 const restored=restoreLocalCustomerPatch(seed,{contextTagCorrections:[newer],tags:['交期待确认','最新人工标签']},true);
 assert.deepEqual(restored.tags,['最新人工标签','退订']);assert.deepEqual(restored.contextTagCorrections,[newer]);
});

const analysed = {
  ...seed, product:'75 ml 面霜包装', summary:'客户需要 75 ml 面霜罐', intentScore:68,
  tags:['面霜罐','交期待确认'], timeline,
  profileAnalysisStatus:'succeeded' as const, profileAnalysisHasResult:true,
  profileAnalysisBuyerFingerprint:'buyer-fingerprint-1', profileAnalysisResultFingerprint:'buyer-fingerprint-1',
  profileAnalysisUpdatedAt:'2026-10-24T10:00:00.000Z',
};
test('successful background result survives poll and refresh with new profile values, draft and translations',()=>{
 const current={...seed,timeline:[{...timeline[0],translatedBody:'请报价面霜'}]};
 const patch={...analysed,localSimulation:{sessionId:'same-session'},pendingDraft:'server older draft'};
 const polled=restoreLocalCustomerPatch(current,patch,true);
 assert.equal(polled.profileAnalysisStatus,'succeeded');assert.equal(polled.product,analysed.product);assert.equal(polled.intentScore,68);
 assert.equal(polled.summary,analysed.summary);assert.equal(polled.timeline[0].translatedBody,'请报价面霜');
 assert.equal(polled.pendingDraft,seed.pendingDraft);assert.deepEqual(polled.contextTagCorrections,[correction]);
 const refreshed=restoreLocalCustomerPatch(seed,patch);
 assert.equal(refreshed.product,analysed.product);assert.equal(refreshed.pendingDraft,'server older draft');
});
test('analyzing or failed newer message retains prior valid result and explicit status instead of clearing it',()=>{
 for(const status of ['analyzing','failed'] as const) {
  const next=restoreLocalCustomerPatch(analysed,{
   ...analysed,profileAnalysisStatus:status,profileAnalysisBuyerFingerprint:'buyer-fingerprint-2',
   profileAnalysisUpdatedAt:'2026-10-24T10:05:00.000Z',profileAnalysisErrorCode:status==='failed'?'controlled_classifier_failed':undefined,
   timeline:[...timeline,{...timeline[0],id:'newer-buyer',body:'Now we need 500 pieces'}],localSimulation:{sessionId:'same-session'},
  },true);
  assert.equal(next.product,analysed.product);assert.equal(next.profileAnalysisStatus,status);assert.equal(next.intentScore,68);
  assert.equal(next.profileAnalysisResultFingerprint,'buyer-fingerprint-1');assert.equal(next.profileAnalysisBuyerFingerprint,'buyer-fingerprint-2');
  assert.equal(next.timeline.length,2);assert.deepEqual(next.contextTagCorrections,[correction]);
 }
});
test('first analysis failure or disabled analysis stays unassessed and cannot present zero as an AI result',()=>{
 for(const status of ['analyzing','failed','disabled'] as const) {
  const result=restoreLocalCustomerPatch(seed,{timeline,localSimulation:{sessionId:'session'},profileAnalysisStatus:status,profileAnalysisHasResult:false},true);
  assert.equal(result.profileAnalysisStatus,status);assert.equal(result.profileAnalysisHasResult,false);
  assert.match(result.product,/待分析/);assert.equal(result.bant,undefined);
 }
 const invalid=restoreLocalCustomerPatch(seed,{timeline,localSimulation:{sessionId:'session'},profileAnalysisStatus:'succeeded',profileAnalysisHasResult:true},true);
 assert.equal(invalid.profileAnalysisStatus,'failed');assert.equal(invalid.profileAnalysisErrorCode,'profile_analysis_result_invalid');
});
test('an older poll cannot roll a completed analysis back or overwrite its messages and local composer',()=>{
 const restored=restoreLocalCustomerPatch(analysed,{product:'旧机器视觉',summary:'旧摘要',profileAnalysisStatus:'analyzing',
  profileAnalysisUpdatedAt:'2026-10-24T09:00:00.000Z',profileAnalysisHasResult:false,
  timeline:[],localSimulation:{sessionId:'same-session'},pendingDraft:'旧服务端草稿'},true);
 assert.equal(restored.product,analysed.product);assert.equal(restored.profileAnalysisStatus,'succeeded');
 assert.deepEqual(restored.timeline,analysed.timeline);assert.equal(restored.pendingDraft,seed.pendingDraft);
});

test('success from a different buyer fingerprint remains a last-good result but never claims current success',()=>{
 const result=restoreLocalCustomerPatch(seed,{...analysed,profileAnalysisBuyerFingerprint:'new-buyer',localSimulation:{sessionId:'same-session'}},true);
 assert.equal(result.profileAnalysisStatus,'failed');assert.equal(result.profileAnalysisHasResult,true);
 assert.equal(result.product,analysed.product);assert.equal(result.profileAnalysisErrorCode,'profile_analysis_fingerprint_mismatch');
});
