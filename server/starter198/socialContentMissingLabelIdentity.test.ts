import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import {socialRequestHash} from './socialContentValidation.js';
import {verifiedMissingLabelIdentity} from './socialContentMissingLabelIdentity.js';

function fixture() {
  const exact = {analysisRunId:'run-analysis', contentSha256:'a'.repeat(64), analysisMode:'exact'};
  const record = {id:'video', tenantId:'tenant', sourceUrl:'https://example.com/video', aiAnalysis: JSON.stringify(exact)};
  const source = {sourceId:'source', sourceRef:record.sourceUrl};
  const version = socialRequestHash({recordId:record.id, analysis:record.aiAnalysis, shotReview:undefined, verifiedSpeech:undefined}).slice(0,12);
  const analysisId = `reference-analysis-${socialRequestHash({sourceId:source.sourceId,sourceRef:source.sourceRef,recordId:record.id,analysis:record.aiAnalysis,shotReview:undefined,verifiedSpeech:undefined}).slice(0,20)}`;
  const detail = {brief:{referenceReuse:{recordId:record.id,contentSha256:exact.contentSha256,analysisId:exact.analysisRunId}},
    sources:[source], referenceVideoAnalysis:{analysisId,version,referenceSourceId:source.sourceId,referenceRecordId:record.id,shots:[{shotId:'ref'}]},
    replicationScript:{referenceAnalysisId:analysisId,shots:[{shotId:'slot',referenceShotId:'ref'}]},
    agentWorkflow:{directorBrief:{scenes:[{sceneId:'slot',referenceShotId:'ref'}]}}} as unknown as SocialContentTaskDetail;
  return {detail,record,tenantId:'tenant',slotIds:['slot'],readRecord:async()=>record};
}

test('binds unresolved slot to exact persisted analysis and reference shot', async () => {
  const f = fixture();
  assert.deepEqual(await verifiedMissingLabelIdentity(f), {recordId:'video',sourceContentSha256:'a'.repeat(64),
    analysisRunId:'run-analysis',referenceAnalysisId:f.detail.referenceVideoAnalysis!.analysisId,
    referenceAnalysisVersion:f.detail.referenceVideoAnalysis!.version,slots:[{shotId:'slot',referenceShotId:'ref',observationHash:socialRequestHash({startSeconds:undefined,endSeconds:undefined,visualDescription:undefined})}]});
});

test('changed media, analysis, tenant or either slot mapping never produce trusted identity', async () => {
  for (const mutate of [
    (f:ReturnType<typeof fixture>) => {f.record.tenantId='other';},
    (f:ReturnType<typeof fixture>) => {f.record.aiAnalysis=JSON.stringify({analysisRunId:'run-analysis',contentSha256:'b'.repeat(64)});},
    (f:ReturnType<typeof fixture>) => {f.record.aiAnalysis=JSON.stringify({analysisRunId:'other',contentSha256:'a'.repeat(64)});},
    (f:ReturnType<typeof fixture>) => {f.detail.replicationScript!.shots[0]!.referenceShotId='other';},
    (f:ReturnType<typeof fixture>) => {f.detail.agentWorkflow!.directorBrief.scenes[0]!.referenceShotId='other';},
    (f:ReturnType<typeof fixture>) => {f.detail.referenceVideoAnalysis!.version='changed';},
    (f:ReturnType<typeof fixture>) => {f.detail.referenceVideoAnalysis!.shots=[];},
  ]) {const f=fixture();mutate(f);assert.equal(await verifiedMissingLabelIdentity(f),null);}
});

test('a consistently repinned approximate analysis cannot become exact repair authority', async () => {
  for (const analysisMode of ['approximate', undefined]) {
    const f=fixture();
    f.record.aiAnalysis=JSON.stringify({analysisRunId:'run-analysis',contentSha256:'a'.repeat(64),analysisMode});
    const version=socialRequestHash({recordId:f.record.id,analysis:f.record.aiAnalysis,shotReview:undefined,verifiedSpeech:undefined}).slice(0,12);
    const analysisId=`reference-analysis-${socialRequestHash({sourceId:'source',sourceRef:f.record.sourceUrl,recordId:f.record.id,analysis:f.record.aiAnalysis,shotReview:undefined,verifiedSpeech:undefined}).slice(0,20)}`;
    f.detail.referenceVideoAnalysis!.version=version;
    f.detail.referenceVideoAnalysis!.analysisId=analysisId;
    f.detail.replicationScript!.referenceAnalysisId=analysisId;
    assert.equal(await verifiedMissingLabelIdentity(f),null);
  }
});
