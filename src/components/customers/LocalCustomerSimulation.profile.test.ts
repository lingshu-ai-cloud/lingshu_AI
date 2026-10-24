import test from 'node:test';
import assert from 'node:assert/strict';
import {localCustomerSimulationPatch} from './LocalCustomerSimulation';
import {createQuoteMockCustomers} from '../../mocks/quoteCustomerProfiles';
const seed=createQuoteMockCustomers()[0]!;
const current={...seed,profileAnalysisStatus:'succeeded' as const,profileAnalysisHasResult:true,profileAnalysisBuyerFingerprint:'old-fingerprint',profileAnalysisResultFingerprint:'old-fingerprint',profileAnalysisUpdatedAt:'2026-10-24T10:00:00.000Z',product:'旧成功需求'};
const newTurn={...seed.timeline[0],id:'new-buyer-turn',actor:'buyer' as const,body:'Can you quote new cream jars?'};
const snapshot={sessionId:'local-session',items:[],batch:null,send:null,pendingDraft:'已保存的人工回复',customer:{timeline:[newTurn]},profile:{profileAnalysisStatus:'pending' as const,profileAnalysisHasResult:true,profileAnalysisBuyerFingerprint:'new-fingerprint',profileAnalysisResultFingerprint:'old-fingerprint',profileAnalysisUpdatedAt:'2026-10-24T10:01:00.000Z',product:'旧成功需求'}};
test('new inbound snapshot immediately applies its versioned profile and timeline without waiting for polling',()=>{
 const next=localCustomerSimulationPatch(current,snapshot);
 assert.equal(next.profileAnalysisStatus,'pending');assert.equal(next.profileAnalysisBuyerFingerprint,'new-fingerprint');
 assert.equal(next.timeline[0].id,'new-buyer-turn');assert.equal(next.pendingDraft,'已保存的人工回复');assert.equal(next.product,'旧成功需求');
});
test('read snapshot immediately applies completed analysis while a later obsolete action response cannot undo it',()=>{
 const pending=localCustomerSimulationPatch(current,snapshot);
 const success=localCustomerSimulationPatch(pending,{...snapshot,profile:{...snapshot.profile,profileAnalysisStatus:'succeeded',profileAnalysisResultFingerprint:'new-fingerprint',profileAnalysisUpdatedAt:'2026-10-24T10:02:00.000Z',product:'面霜罐需求',summary:'客户新增面霜包装要求'}});
 assert.equal(success.profileAnalysisStatus,'succeeded');assert.equal(success.product,'面霜罐需求');
 assert.equal(success.summary,'客户新增面霜包装要求');assert.equal(success.timeline[0].id,'new-buyer-turn');
 const late=localCustomerSimulationPatch(success,snapshot);
 assert.equal(late.product,success.product);assert.equal(late.profileAnalysisStatus,'succeeded');assert.deepEqual(late.timeline,success.timeline);
});
