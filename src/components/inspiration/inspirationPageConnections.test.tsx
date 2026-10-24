import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readCompetitorAccounts } from '../../lib/competitorAccountsApi';
import { readScriptGapTasks } from '../../lib/scriptGapQueue';
import { pendingShootingTaskCount } from './inspirationShootingNeeds';
import { InspirationShootingPanel } from './InspirationShootingPanel';
import type { ScriptGapTask } from '../../lib/scriptGapQueue';
import { inspirationViewFromSearch } from './inspirationDashboardContracts';
import { useInspirationDiscoveryInventory } from './useInspirationDiscoveryInventory';

test('all inspiration tabs restore their own URL entry after reload', () => {
  for (const view of ['inspiration', 'accounts', 'library', 'shooting'] as const) assert.equal(inspirationViewFromSearch(`?view=${view}`), view);
  assert.equal(inspirationViewFromSearch('?view=unknown'), 'inspiration');
});

function storage(t: import('node:test').TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); });
}

test('failed account list is an error, never a fabricated empty successful list', async t => {
  storage(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'offline' }, { status: 503 }));
  await assert.rejects(readCompetitorAccounts(), /offline/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
  assert.deepEqual(await readCompetitorAccounts(), []);
});

test('task reader rejects malformed payloads and normalizes legacy upload lists', async t => {
  storage(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
  await assert.rejects(readScriptGapTasks(), /返回格式/);
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ id: 'task', title: '补拍' }]));
  assert.deepEqual((await readScriptGapTasks())[0].uploadedMaterialIds, []);
});

test('discovery tab total includes videos and images even when refreshing a single-format view', async t => {
  storage(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  const formats: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const format = new URL(String(input), 'http://localhost').searchParams.get('contentFormat')!;
    formats.push(format);
    return Response.json({ visibleItems: format === 'video' ? 5 : 8 });
  });
  let state!: ReturnType<typeof useInspirationDiscoveryInventory>;
  renderToStaticMarkup(createElement(() => { state = useInspirationDiscoveryInventory({ innerView: 'inspiration', setSelectedVideo: () => {}, setMaterialMessage: () => {} }); return null; }));
  assert.equal(await state.refreshInventory('video'), 13);
  assert.deepEqual(formats.sort(), ['image', 'video']);
});

test('uploaded task remains reachable for storyboard review but is not counted as pending filming', () => {
  const tasks = [{ id: 'task', title: '补拍', createdAt: '2026-10-24', uploadedMaterialIds: ['video'], sourceProjectId: 'original', soundMode: 'silent' }] as ScriptGapTask[];
  assert.equal(pendingShootingTaskCount(tasks), 0);
  const markup = renderToStaticMarkup(<InspirationShootingPanel needs={[]} scriptGapTasks={tasks} materialCount={1} uploadingMaterial={false}
    error="服务暂不可用" onRetry={() => {}} bindingRetry onRetryBinding={() => {}} onUploadExisting={() => {}} onCaptureStart={() => {}} onUploadCaptured={() => {}} />);
  assert.match(markup, /已补充素材/); assert.match(markup, /返回分镜/); assert.match(markup, /project=original/);
  assert.match(markup, /此镜头无声/); assert.match(markup, /重试读取/); assert.match(markup, /重试关联/);
  assert.doesNotMatch(markup, /当前筛选下没有待拍任务/);
});
