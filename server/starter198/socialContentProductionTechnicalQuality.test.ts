import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMeasuredSocialTechnicalQuality } from './socialContentProductionTechnicalQuality';
import { hasSocialMeasuredMediaHardFailure } from './socialContentGraphQualityGate';

test('technical checkpoint cannot pass a hard media failure which the final graph rejects',()=>{
 for(const finding of [
  {formatPassed:false},
  {captionSpeechAlignment:{status:'mismatch'}},
  {fullFrozenAudioIdentity:{status:'failed'}},
  {scenes:[{durationPassed:false}]},
  {scenes:[{audioWindowDecoded:false}]},
  {scenes:[{audioIdentity:{status:'failed'}}]},
  {scenes:[{sensitiveScreenEvidence:{status:'hit'}}]},
 ]){
  const mediaHardProbe={version:'scene-media-hard-probe.v1',...finding};
  assert.equal(hasSocialMeasuredMediaHardFailure(mediaHardProbe),true);
  const result=applyMeasuredSocialTechnicalQuality({preliminaryApproved:true,technicalFailures:[],mediaHardProbe});
  assert.equal(result.technicalApproved,false);assert.deepEqual(result.technicalFailures,['measured_media_hard_failure']);
 }
});
test('a clean probe cannot erase existing technical failures and unknown remains governed by the existing graph policy',()=>{
 const existing=['audio_decode_failed'];
 const failed=applyMeasuredSocialTechnicalQuality({preliminaryApproved:false,technicalFailures:existing,mediaHardProbe:{version:'scene-media-hard-probe.v1',formatPassed:true}});
 assert.equal(failed.technicalApproved,false);assert.deepEqual(failed.technicalFailures,existing);
 for(const probe of [{version:'scene-media-hard-probe.v1',formatPassed:true},{version:'scene-media-hard-probe.v1',fullFrozenAudioIdentity:{status:'unknown'}}]){
  const result=applyMeasuredSocialTechnicalQuality({preliminaryApproved:true,technicalFailures:[],mediaHardProbe:probe});
  assert.equal(result.technicalApproved,!hasSocialMeasuredMediaHardFailure(probe));
 }
});
