import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { weeklyTaskRequirements } from './weeklyTaskRequirements.js';

const profile = { company: { name: '1', mainMarkets: '' }, brand: { name: '1' }, strategy: { focusMarkets: '待在实际任务中确认' }, products: { items: [{ id: 'actual-imported-product', name: 'Actual product', images: [], videos: [] }] }, factVersion: { id: 'original-facts-v23' } } as unknown as EnterpriseProfile;
const task = (step: string, reasons: string[] = []) => ({ schedule: { stepKind: step }, status: 'blocked', ownBlockingReasons: reasons }) as WeeklyExecutionTask;
test('company/market diagnostics attach to proposition and copy only; no unrelated collection or customer gate', () => {
  for (const step of ['benchmark_collection', 'benchmark_scoring', 'director_analysis', 'customer_channel_readiness', 'customer_inquiry_handoff']) assert.deepEqual(weeklyTaskRequirements(task(step), profile), [], step);
  const source = task('script'), before = structuredClone(source);
  const result = weeklyTaskRequirements(source, profile);
  assert.deepEqual(result.map(r => r.code), ['business_identity_incomplete', 'target_market_incomplete']);
  assert.ok(result.every(r => r.diagnosticOnly && r.sourceVersion === 'original-facts-v23' && r.action === 'enterprise_company'));
  assert.deepEqual(source, before, 'diagnostics cannot manufacture runtime blocking reasons');
});
test('local media advice is scoped to material preparation, never assumes missing rights from absent files', () => {
  assert.deepEqual(weeklyTaskRequirements(task('material_preparation'), profile).map(r => r.code), ['local_product_media_not_registered']);
  assert.deepEqual(weeklyTaskRequirements(task('video_generation'), profile), []);
  const withMedia = structuredClone(profile);withMedia.products.items![0]!.images = [{ url: '/actual-owned-image.jpg' } as never];
  assert.deepEqual(weeklyTaskRequirements(task('material_readiness'), withMedia), []);
  assert.deepEqual(weeklyTaskRequirements(task('asset_generation', ['material_rights_required']), withMedia).map(r => r.code), ['current_material_rights_required']);
  assert.deepEqual(weeklyTaskRequirements({ ...task('script'), status: 'succeeded' }, profile), []);
});
