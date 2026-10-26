import assert from 'node:assert/strict';
import test from 'node:test';
import { MetaAdsAdapter, validateMetaVideoInput } from './metaAdapter.js';
import { assertPausedMetaVideoPlan, readMetaVideoPlan } from './metaPlanReadback.js';
import { aggregateAdMetrics } from './metrics.js';
process.env.META_ADS_API_VERSION = 'v25.0';
const base = { pageId: '1', videoId: '2', imageUrl: 'https://example.com/cover.jpg', linkUrl: 'https://example.com/inquiry', message: 'Request quote', countries: ['US'], dailyBudget: 5 };
const cases = [
  { goal: '获取消息会话', extra: { messageDestination: 'WHATSAPP', whatsappPhoneNumber: '+8613800138000' }, objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', destination: 'WHATSAPP' },
  { goal: '获取消息会话', extra: { messageDestination: 'MESSENGER' }, objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', destination: 'MESSENGER' },
  { goal: '获取消息会话', extra: { messageDestination: 'INSTAGRAM_DIRECT', instagramActorId: '7', instagramUsername: 'factory' }, objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', destination: 'INSTAGRAM_DIRECT' },
  { goal: '获取Meta表单线索', extra: { leadFormId: '3' }, objective: 'OUTCOME_LEADS', optimization: 'LEAD_GENERATION', destination: 'ON_AD' },
  { goal: '获取独立站询盘', extra: { pixelId: '4' }, objective: 'OUTCOME_LEADS', optimization: 'OFFSITE_CONVERSIONS', destination: 'WEBSITE' },
];
for (const item of cases) test(`${item.goal}/${item.destination}: create paused hierarchy, verify destination, reject drift`, async () => {
  const saved: Record<string, any> = {}; let writes = 0; let available = true;
  const transport = (async (url: any, options: any) => {
    const u = new URL(String(url)), edge = u.pathname.split('/').pop()!;
    if (u.searchParams.get('fields') === 'id,access_token') return Response.json({ id: '1', access_token: 'page-token' });
    if (options?.method === 'POST') {
      const id = String(100 + ++writes), data: Record<string, any> = Object.fromEntries(new URLSearchParams(options.body));
      for (const k of ['promoted_object', 'creative', 'object_story_spec', 'targeting']) if (data[k]) data[k] = JSON.parse(data[k]);
      if (data.creative) data.creative = { id: data.creative.creative_id };
      saved[id] = { ...data, id, account_id: '5' }; return Response.json({ id });
    }
    if (edge === 'leadgen_forms') return Response.json({ data: available ? [{ id: '3', status: 'ACTIVE' }] : [] });
    if (edge === 'adspixels') return Response.json({ data: available ? [{ id: '4' }] : [] });
    if (edge === '1') return Response.json({ id: '1', leadgen_tos_accepted: true, whatsapp_number: available ? '+8613800138000' : '999', instagram_business_account: { id: available ? '7' : '8', username: 'factory' } });
    return Response.json(saved[edge]);
  }) as typeof fetch;
  const adapter = new MetaAdsAdapter('account-token', transport);
  const input = validateMetaVideoInput({ ...base, ...item.extra }, 100, item.goal);
  const ids = await adapter.createPausedVideoTraffic('5', 'Lead test', input, 100, async () => {}, item.goal, ['Facebook']);
  assert.equal(writes, 4);
  assert.equal(saved[ids.campaignId].objective, item.objective);
  assert.equal(saved[ids.adsetId].optimization_goal, item.optimization);
  assert.equal(saved[ids.adsetId].destination_type, item.destination);
  for (const id of [ids.campaignId, ids.adsetId, ids.adId]) assert.equal(saved[id].status, 'PAUSED');
  if (item.goal === '获取Meta表单线索') assert.equal(saved[ids.creativeId].object_story_spec.video_data.call_to_action.value.lead_gen_form_id, '3');
  if (item.goal === '获取独立站询盘') assert.deepEqual(saved[ids.adsetId].promoted_object, { pixel_id: '4', custom_event_type: 'LEAD' });
  const snapshot = await readMetaVideoPlan(adapter, '5', ids);
  assertPausedMetaVideoPlan(snapshot, input, 100, item.goal, ['Facebook']);
  if (item.goal === '获取独立站询盘') snapshot.adset.promoted_object.pixel_id = '999';
  else if (item.goal === '获取Meta表单线索') snapshot.creative.object_story_spec.video_data.call_to_action.value.lead_gen_form_id = '999';
  else snapshot.adset.destination_type = 'WEBSITE';
  assert.throws(() => assertPausedMetaVideoPlan(snapshot, input, 100, item.goal, ['Facebook']), /读回/);
  if (item.destination !== 'MESSENGER') {
    available = false;
    await assert.rejects(adapter.createPausedVideoTraffic('5', 'Denied', input, 100, async () => {}, item.goal), /表单|Pixel|消息目的地/);
    assert.equal(writes, 4, 'unavailable assets must block before the first write');
  }
});
test('lead goals require their own fields and HTTPS website; traffic is not a substitute', () => {
  for (const goal of ['获取消息会话', '获取Meta表单线索', '获取独立站询盘']) assert.throws(() => validateMetaVideoInput(base, 100, goal));
  assert.throws(() => validateMetaVideoInput({ ...base, pixelId: '4', linkUrl: 'http://example.com' }, 100, '获取独立站询盘'));
  assert.equal(validateMetaVideoInput({ ...base, linkUrl: '', leadFormId: '3' }, 100, '获取Meta表单线索').leadFormId, '3');
  assert.throws(() => validateMetaVideoInput({ ...base, messageDestination: 'WHATSAPP', whatsappPhoneNumber: 'bad' }, 100, '获取消息会话'));
});
test('lead creation does not require or retain business handoff information', () => {
  for (const item of cases) {
    const input = validateMetaVideoInput({ ...base, ...item.extra }, 100, item.goal);
    assert.equal(Object.hasOwn(input, 'leadHandoff'), false);
    const legacyInput = validateMetaVideoInput({ ...base, ...item.extra, leadHandoff: { owner: 'Legacy entry', confirmed: false } }, 100, item.goal);
    assert.deepEqual(legacyInput, input, 'old client business details are ignored instead of collected or used as a gate');
  }
});
test('reporting keeps conversations, form leads and website Lead events separate', () => {
  const actions = [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }, { action_type: 'onsite_conversion.lead_grouped', value: '5' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' }, { action_type: 'lead', value: '12' }];
  for (const [goal, expected] of [['获取消息会话', 3], ['获取Meta表单线索', 5], ['获取独立站询盘', 7]] as const) {
    assert.equal(aggregateAdMetrics([{ spend: '21', inline_link_clicks: '99', actions }], goal).results, expected);
    assert.equal(aggregateAdMetrics([{ inline_link_clicks: '99', actions: [] }], goal).results, null);
  }
});

test('instant form terms are read-only and must be accepted before creating hierarchy', async () => {
  let writes = 0;
  const adapter = new MetaAdsAdapter('account-token', (async (_url, init) => {
    if (init?.method === 'POST') writes++;
    return Response.json({ id: '1', access_token: 'page-token', leadgen_tos_accepted: false });
  }) as typeof fetch);
  await assert.rejects(adapter.createPausedVideoTraffic('5', 'Terms', validateMetaVideoInput({ ...base, leadFormId: '3' }, 100, '获取Meta表单线索'), 100, async () => {}, '获取Meta表单线索'), /条款/);
  assert.equal(writes, 0);
});
