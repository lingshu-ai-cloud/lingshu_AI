import test from 'node:test';
import assert from 'node:assert/strict';
import { socialExecutionBudgetStatus } from './socialContentAgentWorkflow.js';
import { socialContentEmbeddedRuntimeRegistrations } from './socialContentAgentWorkflowContext.js';
import { socialPresenterReservationExceedsInternalBudget } from './socialContentHeyGenBridge.js';
import { wholeTrackReservationExceedsInternalBudget } from './socialContentWholeTrackHeyGenBridge.js';
import { aiVisualExceedsInternalBudget, createSocialAiVisualAdapter } from './socialContentAiVisualAdapter.js';
import { sceneReworkExceedsOriginalInternalBudget } from './socialContentSceneReworkCostPolicy.js';
import { socialDirectorG5AmountWithinInternalBudget } from './socialDirectorG5ReviewService.js';
import { g5FixtureScope, prepareDirectorG5Fixture } from './socialDirectorG5ReviewService.fixture.js';

test('agent workflow reports real external cost but skips budget-exceeded only for the exact exempt tenant', async () => {
  const configured = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  try {
    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'local_tenant_customer_aurelia_beauty';
    const plan = { budgetLimitCny: 10, scenes: [{ sceneId: 'scene-1', recommendedCandidateIds: ['candidate-1'],
      candidates: [{ candidateId: 'candidate-1', sourceStrategy: 'licensed_stock_asset',
        dataTransfer: 'external_processor', estimatedCostCny: 12 }] }] };
    const director = { scenes: [{ sceneId: 'scene-1', visualTopic: { subject: 'product' } }] };
    const ordinary = socialExecutionBudgetStatus(plan as never, director as never, 'another-tenant');
    const exempt = socialExecutionBudgetStatus(plan as never, director as never, 'local_tenant_customer_aurelia_beauty');
    assert.deepEqual(ordinary, { estimatedCostCny: 12, budgetLimitCny: 10, exceeded: true });
    assert.deepEqual(exempt, { estimatedCostCny: 12, budgetLimitCny: 10, exceeded: false });
    assert.equal(socialExecutionBudgetStatus(plan as never, director as never,
      'local_tenant_customer_aurelia_beauty-suffix').exceeded, true);
    assert.equal(socialPresenterReservationExceedsInternalBudget(
      'local_tenant_customer_aurelia_beauty', 3, 2), false);
    assert.equal(socialPresenterReservationExceedsInternalBudget('another-tenant', 3, 2), true);
    assert.equal(wholeTrackReservationExceedsInternalBudget(
      'local_tenant_customer_aurelia_beauty', 3, 2), false);
    assert.equal(wholeTrackReservationExceedsInternalBudget('another-tenant', 3, 2), true);
    assert.equal(aiVisualExceedsInternalBudget('local_tenant_customer_aurelia_beauty', 3, 2), false);
    assert.equal(aiVisualExceedsInternalBudget('another-tenant', 3, 2), true);
    assert.equal(sceneReworkExceedsOriginalInternalBudget(
      'local_tenant_customer_aurelia_beauty', 12, 10), false);
    assert.equal(sceneReworkExceedsOriginalInternalBudget('another-tenant', 12, 10), true);
    assert.equal(socialDirectorG5AmountWithinInternalBudget(
      'local_tenant_customer_aurelia_beauty', 12, 10), true);
    assert.equal(socialDirectorG5AmountWithinInternalBudget('another-tenant', 12, 10), false);
    assert.equal(socialDirectorG5AmountWithinInternalBudget(
      'local_tenant_customer_aurelia_beauty', Number.NaN, 10), false);
    let generated = 0;
    const frozenTariffAdapter = createSocialAiVisualAdapter({ enabled: true, maxCostCnyPerShot: 2,
      timeoutMs: 1_000, enforceCostCeilingForExemptTenant: true,
      generators: [{ generatorId: 'qwen_image', mediaType: 'image', estimatedCostCny: 3,
        generate: async () => { generated++; throw new Error('must not submit'); } }] });
    const blocked = await frozenTariffAdapter.execute({ tenantId: 'local_tenant_customer_aurelia_beauty',
      taskId: 'task', outputDirectory: '/tmp', availableAssets: [],
      baselineScene: { shotFunction: 'value', subject: 'product', action: 'show' },
      shot: { shotId: 'shot', function: 'value', sourceStrategy: 'non_evidentiary_ai_visual',
        productionInstruction: 'generic product illustration',
        functionalEquivalentReplacement: { description: 'generic product illustration' },
        truthBoundary: { syntheticVisualAllowed: true, customerEvidenceRequired: false } } } as never);
    assert.equal(blocked, null);
    assert.equal(generated, 0, 'frozen scene-rework tariff ceiling still blocks supplier submission');
  } finally {
    if (configured === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = configured;
  }
});

test('legacy presenter planning passes tenant scope into the Studio admission budget', () => {
  const changes = {
    SOCIAL_CONTENT_HEYGEN_ENABLED: 'true', HEYGEN_GENERATION_ENABLED: 'true', HEYGEN_API_KEY: 'controlled-only',
    OBJECT_STORAGE_DRIVER: 'local', STUDIO_PAID_BUDGET_CNY: '1', STUDIO_PAID_OPENING_USED_CNY: '1',
    STUDIO_HEYGEN_RESERVE_CNY: '0.25', STUDIO_ASR_RESERVE_CNY: '0.1',
    INTERNAL_BUDGET_EXEMPT_TENANT_IDS: 'tenant-planning-exempt',
  };
  const saved = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, changes);
    const ordinary = socialContentEmbeddedRuntimeRegistrations({ tenantId: 'ordinary-tenant' })
      .find(row => row.strategy === 'authorized_digital_presenter')!;
    const exempt = socialContentEmbeddedRuntimeRegistrations({ tenantId: 'tenant-planning-exempt' })
      .find(row => row.strategy === 'authorized_digital_presenter')!;
    assert.equal(ordinary.environmentReady, false);
    assert.equal(exempt.environmentReady, true);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('G5 server context declares the exact tenant exemption and binds it into context identity', async () => {
  const configured = process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
  const fixture = await prepareDirectorG5Fixture();
  try {
    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = 'another-tenant';
    const ordinary = await fixture.g5.context(g5FixtureScope, 'owner');
    assert.equal(ordinary.agent.internalBudgetExempt, false);

    process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = g5FixtureScope.tenantId;
    const exempt = await fixture.g5.context(g5FixtureScope, 'owner');
    assert.equal(exempt.agent.internalBudgetExempt, true);
    assert.notEqual(exempt.contextHash, ordinary.contextHash);
    assert.equal(exempt.sourceHash, ordinary.sourceHash);
  } finally {
    await fixture.cleanup();
    if (configured === undefined) delete process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS;
    else process.env.INTERNAL_BUDGET_EXEMPT_TENANT_IDS = configured;
  }
});
