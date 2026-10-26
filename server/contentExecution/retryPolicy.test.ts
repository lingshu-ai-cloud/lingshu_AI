import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContentExecutionFailure } from './retryPolicy';
test('narration capability gap neither retries paid speech nor invalidates the selected avatar',()=>{
 const result=classifyContentExecutionFailure(new Error('user_input_required:presenter_narration_capability_unavailable:heygen:starfish'),{attempt:1});
 assert.equal(result.disposition,'block');assert.equal(result.failureClass,'input_required');assert.equal(result.retryDelayMs,null);assert.match(result.publicReason,/人物授权仍有效/);assert.match(result.publicReason,/试听确认/);
});

test('native speech pending keeps original supplier task in reconciliation',()=>{const r=classifyContentExecutionFailure(Error('native_speech_track_pending_reconcile:original-task'),{attempt:1});assert.equal(r.failureClass,'provider_reconciliation');assert.equal(r.disposition,'reconcile');});
test('native subtitle proof failures retain the paid media and request correction without automatic regeneration', () => {
  for (const error of ['native_subtitle_transcript_mismatch', 'native_subtitle_range_invalid', 'native_voice_timing_transform_changed']) {
    const decision = classifyContentExecutionFailure(Error(error), { attempt: 1 });
    assert.equal(decision.failureClass, 'input_required'); assert.equal(decision.disposition, 'block');
    assert.equal(decision.retryDelayMs, null); assert.match(decision.publicReason, /原音视频已保留/);
  }
});
test('lost first-frame confirmation requests evidence repair without repeated production attempts or new person authorization', () => {
  const decision = classifyContentExecutionFailure(Error('presenter_first_frame_confirmation_lost_after_budget_reservation:group'), { attempt: 1 });
  assert.equal(decision.disposition, 'block'); assert.equal(decision.failureClass, 'input_required');
  assert.match(decision.publicReason, /原人物授权和已完成音视频保留/);
});
test('a genuine rendered-track mismatch is a reviewable media failure, not a reason to submit generation again', () => {
  const decision = classifyContentExecutionFailure(Error('presenter_mother_frozen_audio_track_mismatch'), { attempt: 1 });
  assert.equal(decision.disposition, 'block'); assert.equal(decision.retryDelayMs, null);
  assert.match(decision.publicReason, /不自动重新生成/);
});
test('deterministic handoff and final quality failures do not rerun paid or local production automatically', () => {
  for (const code of ['content_execution_checkpoints_too_large', 'social_content_idempotency_conflict', 'content_test_input_plan_changed', 'social_production_handoff_g3_incomplete', 'social_content_artifact_not_allowed', 'social_graph_quality_failed:technical_quality_unverified']) {
    const decision = classifyContentExecutionFailure(Error(code), { attempt: 1 });
    assert.equal(decision.disposition, 'block'); assert.equal(decision.maxAttempts, 1);
    assert.equal(decision.failureClass, 'input_required'); assert.equal(decision.retryDelayMs, null);
    assert.match(decision.publicReason, /保留/);
    const pending = classifyContentExecutionFailure(Error(code), { attempt: 1, hasUnsettledProviderReceipt: true });
    assert.equal(pending.disposition, 'reconcile');
  }
});


test('presenter visual permission and geometry issues preserve artifacts without blind retries',()=>{
 for(const code of ['presenter_first_frame_quality_inspection_authorization_required:group','presenter_first_frame_visual_qa_required','presenter_first_frame_target_ratio_mismatch','presenter_first_frame_repair_ratio_mismatch']){
  const decision=classifyContentExecutionFailure(new Error(code),{attempt:1});
  assert.equal(decision.failureClass,'input_required');assert.equal(decision.disposition,'block');assert.equal(decision.retryDelayMs,null);
 }
});


test('missing paid static artifacts reconcile while corrupt evidence blocks without regeneration',()=>{
 for(const code of ['presenter_image_artifact_recovery_required','presenter_inspection_artifact_recovery_required']){
  assert.equal(classifyContentExecutionFailure(new Error(code),{attempt:1}).disposition,'reconcile');
 }
 for(const code of ['presenter_image_artifact_bytes_changed','presenter_inspection_artifact_corrupt']){
  assert.equal(classifyContentExecutionFailure(new Error(code),{attempt:1}).disposition,'block');
 }
});

test('dependency completion waits for reconciliation, while conflicting input bindings block',()=>{
 for(const code of ['social_paid_permit_execution_dependency_not_completed','social_paid_permit_execution_binding_recovery_required'])assert.equal(classifyContentExecutionFailure(new Error(code),{attempt:1}).disposition,'reconcile');
 for(const code of ['social_paid_permit_execution_binding_conflict','social_paid_permit_execution_dependency_artifact_changed','social_task_budget_authority_execution_dependency_invalid','social_paid_permit_claim_corrupt','presenter_inspection_artifact_changed']){
  const result=classifyContentExecutionFailure(new Error(code),{attempt:1});assert.equal(result.disposition,'block');assert.equal(result.retryDelayMs,null);
 }
});

test('background/fusion quality and provenance failures preserve the original operation and require targeted repair',()=>{
 for(const code of ['presenter_background_quality_failed','presenter_composite_quality_failed','presenter_background_artifact_changed','presenter_background_paid_plan_invalid','presenter_first_frame_target_ratio_required']){
  const result=classifyContentExecutionFailure(new Error(code),{attempt:1});assert.equal(result.disposition,'block');assert.equal(result.retryDelayMs,null);
 }
});
