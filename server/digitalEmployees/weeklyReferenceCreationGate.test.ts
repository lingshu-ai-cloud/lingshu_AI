import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { weeklyReferenceCreationGate } from './weeklyReferenceCreationGate.js';

const plan = (contentId: string, referenceId = '') => ({
  contentId, contentFamilyId: contentId, masterContentId: contentId,
  productionRole: 'master', route: 'clone', referenceId,
});
const pack = (...plans: ReturnType<typeof plan>[]) => ({
  tasks: [{ templateId: 'production', videoPlans: plans }],
}) as WeeklyPackage;
const evidence = (id: string) => ({ id, duration: 3, updatedAt: '2026-10-12T00:00:00.000Z', aiAnalysis: {
  analysisMode: 'exact', analysisQuality: 'video', geminiStatus: 'analyzed', gemini: {
    scriptDetails15s: [{ time: '0-3s', visual: `产品画面 ${id}`, materialType: 'product', narrativeRole: 'hook', classificationEvidence: '画面明确展示产品', analysisGranularity: 'shot' }],
  },
} });

test('new weekly task reports the exact shortage before establishing an empty-library plan', () => {
  assert.deepEqual(weeklyReferenceCreationGate(pack(plan('one'), plan('two')), []), {
    ready: false, requiredCount: 2, boundCount: 0, missingCount: 2,
  });
});

test('only distinct bound and production-admissible references count', () => {
  const library = [evidence('good'), { id: 'summary-only', aiAnalysis: { gemini: { summary: '摘要' } } }];
  assert.equal(weeklyReferenceCreationGate(pack(plan('one', 'good'), plan('two', 'good')), library).missingCount, 1);
  assert.equal(weeklyReferenceCreationGate(pack(plan('one', 'good'), plan('two', 'summary-only')), library).missingCount, 1);
  assert.deepEqual(weeklyReferenceCreationGate(pack(plan('one', 'good')), library), {
    ready: true, requiredCount: 1, boundCount: 1, missingCount: 0,
  });
});

test('product-only plans need no viral reference', () => {
  assert.equal(weeklyReferenceCreationGate(pack({ ...plan('product'), route: 'product' } as ReturnType<typeof plan>), []).ready, true);
});

test('goal creation checks the proposed reference bindings before persisting a goal or plan', () => {
  const route = readFileSync(new URL('../routes/digitalEmployeeGoalRoutes.ts', import.meta.url), 'utf8');
  const start = route.indexOf("digitalEmployeesRouter.post('/goals'");
  const end = route.indexOf("digitalEmployeesRouter.post('/goals/:goalId/approve'");
  const creation = route.slice(start, end);
  assert.ok(creation.indexOf('weeklyReferenceCreationGate(recommendedPackage, referenceLibrary.items)') > 0);
  assert.ok(creation.indexOf("error: 'weekly_reference_shortage'") < creation.indexOf('requiredCreate<GoalRecord>'));
  assert.ok(creation.indexOf('requiredCreate<GoalRecord>') < creation.indexOf('requiredCreate<PlanRecord>'));
});
