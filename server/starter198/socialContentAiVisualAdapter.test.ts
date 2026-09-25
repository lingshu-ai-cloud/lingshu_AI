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
