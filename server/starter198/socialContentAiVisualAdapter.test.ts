import assert from 'node:assert/strict';
import test from 'node:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSocialAiVisualAdapter, type SocialAiVisualGenerator } from './socialContentAiVisualAdapter.js';
import type { SocialAssetSupplyAdapterContext } from './socialContentAssetSupplyExecution.js';

function context(outputDirectory: string): SocialAssetSupplyAdapterContext {
  return {
    tenantId: 'tenant-a', taskId: 'task-a', outputDirectory, availableAssets: [],
    shot: {
      shotId: 'shot-1', function: 'value', requestedDescription: '展示客户工厂如何提升真实效果',
      sourceStrategy: 'non_evidentiary_ai_visual', sourceRefs: [], fallbackSourceStrategy: 'motion_graphics',
      productionInstruction: '用抽象流程说明价值，不展示真实客户主体',
      truthBoundary: {
        subject: 'customer_factory', syntheticVisualAllowed: true, customerEvidenceRequired: false,
        customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true,
        prohibitedRepresentations: [
          'depict_generated_factory_as_customer_factory',
          'invent_customer_case_or_results',
          'depict_generated_effect_as_verified_product_result',
        ],
      },
      functionalEquivalentReplacement: {
        required: true, preservesFunction: 'value', replacesSubject: 'customer_factory',
        description: '用抽象节点和光线表现流程协作', reason: '缺少客户实拍',
      },
      feasibility: 'functional_equivalent', feasibilityReason: '可用示意画面', customerShootRequired: false,
    },
    baselineScene: {
      sceneId: 'shot-1', shotFunction: '价值说明', subject: '协作流程', action: '节点依次点亮',
      script: '', voiceover: '', caption: '', narration: '',
    } as any,
  };
}

test('AI visual adapter adds a non-evidentiary disclosure, provenance and stable idempotency key', async () => {
  const outputDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-ai-visual-'));
  const calls: Array<{ prompt: string; idempotencyKey: string }> = [];
  const generator: SocialAiVisualGenerator = {
    generatorId: 'mock-image', mediaType: 'image', estimatedCostCny: 0.5,
    async generate(input) {
      calls.push({ prompt: input.prompt, idempotencyKey: input.idempotencyKey });
      return { type: 'image', providerId: 'mock', model: 'mock-1', bytes: Buffer.from('image'), mimeType: 'image/png', estimatedCostCny: 0.5 };
    },
  };
  const adapter = createSocialAiVisualAdapter({ enabled: true, generators: [generator], maxCostCnyPerShot: 1, timeoutMs: 1_000 });
  const first = await adapter.execute(context(outputDirectory));
  const second = await adapter.execute(context(outputDirectory));
  assert.ok(first);
  assert.equal(second?.asset.id, first.asset.id);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.prompt, /Do not depict or imply the customer's real factory/);
  assert.equal(first.synthetic, true);
  assert.equal(first.representation, 'non_evidentiary_visual');
  assert.match(first.disclosure || '', /非客户实拍\/案例\/效果证据/);
  assert.equal(first.asset.segments[0]?.idempotencyKey, calls[0]!.idempotencyKey);
  assert.equal(await fsp.readFile(first.asset.localPath!, 'utf8'), 'image');
});

test('AI visual adapter enforces budget and returns null so the router can use motion graphics', async () => {
  let called = false;
  const expensive: SocialAiVisualGenerator = {
    generatorId: 'expensive-video', mediaType: 'video', estimatedCostCny: 9,
    async generate() { called = true; throw new Error('must not run'); },
  };
  const adapter = createSocialAiVisualAdapter({ enabled: true, generators: [expensive], maxCostCnyPerShot: 1, timeoutMs: 50 });
  assert.equal(await adapter.execute(context(os.tmpdir())), null);
  assert.equal(called, false);
});

test('visual repair uses a new provider key while repeating the same repair reuses its output', async () => {
  const outputDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-ai-repair-'));
  const keys: string[] = [];
  const adapter = createSocialAiVisualAdapter({ enabled: true, generators: [{
    generatorId: 'test-image', mediaType: 'image', estimatedCostCny: 0,
    async generate(input) {
      keys.push(input.idempotencyKey);
      return { type: 'image', providerId: 'test', model: 'test', bytes: Buffer.from('image'), mimeType: 'image/png', estimatedCostCny: 0 };
    },
  }], maxCostCnyPerShot: 1, timeoutMs: 1000 });
  try {
    const original = context(outputDirectory);
    const repair = { ...original, operationId: `scene_rework_${'a'.repeat(24)}` };
    const first = await adapter.execute(original);
    const changed = await adapter.execute(repair);
    const retry = await adapter.execute(repair);
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
    assert.notEqual(first?.asset.id, changed?.asset.id);
    assert.equal(changed?.asset.id, retry?.asset.id);
    assert.equal(repair.taskId, original.taskId);
  } finally { await fsp.rm(outputDirectory, { recursive: true, force: true }); }
});

test('AI visual adapter rejects evidence-required shots before calling a provider', async () => {
  let called = false;
  const generator: SocialAiVisualGenerator = {
    generatorId: 'mock', mediaType: 'image', estimatedCostCny: 0,
    async generate() { called = true; throw new Error('must not run'); },
  };
  const input = context(os.tmpdir());
  input.shot.truthBoundary.customerEvidenceRequired = true;
  input.shot.truthBoundary.syntheticVisualAllowed = false;
  const adapter = createSocialAiVisualAdapter({ enabled: true, generators: [generator], maxCostCnyPerShot: 1, timeoutMs: 50 });
  assert.equal(await adapter.execute(input), null);
  assert.equal(called, false);
});

test('actual generator input contains frozen account rule data and different rule hashes cannot reuse output',async()=>{const {freezeSocialAccountProductionConstraints}=await import('./socialAccountProductionConstraints.js');const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'account-rule-transport-'));const inputs:Array<{prompt:string;idempotencyKey:string}>=[];try{const adapter=createSocialAiVisualAdapter({enabled:true,maxCostCnyPerShot:1,timeoutMs:1000,generators:[{generatorId:'controlled',mediaType:'image',estimatedCostCny:.1,generate:async input=>{inputs.push(input);return {type:'image',providerId:'controlled',model:'controlled',bytes:Buffer.from('owned-controlled-image'),mimeType:'image/png',estimatedCostCny:.1};}}]});const rules={recordHash:'a'.repeat(64),audience:['采购人员'],pillars:['产品证据'],recurringFormats:['实测'],conversionRoute:{routeId:'r',entryType:'whatsapp' as const,entryRef:'actual-contact',callToAction:'咨询',qualificationFields:[],handoffTarget:null,verifiedAt:null},evidenceRules:['仅已核实事实'],visualRules:['原文视觉约束'],languageRules:['原文语言约束'],presenterRules:['原文人物约束'],fixedFactors:['固定调性'],experimentFactors:['开场']};const authority={targetAccountRef:{objectType:'owned_social_account',id:'account',version:'3'},accountPlaybookRef:{objectType:'account_playbook' as const,id:'playbook',version:'2',accountRef:'account'},verifiedAccountPlaybook:rules};const original=context(folder);const first={...original,accountPlaybookConstraints:freezeSocialAccountProductionConstraints(authority)};await adapter.execute(first);await adapter.execute(first);assert.equal(inputs.length,1);for(const text of ['原文视觉约束','原文语言约束','原文人物约束',first.accountPlaybookConstraints!.constraintHash])assert.ok(inputs[0]!.prompt.includes(text));assert.equal(first.baselineScene.narration,original.baselineScene.narration);await adapter.execute({...original,accountPlaybookConstraints:freezeSocialAccountProductionConstraints({...authority,verifiedAccountPlaybook:{...rules,visualRules:['另一个实际视觉约束']}})});assert.equal(inputs.length,2);assert.notEqual(inputs[0]!.idempotencyKey,inputs[1]!.idempotencyKey);}finally{await fsp.rm(folder,{recursive:true,force:true});}});
