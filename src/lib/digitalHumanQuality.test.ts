import assert from 'node:assert/strict';
import test from 'node:test';
import { digitalHumanQualityState, sentenceExecutionQuality, deferUnavailableVisualChecksToManual, initialDigitalHumanQuality, recordDigitalHumanMediaCheck, recordModelQualityChecks, recordReferenceTechnicalChecks, recordReferenceVisualChecks, reviewDigitalHumanQuality } from './digitalHumanQuality.js';

test('automatic media admission never pretends manual identity and lip-sync checks passed', () => {
  const initial = initialDigitalHumanQuality(undefined, 't1');
  const admitted = recordDigitalHumanMediaCheck(initial, { passed: true, evidence: 'material:video-1', now: 't2' });
  assert.equal(admitted.state, 'accepted');
  assert.equal(admitted.checks.find(item => item.key === 'media_import')?.status, 'passed');
  assert.equal(admitted.checks.find(item => item.key === 'identity')?.status, 'pending');
  assert.equal(admitted.checks.find(item => item.key === 'lip_sync')?.status, 'pending');
});

test('reference routes include timing, action and preservation review and require all checks for acceptance', () => {
  const initial = initialDigitalHumanQuality({ workflow: 'viral_replication', method: 'reenact', contentConfirmed: true, action: 'wave', scene: 'showroom', preserve: 'product' }, 't1');
  const admitted = recordDigitalHumanMediaCheck(initial, { passed: true, evidence: 'material:video-2', now: 't2' });
  for (const key of ['reference_timing', 'action_scene', 'preservation']) assert.ok(admitted.checks.some(item => item.key === key));
  const technicallyChecked = recordReferenceTechnicalChecks(admitted, { durationDeltaFrames: 0, audioCorrelation: 1, temporalMotionDifference: 0, freezeMismatchRatio: 0, comparedFrames: 20 });
  const visuallyChecked = recordReferenceVisualChecks(technicallyChecked, { normalizedPoseError: 0.02, posePairCount: 20, handPckAt008: 0.9, handPairCount: 10, wristSeparationMae: 0.08, wristMotionCorrelation: 0.95, wristPosePairCount: 18, backgroundSsim: 0.95, landmarkArtifactCount: 0 });
  const accepted = reviewDigitalHumanQuality(visuallyChecked, Object.fromEntries(admitted.checks.filter(item => item.mode === 'manual').map(item => [item.key, { passed: true, evidence: `review:${item.key}` }])), 't3');
  assert.equal(accepted.state, 'accepted');
  const rejected = reviewDigitalHumanQuality(admitted, { identity: { passed: false, evidence: '人物不一致' } }, 't4');
  assert.equal(rejected.state, 'failed');
});

test('reference media metrics fill technical checks without claiming identity or pose quality', () => {
  const initial = initialDigitalHumanQuality({ workflow: 'viral_replication', method: 'replace', contentConfirmed: true, action: '', scene: '', preserve: '' }, 'start');
  const checked = recordReferenceTechnicalChecks(initial, {
    durationDeltaFrames: 1, audioCorrelation: 0.995, temporalMotionDifference: 2.4, freezeMismatchRatio: 0.01, comparedFrames: 30,
  }, 'checked');
  assert.equal(checked.state, 'pending');
  assert.equal(checked.checks.find(item => item.key === 'reference_duration')?.status, 'passed');
  assert.equal(checked.checks.find(item => item.key === 'reference_audio')?.status, 'passed');
  assert.equal(checked.checks.find(item => item.key === 'reference_motion')?.status, 'passed');
  assert.equal(checked.checks.find(item => item.key === 'identity')?.status, 'pending');
  assert.equal(checked.checks.find(item => item.key === 'action_scene')?.status, 'pending');

  const failed = recordReferenceTechnicalChecks(initial, {
    durationDeltaFrames: 4, audioCorrelation: null, temporalMotionDifference: 10, freezeMismatchRatio: 0.2, comparedFrames: 3,
  });
  assert.equal(failed.state, 'failed');
  assert.match(failed.checks.find(item => item.key === 'reference_audio')?.evidence || '', /人工确认声音策略/);
});

test('visual proxy metrics gate pose background and artifacts but never auto-approve identity', () => {
  const initial = initialDigitalHumanQuality({ workflow: 'viral_replication', method: 'replace', contentConfirmed: true, action: '', scene: '', preserve: '' });
  const checked = recordReferenceVisualChecks(initial, {
    normalizedPoseError: 0.04, posePairCount: 20, handPckAt008: 0.82, handPairCount: 8,
    wristSeparationMae: 0.12, wristMotionCorrelation: 0.9, wristPosePairCount: 15,
    backgroundSsim: 0.93, landmarkArtifactCount: 0, faceAppearanceCorrelationProxy: 0.95, facePairCount: 20,
  });
  for (const key of ['reference_pose_proxy', 'reference_background_proxy', 'reference_artifacts_proxy']) assert.equal(checked.checks.find(item => item.key === key)?.status, 'passed');
  assert.equal(checked.checks.find(item => item.key === 'identity')?.status, 'pending');
  assert.equal(checked.state, 'pending');
  const missingEvidence = recordReferenceVisualChecks(initial, {
    normalizedPoseError: null, posePairCount: 0, handPckAt008: null, handPairCount: 0,
    wristSeparationMae: null, wristMotionCorrelation: null, wristPosePairCount: 0,
    backgroundSsim: null, landmarkArtifactCount: 0,
  });
  assert.equal(missingEvidence.state, 'failed');
  assert.match(missingEvidence.checks.find(item => item.key === 'reference_pose_proxy')?.evidence || '', /缺失/);
});

test('registered model evidence can automate identity and local product checks without trusting malformed output', () => {
  const initial = initialDigitalHumanQuality({ workflow: 'viral_replication', method: 'replace', contentConfirmed: true, action: '', scene: '', preserve: '产品与附件' });
  const checked = recordModelQualityChecks(initial, {
    identity: { passed: true, confidence: 0.98, model: 'enterprise-face-v3', evidence: '人物资产 V4，采样 18 帧' },
    product_fidelity: { passed: true, confidence: 0.91, model: 'sku-vision-v2', evidence: 'SKU 正面文字与接口结构一致' },
    local_artifacts: { passed: false, confidence: 0.87, model: 'artifact-inspector-v1', evidence: '第 42 帧右手与产品边缘粘连' },
  }, 'checked');
  assert.equal(checked.checks.find(item => item.key === 'identity')?.mode, 'automatic');
  assert.equal(checked.checks.find(item => item.key === 'identity')?.status, 'passed');
  assert.match(checked.checks.find(item => item.key === 'identity')?.evidence || '', /enterprise-face-v3 · 置信度 0\.980/);
  assert.equal(checked.checks.find(item => item.key === 'local_artifacts')?.status, 'failed');
  assert.equal(checked.state, 'failed');
  const malformed = recordModelQualityChecks(initial, { identity: { passed: true, confidence: 2, model: '', evidence: '' } });
  assert.equal(malformed.checks.find(item => item.key === 'identity')?.mode, 'manual');
  assert.equal(malformed.checks.find(item => item.key === 'identity')?.status, 'pending');
});

test('missing visual model becomes explicit manual review instead of a permanently pending automatic gate', () => {
  const initial = initialDigitalHumanQuality({ workflow: 'viral_replication', method: 'reenact', contentConfirmed: true, action: '', scene: '', preserve: '' });
  const deferred = deferUnavailableVisualChecksToManual(recordReferenceTechnicalChecks(recordDigitalHumanMediaCheck(initial, { passed: true, evidence: 'material:1' }), {
    durationDeltaFrames: 0, audioCorrelation: 1, temporalMotionDifference: 1, freezeMismatchRatio: 0, comparedFrames: 20,
  }));
  for (const key of ['reference_pose_proxy', 'reference_background_proxy', 'reference_artifacts_proxy']) {
    const check = deferred.checks.find(item => item.key === key); assert.equal(check?.mode, 'manual'); assert.match(check?.evidence || '', /未配置可核验的视觉模型/);
  }
  const accepted = reviewDigitalHumanQuality(deferred, Object.fromEntries(deferred.checks.filter(item => item.mode === 'manual').map(item => [item.key, { passed: true, evidence: '人工逐帧对照通过' }])));
  assert.equal(accepted.state, 'accepted');
});

test('automatic admission keeps human decisions pending and does not fabricate reviewedAt', () => {
 const report=recordDigitalHumanMediaCheck(initialDigitalHumanQuality(),{passed:true,evidence:'verified media'});
 assert.equal(report.state,'accepted'); assert.equal(report.reviewedAt,undefined);
 assert.equal(report.checks.find(check=>check.key==='identity')?.status,'pending');
 assert.equal(digitalHumanQualityState([...report.checks,{key:'reference_background_proxy',label:'background',mode:'automatic',status:'failed',evidence:'SSIM .2'}]),'accepted');
 for(const key of ['identity','product_fidelity','lip_sync']) assert.equal(digitalHumanQualityState([...report.checks,{key,label:key,mode:'automatic',status:'failed',evidence:'explicit hard failure'}]),'failed');
 const cue={cueId:'c1',kind:'person_generated' as const,state:'accepted' as const,checks:[{key:'media' as const,status:'passed' as const,evidence:'valid'},{key:'identity' as const,status:'pending' as const,evidence:'unverified'},{key:'background' as const,status:'failed' as const,evidence:'different background'}]};
 const execution=sentenceExecutionQuality([cue],'material');assert.equal(execution.state,'accepted');assert.equal(execution.reviewedAt,undefined);
 assert.equal(sentenceExecutionQuality(undefined,'material').state,'pending');
 assert.equal(sentenceExecutionQuality([{...cue,checks:[...cue.checks,{key:'product_brand_text',status:'failed',evidence:'wrong product'}]}],'material').state,'failed');
});
