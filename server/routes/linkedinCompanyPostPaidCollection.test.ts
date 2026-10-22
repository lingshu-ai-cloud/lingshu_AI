import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  frozenLinkedInCompanyActorInput,
  runLinkedInCompanyPaidCollection,
  type LinkedInCompanyCollectionScope,
  type LinkedInCompanyPaidPermit,
} from './linkedinCompanyPostPaidCollection.js';

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
    async assertApproved() {},
    async inspect() { return { status: 'reserved' }; },
    async beforeSubmit() {}, async recordRun() {}, async recordTerminal() {},
    async beforeDatasetRead() {},
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
      permit: permit({ scope: { ...scope, tenantId: 'tenant-b' } }) }), /scope_mismatch/);
    await assert.rejects(runLinkedInCompanyPaidCollection({ ...base,
      permit: permit({ actorInputSha256: '0'.repeat(64) }) }), /scope_mismatch/);
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
      async recordRun({ runId, datasetId }) { state = { status: 'submitted_known', runId, datasetId }; },
      async recordTerminal({ runId, usageTotalUsd }) {
        state = { status: 'completed', runId, datasetId: 'dataset-a', usageTotalUsd };
      },
      async beforeDatasetRead({ maxItems }) { assert.equal(maxItems, 3); calls.push('dataset-approved'); },
    });
    const result = await runLinkedInCompanyPaidCollection({ scope, actorId, token: 'test-token',
      permit: approved, settlementDelayMs: 0 });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0]?.caption, 'Factory #B2B');
    assert.equal(result.videos.length, 0);
    assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
    assert.ok(calls.indexOf('dataset-approved') < calls.findIndex(call => call.includes('/datasets/')));
  } finally { globalThis.fetch = oldFetch; }
});
