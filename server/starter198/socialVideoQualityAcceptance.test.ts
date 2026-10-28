import test from 'node:test';import assert from 'node:assert/strict';
import {acceptedUnknownVideoQuality,readAcceptedUnknownVideoQuality,socialVideoQualityAcceptanceRecord,VIDEO_QUALITY_ACCEPTANCE_STAGE} from './socialVideoQualityAcceptance.js';
const base={tenantId:'tenant',taskId:'task',runId:'run',jobId:'job',mediaSha256:'a'.repeat(64),qualityInputHash:'b'.repeat(64),acceptedBy:'owner',acceptedAt:'2026-10-28T00:00:00.000Z'};
test('unknown-quality acceptance is bound to the exact job, run, media and quality checkpoint',()=>{
 const receipt=socialVideoQualityAcceptanceRecord(base),job={id:'job',tenantId:'tenant',taskId:'task',runId:'run',checkpoints:{[VIDEO_QUALITY_ACCEPTANCE_STAGE]:{version:'1',inputHash:base.qualityInputHash,payload:receipt,updatedAt:base.acceptedAt}}} as any;
 assert.equal(readAcceptedUnknownVideoQuality(job,base.mediaSha256,base.qualityInputHash)?.recordHash,receipt.recordHash);
 for(const [media,input] of [['c'.repeat(64),base.qualityInputHash],[base.mediaSha256,'d'.repeat(64)]])assert.equal(acceptedUnknownVideoQuality(job,media,input),false);
 job.runId='other';assert.equal(acceptedUnknownVideoQuality(job,base.mediaSha256,base.qualityInputHash),false);job.runId='run';
 receipt.acceptedBy='other';assert.equal(acceptedUnknownVideoQuality(job,base.mediaSha256,base.qualityInputHash),false);
});
