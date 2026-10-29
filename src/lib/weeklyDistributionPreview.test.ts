import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyPackage } from './weeklyPackage';
import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan';
import { weeklyDistributionPreview } from './weeklyDistributionPreview';
const packOf = (plans: Partial<VideoCreationPlan>[]) => ({ tasks: [{ templateId: 'production', videoPlans: plans }] } as WeeklyPackage);

test('legacy weekly plans without mixed slots get cards spread across all seven days', () => {
  const pack = packOf(Array.from({ length: 16 }, (_, i) => ({ contentId: `v${i}`, platform: 'youtube', plannedPublishDate: '2026-10-17' })));
  const before = JSON.stringify(pack);
  const rows = weeklyDistributionPreview(pack, '2026-10-11', '2026-10-17');
  assert.equal(rows.length, 16);
  assert.deepEqual([...new Set(rows.map(row => row.date))], ['2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17']);
  assert.deepEqual(new Set(rows.map(row => row.platform)), new Set(['facebook', 'linkedin']));
  const counts = [...new Set(rows.map(row => row.date))].map(date => rows.filter(row => row.date === date).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.equal(JSON.stringify(pack), before, 'preview must not rewrite frozen publish dates');
});

test('mixed adaptations retain the original thumbnail and publication title', () => {
  const pack = packOf([{ contentId: 'v1', publication: { title: '产品演示', caption: '', tags: [], status: 'planned', generatedBy: 'business_agent' }, referenceId: 'ref-1' }]);
  pack.mixedContentSlots = [
    { slotId: 'fb', originalSlotId: 'fb', kind: 'video', platform: 'facebook', accountId: 'a', productionRole: 'original', presentation: 'video' },
    { slotId: 'li', originalSlotId: 'fb', kind: 'video', platform: 'linkedin', accountId: 'b', productionRole: 'adaptation', presentation: 'video' },
  ];
  const rows = weeklyDistributionPreview(pack, '2026-10-11', '2026-10-17');
  assert.ok(rows.every(row => row.title === '产品演示' && row.thumbnail === '/api/overseas/videos/ref-1/thumbnail'));
  assert.equal(rows[0]!.date, '2026-10-12');
  assert.equal(rows[1]!.date, '2026-10-16');
});

test('missing references stay explicit and longer plans never extend this preview beyond day seven', () => {
  const rows = weeklyDistributionPreview(packOf([{ contentId: 'one', platform: 'facebook' }]), '2026-10-11', '2026-10-31');
  assert.equal(rows[0]!.thumbnail, '');
  assert.match(rows[0]!.title, /待确认/);
  assert.ok(rows[0]!.date >= '2026-10-11' && rows[0]!.date <= '2026-10-17');
  assert.deepEqual(weeklyDistributionPreview(undefined, '2026-10-11', '2026-10-17'), []);
});
