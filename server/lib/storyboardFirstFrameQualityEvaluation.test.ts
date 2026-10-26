import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateStoryboardFirstFrameQuality } from './storyboardFirstFrameQualityEvaluation.js';

const observations = () => ['product_identity', 'packaging_visibility', 'subject_visibility', 'layout', 'visual_integrity'].map(key => ({
  key, verdict: 'pass', evidenceFrames: ['候选首帧'], note: '候选中可见证据',
}));
const base = () => ({ sceneType: 'product' as const, hasProduct: true, hasNamedPerson: false,
  hasContact: false, hasAction: false, candidateLabels: ['候选首帧'], referenceLabels: ['企业产品参考'],
  applyReplicationAutomation: true, checkedAt: '2026-10-11T00:00:00.000Z',
  inspectTechnical: async () => [], inspectVisual: async (): Promise<unknown> => observations() });

test('valid visual evidence uses the existing deterministic QA gate', async () => {
  const result = await evaluateStoryboardFirstFrameQuality(base());
  assert.equal(result.firstFrameQualityState, 'evaluated');
  assert.equal(result.firstFrameQuality?.passed, true);
  assert.equal(result.firstFrameQuality?.automatedPassed, true);
  assert.equal(result.canProceedToVideo, true);
  assert.equal(result.retryable, false);
});

test('a provider/model outage is not converted into a product quality failure', async () => {
  const result = await evaluateStoryboardFirstFrameQuality({ ...base(), inspectVisual: async () => { throw new Error('404 private-api-key=secret model_not_found'); } });
  assert.equal(result.firstFrameQualityState, 'service_unavailable');
  assert.equal(result.firstFrameQuality, null);
  assert.equal(result.canProceedToVideo, false);
  assert.equal(result.retryable, true);
  assert.match('error' in result ? result.error : '', /保留生成图片.*复检原图.*无需重新生成/);
  assert.doesNotMatch(JSON.stringify(result), /secret|PRODUCT_IDENTITY_UNVERIFIED|needs_assets|retry_first_frame/);
});

test('local technical inspector failures retain the generated image and do not fake a report', async () => {
  let visualCalled = false;
  const result = await evaluateStoryboardFirstFrameQuality({ ...base(), inspectTechnical: async () => { throw new Error('decoder unavailable'); }, inspectVisual: async () => { visualCalled = true; return observations(); } });
  assert.equal(result.firstFrameQualityState, 'service_unavailable');
  assert.equal(result.firstFrameQuality, null);
  assert.equal(visualCalled, false);
});

test('wrong candidate labels, absent checks, invalid verdicts and reference-only passes are contract failures', async () => {
  for (const invalid of [
    observations().map(item => ({ ...item, evidenceFrames: ['候选0s'] })),
    observations().filter(item => item.key !== 'product_identity'),
    observations().map(item => ({ ...item, verdict: 'looks-good' })),
    observations().map(item => ({ ...item, evidenceFrames: ['企业产品参考'] })),
    {}, null, [],
    [...observations(), { ...observations()[0], verdict: 'fail' }],
  ]) {
    const result = await evaluateStoryboardFirstFrameQuality({ ...base(), inspectVisual: async () => invalid });
    assert.equal(result.firstFrameQualityState, 'invalid_response');
    assert.equal(result.firstFrameQuality, null);
    assert.equal(result.canProceedToVideo, false);
    assert.equal(result.retryable, true);
    assert.ok(result.contractIssues.length);
  }
});

test('real evidence-backed product failure remains a genuine quality failure', async () => {
  const result = await evaluateStoryboardFirstFrameQuality({ ...base(), inspectVisual: async () => observations().map(item => item.key === 'product_identity'
    ? { ...item, verdict: 'fail', action: 'needs_assets', note: '候选包装颜色与企业参考图不同' } : item) });
  assert.equal(result.firstFrameQualityState, 'evaluated');
  assert.equal(result.canProceedToVideo, false);
  assert.equal(result.firstFrameQuality?.passed, false);
  assert.deepEqual(result.firstFrameQuality?.reasonCodes, ['PRODUCT_IDENTITY_FAILED']);
});

test('valid uncertain evidence is not misclassified as a broken service or silently passed', async () => {
  const result = await evaluateStoryboardFirstFrameQuality({ ...base(), inspectVisual: async () => observations().map(item => item.key === 'product_identity'
    ? { ...item, verdict: 'uncertain', evidenceFrames: [], note: '标签被遮挡，无法核验身份' } : item) });
  assert.equal(result.firstFrameQualityState, 'evaluated');
  assert.equal(result.firstFrameQuality?.passed, false);
  assert.deepEqual(result.firstFrameQuality?.reasonCodes, ['PRODUCT_IDENTITY_UNVERIFIED']);
});

test('real blank-frame technical evidence overrides the model pass without erasing failure', async () => {
  const result = await evaluateStoryboardFirstFrameQuality({ ...base(), inspectTechnical: async () => [{ key: 'visual_integrity', verdict: 'fail', evidenceFrames: ['候选首帧'], note: '候选为黑帧', action: 'retry_first_frame' }] });
  assert.equal(result.firstFrameQualityState, 'evaluated');
  assert.equal(result.canProceedToVideo, false);
  assert.deepEqual(result.firstFrameQuality?.reasonCodes, ['VISUAL_INTEGRITY_FAILED']);
});

test('person and normal generation modes retain their existing review boundary', async () => {
  const normal = await evaluateStoryboardFirstFrameQuality({ ...base(), applyReplicationAutomation: false });
  assert.equal(normal.firstFrameQuality?.automatedPassed, true);
  assert.equal(normal.firstFrameQuality?.passed, false);
  const person = await evaluateStoryboardFirstFrameQuality({ ...base(), hasNamedPerson: true,
    inspectVisual: async () => [...observations(), { key: 'person_identity', verdict: 'pass', evidenceFrames: ['候选首帧'], note: '人物匹配' }] });
  assert.equal(person.firstFrameQuality?.passed, false);
  assert.equal(person.firstFrameQuality?.requiresHumanReview, true);
});

test('ambiguous role labels are rejected before paid inspection and inputs stay immutable', async () => {
  let calls = 0;
  const input = { ...base(), referenceLabels: ['候选首帧'], inspectVisual: async () => { calls++; return observations(); } };
  const before = JSON.stringify(input);
  const result = await evaluateStoryboardFirstFrameQuality(input);
  assert.equal(result.firstFrameQualityState, 'invalid_response');
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(input), before);
});

test('background removal and natural fusion are explicit evidence gates rather than technical-only passes',async()=>{
 for(const key of ['person_absence','lighting_perspective']){
  const options={...base(),sceneType:'general' as const,hasProduct:false,hasEnvironmentReference:true,hasNamedPerson:key==='lighting_perspective',personRemovalRequired:key==='person_absence',naturalCompositeRequired:key==='lighting_perspective',applyReplicationAutomation:false};
  const required=['layout','visual_integrity','environment_fidelity',...(key==='lighting_perspective'?['person_identity']:[])];
  const observed=(keys:string[])=>keys.map(key=>({key,verdict:'pass',evidenceFrames:['候选首帧'],note:'visible'}));
  const absent=await evaluateStoryboardFirstFrameQuality({...options,inspectVisual:async()=>observed(required)});assert.equal(absent.canProceedToVideo,false);assert.ok(absent.contractIssues.some(issue=>issue.includes(key)));
  const referencedOnly=await evaluateStoryboardFirstFrameQuality({...options,inspectVisual:async()=>[...observed(required),{key,verdict:'pass',evidenceFrames:['企业产品参考'],note:'reference only'}]});assert.equal(referencedOnly.canProceedToVideo,false);
  const valid=await evaluateStoryboardFirstFrameQuality({...options,inspectVisual:async()=>observed([...required,key])});
  assert.equal(valid.firstFrameQuality?.automatedPassed,true);
  assert.equal(valid.canProceedToVideo,false,'this low-level evaluator retains its existing human-review boundary; the funded pipeline consumes automatedPassed explicitly');
  assert.equal(valid.firstFrameQuality?.checks[key]?.verdict,'pass');
 }
});

test('original empty scene requires explicit person absence without claiming removal or environment matching',async()=>{
 const options={...base(),sceneType:'general' as const,hasProduct:false,hasEnvironmentReference:false,hasNamedPerson:false,personRemovalRequired:false,personAbsenceRequired:true,applyReplicationAutomation:false};
 const observed=['layout','visual_integrity'].map(key=>({key,verdict:'pass',evidenceFrames:['候选首帧'],note:'visible'}));
 for(const verdict of ['uncertain','fail','pass']){
  const result=await evaluateStoryboardFirstFrameQuality({...options,inspectVisual:async()=>[...observed,{key:'person_absence',verdict,evidenceFrames:['候选首帧'],note:'candidate evidence'}]});
  assert.equal(result.firstFrameQuality?.automatedPassed,verdict==='pass');
 }
});
