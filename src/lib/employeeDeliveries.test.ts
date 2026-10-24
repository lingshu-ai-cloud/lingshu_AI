import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import type { DeliveryResource } from './delivery';
import { employeeVideoDeliveries, nextEmployeeVideoIndex } from './employeeDeliveries';

const delivery = (overrides: Partial<DeliveryResource> = {}): DeliveryResource => ({
  id: 'studio_project:project', runId: 'run', taskIds: ['task'], taskId: 'task', title: '实际视频', subject: '产品', kind: '内容成片', acceptance: '', stage: '待验收', column: 'human', reason: '', exception: false,
  updatedAt: '2026-10-24T01:00:00Z', artifacts: [{ id: 'video', kind: 'video', label: '成片', url: '/api/overseas/files/final.mp4' }], steps: [], metrics: [], actionLabel: '查看项目', effect: '尚未发布', ...overrides,
});
const overview = (deliveries: DeliveryResource[]): DigitalEmployeeOverview => ({ goal: { id: 'goal' }, plan: { id: 'plan' }, run: { id: 'run', goal_id: 'goal', plan_id: 'plan' }, deliveries } as DigitalEmployeeOverview);

test('only exact current run rendered video receipts appear; inspiration and scripts cannot become outputs', () => {
  const items = employeeVideoDeliveries(overview([
    delivery(), delivery({ id: 'old', runId: 'old-run' }), delivery({ id: 'ref', kind: '参考视频' }),
    delivery({ id: 'script', artifacts: [{ id: 'script', kind: 'text', text: '脚本', label: '脚本' }] }),
    delivery({ id: 'unsafe', artifacts: [{ id: 'unsafe', kind: 'video', label: '成片', url: 'javascript:alert(1)' }] }),
    delivery({ id: 'malformed', artifacts: [{ id: 'bad', kind: 'video', label: '成片', url: 'https://' }] }),
    delivery(),
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0].url, '/api/overseas/files/final.mp4');
  assert.equal(items[0].approved, false);
});

test('missing or changed weekly lineage cannot expose old run video outputs', () => {
  for (const overrides of [{ goal: null }, { plan: null }, { run: null }, { goal: { id: 'different' } }, { plan: { id: 'different' } }]) {
    assert.deepEqual(employeeVideoDeliveries({ ...overview([delivery()]), ...overrides } as DigitalEmployeeOverview), []);
  }
});

test('rendering, machine quality and human acceptance remain separate evidence', () => {
  const items = employeeVideoDeliveries(overview([
    delivery({ id: 'review', contentApproval: { hash: 'h', approved: false } }),
    delivery({ id: 'accepted', artifacts: [{ id: 'video', kind: 'video', label: '成片', url: '/accepted.mp4' }], contentApproval: { hash: 'h2', approved: true } }),
    delivery({ id: 'failed', artifacts: [{ id: 'video', kind: 'video', label: '质检失败样片', url: '/failed.mp4' }], reason: '质检失败' }),
  ]));
  assert.equal(items[0].needsReview, true);
  assert.equal(items[1].approved, true);
  assert.equal(items[2].status, '质检失败样片');
  assert.equal(items[2].needsReview, false);
  assert.equal(items[2].reason, '质检失败');
});

test('shared rendered output is deduplicated across delivery records and refreshed signatures, keeping distinct versions', () => {
  const output = (id: string, url: string) => delivery({ id, artifacts: [{ id: 'video', kind: 'video', label: '成片', url }] });
  const items = employeeVideoDeliveries(overview([
    output('one', '/final.mp4?assetToken=old&version=1'),
    output('shared', '/final.mp4?assetToken=new&version=1'),
    output('new-version', '/final.mp4?assetToken=new&version=2'),
    output('other-path', '/other/final.mp4?assetToken=new&version=1'),
  ]));
  assert.equal(items.length, 3);
});

test('vertical feed navigation stops at boundaries, preserving stable ordering', () => {
  assert.equal(nextEmployeeVideoIndex(0, -120, 3), 0);
  assert.equal(nextEmployeeVideoIndex(0, 120, 3), 1);
  assert.equal(nextEmployeeVideoIndex(2, 120, 3), 2);
  assert.equal(nextEmployeeVideoIndex(1, -1, 3), 0);
  assert.equal(nextEmployeeVideoIndex(0, 1, 0), 0);
});
