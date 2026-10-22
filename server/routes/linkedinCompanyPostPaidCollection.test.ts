import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  frozenLinkedInCompanyActorInput,
  runLinkedInCompanyPaidCollection,
  type LinkedInCompanyCollectionScope,
  type LinkedInCompanyPaidPermit,
} from './linkedinCompanyPostPaidCollection.js';
import { APIFY_PAID_RAW_RECEIPT_MAX_BYTES } from './apifyPaidTikTokTransport.js';
import { apifyTokenFingerprint, APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME } from '../socialDiscovery/apifyTokenFingerprint.js';

const scope: LinkedInCompanyCollectionScope = {
  tenantId: 'tenant-a', runId: 'discovery-run-a',
  companyUrl: 'https://www.linkedin.com/company/factory/', limit: 3,
  dateFrom: '', dateTo: '',
};
const actorId = 'logical_scrapers/linkedin-company-posts-scraper';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function permit(overrides: Partial<LinkedInCompanyPaidPermit> = {}): LinkedInCompanyPaidPermit {
  return {
    operationId: 'linkedin-company:discovery-run-a', actorId, maxTotalChargeUsd: 0.5,
    scope, actorInputSha256: hash(frozenLinkedInCompanyActorInput(scope)),
    tokenFingerprint: apifyTokenFingerprint('test-token', APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME),
    async assertApproved() {},
    async inspect() { return { status: 'reserved' }; },
    async beforeSubmit() {}, async recordRun() {}, async recordTerminal() {},
    async beforeDatasetRead() {},
    async persistRawReceipt() { return 'isolated-receipt'; },
    ...overrides,
  };
}

test('frozen LinkedIn company request rejects search, lookalike hosts and unbounded sources', () => {
  assert.deepEqual(frozenLinkedInCompanyActorInput(scope), {
    startUrls: [{ url: scope.companyUrl }], maxItems: 3,
    proxyConfiguration: { useApifyProxy: true },
  });
  for (const companyUrl of ['https://linkedin.com.evil.test/company/factory/',
    'https://www.linkedin.com/posts/factory_activity-123', 'http://www.linkedin.com/company/factory/',
    'https://www.linkedin.com/company/factory/?redirect=evil']) {
    assert.throws(() => frozenLinkedInCompanyActorInput({ ...scope, companyUrl }),
      /linkedin_company_collection_scope_invalid/);
  }
  assert.throws(() => frozenLinkedInCompanyActorInput({ ...scope, limit: 31 }),
    /linkedin_company_collection_scope_invalid/);
});

test('missing, mismatched and unapproved permits make zero provider requests', async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('network_forbidden'); };
  try {
    const base = { scope, actorId, token: 'test-token' };
    await assert.rejects(runLinkedInCompanyPaidCollection(base), /permit_required/);
    await assert.rejects(runLinkedInCompanyPaidCollection({ ...base,
      permit: permit({ persistRawReceipt: undefined as never }) }), /scope_mismatch/);
    await assert.rejects(runLinkedInCompanyPaidCollection({ ...base,
      permit: permit({ scope: { ...scope, tenantId: 'tenant-b' } }) }), /scope_mismatch/);
    await assert.rejects(runLinkedInCompanyPaidCollection({ ...base,
      permit: permit({ actorInputSha256: '0'.repeat(64) }) }), /scope_mismatch/);
    await assert.rejects(runLinkedInCompanyPaidCollection({ ...base,
      permit: permit({ tokenFingerprint: '0'.repeat(64) }) }), /token_changed/);
    await assert.rejects(runLinkedInCompanyPaidCollection({ ...base,
      permit: permit({ async assertApproved() { throw Error('approval_revoked'); } }) }), /approval_revoked/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('internal image and video entry points propagate revoked approval without provider calls', async () => {
  const { crawlImagePostsForTenant, crawlVideosForTenant } = await import('./videos.js');
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('network_forbidden'); };
  const revoked = permit({ async assertApproved() { throw Error('approval_revoked'); } });
  try {
    await assert.rejects(crawlImagePostsForTenant({ tenantId: scope.tenantId,
      platform: 'linkedin', mode: 'account', accountUrl: scope.companyUrl, limit: scope.limit,
      linkedInPaidCollection: { runId: scope.runId, permit: revoked } }), /approval_revoked/);
    await assert.rejects(crawlVideosForTenant({ tenantId: scope.tenantId,
      platform: 'linkedin', mode: 'account', accountUrl: scope.companyUrl, limit: scope.limit,
      discoveryContext: { runId: scope.runId, scopeId: 'scope-a', scopeVersion: 1,
        mode: 'account', queryRef: scope.companyUrl }, linkedInPaidPermit: revoked }), /approval_revoked/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('approved offline transport records Actor run and separate dataset-read permission', async () => {
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  let state: Awaited<ReturnType<LinkedInCompanyPaidPermit['inspect']>> = { status: 'reserved' };
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    calls.push(`${init?.method || 'GET'} ${url.pathname}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    if (init?.method === 'POST') return new Response(JSON.stringify({ data: {
      id: 'run-a', defaultDatasetId: 'dataset-a', status: 'READY',
    } }), { status: 200 });
    if (url.pathname.endsWith('/actor-runs/run-a')) return new Response(JSON.stringify({ data: {
      id: 'run-a', defaultDatasetId: 'dataset-a', status: 'SUCCEEDED', usageTotalUsd: 0.2,
      options: { maxTotalChargeUsd: 0.5, restartOnError: false },
    } }), { status: 200 });
    if (url.pathname.endsWith('/datasets/dataset-a/items')) return new Response(JSON.stringify([
      { postUrl: 'https://www.linkedin.com/posts/factory_activity-123', text: 'Factory #B2B',
        images: ['https://media.example.test/photo.jpg'] },
    ]), { status: 200 });
    throw Error('unexpected_request');
  };
  try {
    const approved = permit({
      async inspect() { return state; },
      async beforeSubmit() { state = { status: 'submitted_unknown' }; },
      async recordRun({ runId, datasetId, rawReceiptRef }) {
        assert.equal(rawReceiptRef, 'receipt:actor_submit');
        state = { status: 'submitted_known', runId, datasetId };
      },
      async recordTerminal({ runId, usageTotalUsd, rawReceiptRef }) {
        assert.equal(rawReceiptRef, 'receipt:actor_poll');
        assert.ok(calls.includes('receipt:actor_poll'));
        state = { status: 'completed', runId, datasetId: 'dataset-a', usageTotalUsd };
      },
      async beforeDatasetRead({ maxItems }) { assert.equal(maxItems, 3); calls.push('dataset-approved'); },
      async persistRawReceipt({ phase, httpStatus, responseBody }) {
        assert.equal(httpStatus, 200);
        assert.ok(responseBody.length > 0);
        calls.push(`receipt:${phase}`);
        return `receipt:${phase}`;
      },
    });
    const result = await runLinkedInCompanyPaidCollection({ scope, actorId, token: 'test-token',
      permit: approved, settlementDelayMs: 0 });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0]?.caption, 'Factory #B2B');
    assert.equal(result.videos.length, 0);
    assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
    assert.ok(calls.indexOf('dataset-approved') < calls.findIndex(call => call.includes('/datasets/')));
    assert.ok(calls.includes('receipt:dataset_read'));
  } finally { globalThis.fetch = oldFetch; }
});

test('approval changed after admission prevents the paid POST', async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  let checks = 0;
  globalThis.fetch = async () => { requests++; throw Error('network_forbidden'); };
  try {
    await assert.rejects(runLinkedInCompanyPaidCollection({ scope, actorId, token: 'test-token',
      permit: permit({ async assertApproved() {
        if (++checks === 2) throw Error('approval_revoked');
      } }),
    }), /approval_revoked/);
    assert.equal(checks, 2);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('missing durable raw receipt leaves a submitted Actor unknown and forbids replay', async () => {
  const oldFetch = globalThis.fetch;
  let posts = 0;
  let state: Awaited<ReturnType<LinkedInCompanyPaidPermit['inspect']>> = { status: 'reserved' };
  globalThis.fetch = async (_request, init) => {
    if (init?.method !== 'POST') throw Error('unexpected_read');
    posts += 1;
    return new Response(JSON.stringify({ data: { id: 'run-a', defaultDatasetId: 'dataset-a' } }), { status: 200 });
  };
  const unreceipted = permit({
    async inspect() { return state; },
    async beforeSubmit() { state = { status: 'submitted_unknown' }; },
    async persistRawReceipt() { throw Error('receipt_storage_unavailable'); },
    async recordRun() { throw Error('record_run_must_not_happen'); },
  });
  try {
    const input = { scope, actorId, token: 'test-token', permit: unreceipted };
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /receipt_storage_unavailable/);
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /apify_paid_submission_unknown_no_replay/);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test('empty Actor receipt reference leaves the submitted operation unknown and forbids replay', async () => {
  const oldFetch = globalThis.fetch;
  let posts = 0;
  let state: Awaited<ReturnType<LinkedInCompanyPaidPermit['inspect']>> = { status: 'reserved' };
  globalThis.fetch = async (_request, init) => {
    if (init?.method !== 'POST') throw Error('unexpected_read');
    posts += 1;
    return new Response(JSON.stringify({ data: { id: 'run-a', defaultDatasetId: 'dataset-a' } }), { status: 200 });
  };
  const unreceipted = permit({
    async inspect() { return state; },
    async beforeSubmit() { state = { status: 'submitted_unknown' }; },
    async persistRawReceipt() { return ''; },
    async recordRun() { throw Error('record_run_must_not_happen'); },
  });
  try {
    const input = { scope, actorId, token: 'test-token', permit: unreceipted };
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /raw_receipt_ref_required/);
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /apify_paid_submission_unknown_no_replay/);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test('empty terminal poll receipt cannot settle or start a dataset read', async () => {
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  let state: Awaited<ReturnType<LinkedInCompanyPaidPermit['inspect']>> = { status: 'reserved' };
  globalThis.fetch = async (request, init) => {
    const path = new URL(String(request)).pathname;
    calls.push(`${init?.method || 'GET'} ${path}`);
    if (init?.method === 'POST') return new Response(JSON.stringify({ data: {
      id: 'run-a', defaultDatasetId: 'dataset-a',
    } }), { status: 200 });
    if (path.endsWith('/actor-runs/run-a')) return new Response(JSON.stringify({ data: {
      id: 'run-a', defaultDatasetId: 'dataset-a', status: 'SUCCEEDED', usageTotalUsd: 0.2,
      options: { maxTotalChargeUsd: 0.5, restartOnError: false },
    } }), { status: 200 });
    throw Error('dataset_read_must_not_happen');
  };
  const unreceipted = permit({
    async inspect() { return state; },
    async beforeSubmit() { state = { status: 'submitted_unknown' }; },
    async recordRun({ runId, datasetId, rawReceiptRef }) {
      assert.equal(rawReceiptRef, 'submit-receipt');
      state = { status: 'submitted_known', runId, datasetId };
    },
    async persistRawReceipt({ phase }) { return phase === 'actor_submit' ? 'submit-receipt' : ''; },
    async recordTerminal() { throw Error('terminal_record_must_not_happen'); },
    async beforeDatasetRead() { throw Error('dataset_read_must_not_happen'); },
  });
  try {
    const input = { scope, actorId, token: 'test-token', permit: unreceipted, settlementDelayMs: 0 };
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /raw_receipt_ref_required/);
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /raw_receipt_ref_required/);
    assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
    assert.equal(calls.some(call => call.includes('/datasets/')), false);
  } finally { globalThis.fetch = oldFetch; }
});

test('oversized Actor response is stopped before raw receipt write and cannot be resubmitted', async () => {
  const oldFetch = globalThis.fetch;
  let posts = 0;
  let receipts = 0;
  let state: Awaited<ReturnType<LinkedInCompanyPaidPermit['inspect']>> = { status: 'reserved' };
  globalThis.fetch = async (_request, init) => {
    if (init?.method !== 'POST') throw Error('unexpected_read');
    posts += 1;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(APIFY_PAID_RAW_RECEIPT_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    }), { status: 200 });
  };
  const bounded = permit({
    async inspect() { return state; },
    async beforeSubmit() { state = { status: 'submitted_unknown' }; },
    async persistRawReceipt() { receipts += 1; return 'unexpected'; },
    async recordRun() { throw Error('record_run_must_not_happen'); },
  });
  try {
    const input = { scope, actorId, token: 'test-token', permit: bounded };
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /apify_paid_raw_receipt_too_large/);
    await assert.rejects(runLinkedInCompanyPaidCollection(input), /apify_paid_submission_unknown_no_replay/);
    assert.equal(posts, 1);
    assert.equal(receipts, 0);
    assert.equal(state.status, 'submitted_unknown');
  } finally { globalThis.fetch = oldFetch; }
});

test('approval changed after Actor completion prevents dataset read', async () => {
  const oldFetch = globalThis.fetch;
  let checks = 0;
  const paths: string[] = [];
  globalThis.fetch = async (request, init) => {
    const path = new URL(String(request)).pathname;
    paths.push(`${init?.method || 'GET'} ${path}`);
    if (init?.method === 'POST') return new Response(JSON.stringify({ data: {
      id: 'run-a', defaultDatasetId: 'dataset-a', status: 'READY',
    } }), { status: 200 });
    if (path.endsWith('/actor-runs/run-a')) return new Response(JSON.stringify({ data: {
      id: 'run-a', defaultDatasetId: 'dataset-a', status: 'SUCCEEDED', usageTotalUsd: 0.2,
      options: { maxTotalChargeUsd: 0.5, restartOnError: false },
    } }), { status: 200 });
    throw Error('unexpected_request');
  };
  try {
    await assert.rejects(runLinkedInCompanyPaidCollection({ scope, actorId, token: 'test-token',
      permit: permit({ async assertApproved() {
        if (++checks === 3) throw Error('approval_revoked');
      } }), settlementDelayMs: 0,
    }), /approval_revoked/);
    assert.equal(checks, 3);
    assert.equal(paths.filter(path => path.startsWith('POST')).length, 1);
    assert.equal(paths.some(path => path.includes('/datasets/')), false);
  } finally { globalThis.fetch = oldFetch; }
});
