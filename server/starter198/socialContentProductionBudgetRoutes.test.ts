import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionBudgetRouteReaders, productionBillingAccountRef } from './socialContentProductionBudgetRoutes.js';
import type { PaidStageRequirement } from './socialContentPaidOperationPlan.js';
const req = (stage = 'material_video_analysis', frames = 20): PaidStageRequirement => ({ key: 'actual-asset:analysis', stage, shotId: null, sourceRef: 'a'.repeat(64), durationSeconds: null, text: null, frameCount: frames, inputContractHash: 'b'.repeat(64) });
const binding = { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', credentialSha256: '1'.repeat(64), materialModel: 'qwen3-vl-flash', imageModel: 'qwen3-vl-plus' };
test('actual Qwen SDK model/max_tokens/account is frozen and rechecked before POST', async () => {
    let current = { ...binding };
    const reader = createProductionBudgetRouteReaders({ readQwenBinding: () => current });
    const route = await reader.resolveBoundRoute(req());
    assert.ok(route);
    assert.equal(route.model, binding.materialModel);
    assert.deepEqual(route.maximumUnits, { inputTokens: 262144, outputTokens: 2800 });
    assert.equal(route.maximumAttempts, 1);
    assert.equal(route.accountRef, productionBillingAccountRef('qwen', binding.baseUrl, binding.credentialSha256));
    await reader.assertProviderBinding({ ...route, stage: 'material_video_analysis' });
    current = { ...binding, credentialSha256: '2'.repeat(64) };
    await assert.rejects(reader.assertProviderBinding({ ...route, stage: 'material_video_analysis' }), /binding_changed/);
    current = { ...binding, materialModel: 'qwen3-vl-plus' };
    await assert.rejects(reader.assertProviderBinding({ ...route, stage: 'material_video_analysis' }), /binding_changed/);
    current = { ...binding, baseUrl: 'https://untrusted.example/v1' };
    assert.equal(await reader.resolveBoundRoute(req()), null);
    await assert.rejects(reader.assertProviderBinding({ ...route, stage: 'material_video_analysis' }), /gateway_changed/);
});
test('unproven model envelope, product inputs and TTS routes return explicit gaps', async () => {
    const reader = createProductionBudgetRouteReaders({ readQwenBinding: () => ({ ...binding, materialModel: 'private-arbitrary-model' }) });
    assert.equal(await reader.resolveBoundRoute(req()), null);
    assert.equal(await reader.resolveBoundRoute(req('first_frame')), null);
    assert.equal(await reader.readProductFrameBounds(req('product_generation')), null);
    assert.equal(await reader.resolveBoundRoute(req('tts')), null);
});
test('official Ark credential drift cannot borrow an intent account', async () => {
    let environment: NodeJS.ProcessEnv = { SEEDANCE_API_KEY: 'fixture-test-key', SEEDANCE_MODEL: 'doubao-seedance-2-0-fast-260128' };
    const reader = createProductionBudgetRouteReaders({ env: () => environment });
    // Account refs are derived from the real key, never model IDs or client IDs.
    const { createHash } = await import('node:crypto');
    const accountRef = productionBillingAccountRef('seedance', 'https://ark.cn-beijing.volces.com/api/v3', createHash('sha256').update(environment.SEEDANCE_API_KEY!).digest('hex'));
    await reader.assertProviderBinding({ provider: 'seedance', model: environment.SEEDANCE_MODEL!, stage: 'video', accountRef });
    environment = { ...environment, SEEDANCE_API_KEY: 'different-fixture-key' };
    await assert.rejects(reader.assertProviderBinding({ provider: 'seedance', model: environment.SEEDANCE_MODEL!, stage: 'video', accountRef }), /binding_changed/);
});
test('canonical product hashes bind actual QA image bounds and raw Seedream inputs',async()=>{
 const bounds={firstFrameMaximumFrames:3,videoMaximumFrames:5,productSha256s:['3'.repeat(64)],providerDurationSeconds:4,evidenceRef:'canonical-product-request-bounds:'+ '4'.repeat(64)};
 const reader=createProductionBudgetRouteReaders({env:()=>({SEEDREAM_API_KEY:'fixture',QWEN_VL_MODEL:'qwen3-vl-plus'}),readQwenBinding:()=>binding,readCanonicalProductBounds:async()=>bounds});
 const extraction={...req('product_frame_extract_plan'),shotId:'S04'};
 const result=await reader.readProductFrameBounds(extraction);assert.equal(result?.firstFrameMaximumFrames,3);assert.equal(result?.videoMaximumFrames,5);
 const frame=await reader.resolveBoundRoute({...extraction,stage:'first_frame'});assert.deepEqual(frame?.maximumUnits,{outputImages:1,inputImages:2});assert.equal(frame?.usageBoundRef,bounds.evidenceRef);
 const qa=await reader.resolveBoundRoute({...extraction,stage:'first_frame_qa',frameCount:3});assert.ok(qa);assert.match(qa.usageBoundRef,/canonical-product-request-bounds/);assert.deepEqual(qa.maximumUnits,{inputTokens:262144,outputTokens:4096});
 assert.equal(await reader.resolveBoundRoute({...extraction,stage:'first_frame_qa',frameCount:2}),null);
 assert.equal(await reader.resolveBoundRoute({...extraction,stage:'video',durationSeconds:3}),null,'unknown hard video billing bound remains an explicit gap, not a made-up maximum');
});

test('frozen Wan silent 3s binds actual account and per-second envelope, not Ark estimated tokens',async()=>{const reader=createProductionBudgetRouteReaders({readQwenBinding:()=>binding,readCanonicalProductBounds:async()=>({firstFrameMaximumFrames:2,videoMaximumFrames:5,productSha256s:['a'.repeat(64)],providerDurationSeconds:3,videoProvider:'wan',videoModel:'wan2.6-i2v-flash',evidenceRef:'canonical-KB-frozen-route'})});const route=await reader.resolveBoundRoute({...req('video',1),shotId:'p',durationSeconds:3});assert.ok(route);assert.equal(route.provider,'wan');assert.equal(route.model,'wan2.6-i2v-flash');assert.deepEqual(route.maximumUnits,{providerSeconds:3});await reader.assertProviderBinding({...route,stage:'video'});});
