import assert from 'node:assert/strict';
import { TikTokExecutionAdapter, validateTikTokVideoPlan } from './tiktokExecutionAdapter.js';
import { AdProviderError } from './metaAdapter.js';
const calls: Array<{ url: string; body: any }> = [];
const mock = (async (url: any, init: any) => {
  const body = init.body ? JSON.parse(init.body) : {};
  calls.push({ url: String(url), body });
  const data = String(url).includes('/campaign/create/') ? { campaign_id: '1' } : String(url).includes('/adgroup/create/') ? { adgroup_id: '2' } : { ad_ids: ['3'] };
  return Response.json({ code: 0, data });
}) as typeof fetch;
const plan = { advertiserId: '10', name: 'Video', totalBudget: 200, locationIds: ['6252001'], startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString(), identityId: '12', tiktokItemId: '13', adText: 'Test' };
assert.throws(() => validateTikTokVideoPlan({ ...plan, startsAt: '2020-01-01T00:00:00Z' }), /过期/);
const created: string[] = [];
const result = await new TikTokExecutionAdapter('private-token', mock).createPaused(plan, async (_kind, id) => { created.push(id); });
assert.deepEqual(result, { campaignId: '1', adgroupId: '2', adId: '3' });
assert.deepEqual(created, ['1', '2', '3']);
assert.ok(calls.every(call => call.body.operation_status === 'DISABLE'));
assert.ok(calls.every(call => !call.url.includes('private-token')));
assert.equal(calls[0].body.objective_type, 'VIDEO_VIEWS');
assert.equal(calls[1].body.optimization_goal, 'ENGAGED_VIEW');
assert.equal(calls[1].body.billing_event, 'CPV');
assert.equal(calls[1].body.budget_mode, 'BUDGET_MODE_TOTAL');
assert.equal(calls[2].body.creatives[0].identity_type, 'TT_USER');
let writeFences = 0;
const guardedResult = await new TikTokExecutionAdapter('private-token', mock, async () => { writeFences += 1; })
  .createPaused(plan, async () => undefined);
assert.equal(guardedResult.adId, '3');
assert.equal(writeFences, 3, 'every TikTok create mutation is fenced separately');
let campaignStatus = 'DISABLE';
const statusAdapter = new TikTokExecutionAdapter('private-token', (async (url: any, init: any) => {
  if (init.method === 'POST') { campaignStatus = JSON.parse(init.body).operation_status; return Response.json({ code: 0, data: {} }); }
  return Response.json({ code: 0, data: { list: [{ campaign_id: '1', advertiser_id: '10', operation_status: campaignStatus }] } });
}) as typeof fetch);
assert.equal((await statusAdapter.setStatus('10', 'campaign', '1', 'ENABLE')).operation_status, 'ENABLE');
await assert.rejects(statusAdapter.setStatus('11', 'campaign', '1', 'DISABLE'), /不属于/);
let changed = false;
const uncertain = new TikTokExecutionAdapter('token', (async (_url: any, init: any) => {
  if (init.method === 'POST') { changed = true; return Response.json({ code: 0, data: {} }); }
  if (changed) return Response.json({ code: 40001 }, { status: 403 });
  return Response.json({ code: 0, data: { list: [{ campaign_id: '1', advertiser_id: '10', operation_status: 'DISABLE' }] } });
}) as typeof fetch);
await assert.rejects(uncertain.setStatus('10', 'campaign', '1', 'ENABLE'), (error: unknown) => error instanceof AdProviderError && error.uncertain);
console.log('TikTok execution adapter contract tests passed');
