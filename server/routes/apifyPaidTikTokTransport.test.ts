import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPaidApifyTikTokDataset, type PaidApifyTikTokPermit } from './apifyPaidTikTokTransport.js';
import {createHash} from 'node:crypto';
import {frozenWeeklyAccountFiveVideoActorInput} from '../socialDiscovery/weeklyAccountCollectionBudget.js';

type PermitState = Awaited<ReturnType<PaidApifyTikTokPermit['inspect']>>;

function fixture(initial: PermitState = { status: 'reserved' }) {
  let state = initial;
  const calls: string[] = [];
  const permit: PaidApifyTikTokPermit = {
    operationId: 'op-1', actorId: 'clockworks/tiktok-scraper', maxTotalChargeUsd: 0.2,
    async inspect({ actorId, requestHash, maxTotalChargeUsd }) {
      calls.push('inspect');
      assert.equal(actorId, permit.actorId);
      assert.match(requestHash, /^[a-f0-9]{64}$/);
      assert.equal(maxTotalChargeUsd, permit.maxTotalChargeUsd);
      return state;
    },
    async beforeSubmit({ actorId, requestHash, maxTotalChargeUsd }) {
      calls.push('before');
      assert.equal(actorId, permit.actorId);
      assert.match(requestHash, /^[a-f0-9]{64}$/);
      assert.equal(maxTotalChargeUsd, 0.2);
      state = { status: 'submitted_unknown' };
    },
    async recordRun({ runId, datasetId, maxTotalChargeUsd }) {
      calls.push('recordRun');
      assert.equal(maxTotalChargeUsd, 0.2);
      state = { status: 'submitted_known', runId, datasetId };
    },
    async recordTerminal({ runId, status, usageTotalUsd }) {
      calls.push('terminal');
      assert.equal(runId, 'run1');
      assert.equal(status, 'SUCCEEDED');
      state = { status: 'completed', runId, datasetId: 'dataset1', usageTotalUsd };
    },
    async beforeDatasetRead({ runId, datasetId, maxItems }) {
      calls.push('datasetPermit');
      assert.equal(runId, 'run1');
      assert.equal(datasetId, 'dataset1');
      assert.equal(maxItems, 5);
    },
  };
  return { permit, calls, state: () => state };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const run = { id: 'run1', defaultDatasetId: 'dataset1', status: 'SUCCEEDED', usageTotalUsd: 0.07,
  options: { maxTotalChargeUsd: 0.2, restartOnError: false } };

test('one async POST, durable run receipt, authenticated GET recovery and no token in URL', async () => {
  const oldFetch = globalThis.fetch;
  const http: Array<{ method: string; url: URL }> = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    const method = String(init?.method || 'GET');
    http.push({ method, url });
    assert.equal(url.searchParams.has('token'), false);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret-test');
    if (method === 'POST') {
      assert.equal(url.pathname, '/v2/acts/clockworks%2Ftiktok-scraper/runs');
      assert.equal(url.searchParams.get('maxTotalChargeUsd'), '0.2');
      assert.equal(url.searchParams.get('restartOnError'), 'false');
      return response({ data: { id: 'run1', defaultDatasetId: 'dataset1', status: 'READY' } });
    }
    if (url.pathname.endsWith('/actor-runs/run1')) return response({ data: run });
    if (url.pathname.endsWith('/datasets/dataset1/items')) return response([{ id: 'video1' }]);
    throw Error(`unexpected ${url}`);
  };
  try {
    const f = fixture();
    const args = { actorId: f.permit.actorId, actorInput: { profiles: ['yuchengcosmeticsfactory'], resultsPerPage: 5 }, permit: f.permit, token: 'secret-test', maxItems: 5, settlementDelayMs: 0 };
    assert.deepEqual(await runPaidApifyTikTokDataset(args), [{ id: 'video1' }]);
    assert.deepEqual(f.calls, ['inspect', 'before', 'recordRun', 'terminal', 'datasetPermit']);
    assert.deepEqual(await runPaidApifyTikTokDataset(args), [{ id: 'video1' }]);
    assert.equal(http.filter(item => item.method === 'POST').length, 1);
    assert.equal(f.state().status, 'completed');
  } finally { globalThis.fetch = oldFetch; }
});

test('POST response loss is unknown and never retried', async () => {
  const oldFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async () => { posts++; throw Error('connection_lost'); };
  try {
    const f = fixture();
    const args = { actorId: f.permit.actorId, actorInput: { profiles: ['yuchen'] }, permit: f.permit, token: 'secret-test', maxItems: 5, settlementDelayMs: 0 };
    await assert.rejects(runPaidApifyTikTokDataset(args), /connection_lost/);
    await assert.rejects(runPaidApifyTikTokDataset(args), /apify_paid_submission_unknown_no_replay/);
    assert.equal(posts, 1);
    assert.equal(f.state().status, 'submitted_unknown');
  } finally { globalThis.fetch = oldFetch; }
});

test('permit rejection yields zero POST', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({}); };
  try {
    const f = fixture();
    f.permit.beforeSubmit = async () => { throw Error('budget_closed'); };
    await assert.rejects(runPaidApifyTikTokDataset({ actorId: f.permit.actorId, actorInput: {}, permit: f.permit, token: 'secret-test', maxItems: 5, settlementDelayMs: 0 }), /budget_closed/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('run cap, dataset and usage mismatches fail closed before dataset read', async () => {
  const oldFetch = globalThis.fetch;
  for (const bad of [
    { ...run, options: { maxTotalChargeUsd: 0.3, restartOnError: false } },
    { ...run, defaultDatasetId: 'other' },
    { ...run, usageTotalUsd: 0.3 },
    { ...run, usageTotalUsd: undefined },
  ]) {
    let datasetReads = 0;
    globalThis.fetch = async (request) => {
      if (String(request).includes('/datasets/')) datasetReads++;
      return response({ data: bad });
    };
    const f = fixture({ status: 'submitted_known', runId: 'run1', datasetId: 'dataset1' });
    await assert.rejects(runPaidApifyTikTokDataset({ actorId: f.permit.actorId, actorInput: {}, permit: f.permit, token: 'secret-test', maxItems: 5, settlementDelayMs: 0 }), /apify_paid_/);
    assert.equal(datasetReads, 0);
  }
  globalThis.fetch = oldFetch;
});

test('weekly TikTok account crawl cannot reach legacy sync Actor without a paid permit', async () => {
  const { crawlVideosForTenant } = await import('./videos.js');
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('network_must_not_be_used'); };
  try {
    await assert.rejects(crawlVideosForTenant({
      tenantId: 'tenant-test', platform: 'tiktok', mode: 'account',
      accountUrl: 'https://www.tiktok.com/@yuchengcosmeticsfactory', limit: 5,
      discoveryContext: { runId: 'run-test', scopeId: 'scope-test', scopeVersion: 3, mode: 'account', queryRef: 'account-test' },
    }), /weekly_preproduction_collection_paid_permit_required/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('original five-video context rejects legacy paid permit and second-download paths before network', async () => {
  const {crawlVideosForTenant,downloadVideoForAnalysis,isWeeklyOriginalAccountCollectionRecord}=await import('./videos.js');
  const accountUrl='https://www.tiktok.com/@yuchengcosmeticsfactory';
  const marker={originalRunKey:'weekly-preproduction:frozen-job',accountUrl,actorInputSha256:createHash('sha256').update(JSON.stringify(frozenWeeklyAccountFiveVideoActorInput(accountUrl))).digest('hex')};
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('legacy_network_forbidden');};
  try{
    await assert.rejects(crawlVideosForTenant({tenantId:'tenant-test',platform:'tiktok',mode:'account',accountUrl,limit:5,
      paidPermit:fixture().permit,discoveryContext:{runId:'run-test',scopeId:'scope-test',scopeVersion:3,mode:'account',queryRef:accountUrl,weeklyOriginalAccountCollection:marker}}),/weekly_preproduction_collection_original_transport_required/);
    await assert.rejects(crawlVideosForTenant({tenantId:'tenant-test',platform:'tiktok',mode:'account',accountUrl,limit:5,
      discoveryContext:{runId:'run-test',scopeId:'scope-test',scopeVersion:3,mode:'account',queryRef:accountUrl,weeklyOriginalAccountCollection:{...marker,actorInputSha256:'0'.repeat(64)}}}),/weekly_preproduction_collection_original_input_changed/);
    const record={aiAnalysis:JSON.stringify({discoveryOrigins:[{runId:'run-test',weeklyOriginalAccountCollection:marker}]})};
    assert.equal(isWeeklyOriginalAccountCollectionRecord(record),true);
    await assert.rejects(downloadVideoForAnalysis({record,sourceUrl:'https://www.tiktok.com/@yuchengcosmeticsfactory/video/7693862311907396877',title:'test',platform:'tiktok'}),/weekly_original_account_media_requires_same_run_kv/);
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});

test('successful Actor cannot read dataset without separate storage/transfer cost authority', async () => {
  const oldFetch = globalThis.fetch;
  const http: string[] = [];
  globalThis.fetch = async (request) => {
    const url = String(request);
    http.push(url);
    if (url.includes('/actor-runs/run1')) return response({ data: run });
    throw Error('dataset_must_not_be_read');
  };
  try {
    const f = fixture({ status: 'submitted_known', runId: 'run1', datasetId: 'dataset1' });
    f.permit.beforeDatasetRead = async () => { throw Error('weekly_preproduction_collection_dataset_cost_unverified'); };
    await assert.rejects(runPaidApifyTikTokDataset({
      actorId: f.permit.actorId, actorInput: { profiles: ['yuchengcosmeticsfactory'] },
      permit: f.permit, token: 'secret-test', maxItems: 5, settlementDelayMs: 0,
    }), /weekly_preproduction_collection_dataset_cost_unverified/);
    assert.equal(http.filter(url => url.includes('/datasets/')).length, 0);
    assert.equal(http.filter(url => url.includes('/runs?')).length, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('recovery of a completed run cannot silently repeat a billable dataset GET', async () => {
  const oldFetch = globalThis.fetch;
  let datasetReads = 0;
  let datasetPermits = 0;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes('/actor-runs/run1')) return response({ data: run });
    if (url.includes('/datasets/dataset1/items')) {
      datasetReads++;
      return response([{ id: 'video1' }]);
    }
    throw Error('unexpected_request');
  };
  try {
    const f = fixture({ status: 'completed', runId: 'run1', datasetId: 'dataset1', usageTotalUsd: 0.07 });
    f.permit.beforeDatasetRead = async () => {
      datasetPermits++;
      if (datasetPermits > 1) throw Error('weekly_preproduction_collection_dataset_reread_unreserved');
    };
    const args = { actorId: f.permit.actorId, actorInput: {}, permit: f.permit, token: 'secret-test', maxItems: 5, settlementDelayMs: 0 };
    assert.deepEqual(await runPaidApifyTikTokDataset(args), [{ id: 'video1' }]);
    await assert.rejects(runPaidApifyTikTokDataset(args), /dataset_reread_unreserved/);
    assert.equal(datasetReads, 1);
    assert.equal(datasetPermits, 2);
  } finally { globalThis.fetch = oldFetch; }
});
