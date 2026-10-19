import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createWeeklyCtaOnlyLocalApp } from './weeklyCtaOnlyLocalServer.js';
import { prepareWeeklyEnterpriseFactFixture } from './weeklyEnterpriseFactSupplement.fixture.js';
import { bindWeeklyPreproductionAuthority } from './weeklyPreproductionProducer.js';
import { supplementConsumerHash } from '../socialPrograms/weeklySupplementRequests.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import type { AuthProvider } from '../storage/datastore.js';

async function freePort() {
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return address.port;
}

test('authenticated task card records CNY ceilings for the frozen five-video account, never grants paid collection', async t => {
  const f = await prepareWeeklyEnterpriseFactFixture(t);
  f.pkg.discoveryBudgetCny=5;
  const packageRow=(await f.store.list<Record<string,unknown>>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,program_id:f.task.programId,package_id:f.task.packageId,version:f.task.packageVersion},perPage:2})).items[0]!;
  await f.store.update('social_weekly_operating_packages',String(packageRow.id),{payload:structuredClone(f.pkg)});
  const task = { ...f.task, workflowKind: 'readiness' as const, scope: 'package' as const,
    accountId: null, publicationTaskId: null, inputSnapshot: {}, status: 'blocked' as const,
    ownBlockingReasons: ['business_dispatch_required'], schedule: { ...f.task.schedule, stepKind: 'benchmark_collection' as const } };
  await f.store.create('social_weekly_execution_tasks', { tenant_id: task.tenantId, program_id: task.programId,
    package_id: task.packageId, package_version: task.packageVersion, task_id: task.taskId,
    idempotency_key: task.idempotencyKey, status: task.status, payload: task });
  const accountUrl = 'https://www.tiktok.com/@fixture_factory';
  const payload = { approval: { status: 'approved', scopeVersion: 3, approvedBy: 'owner' },
    weeklyAccountRevision: { accountUrl, targetCount: 5 },
    discoveryBrief: { discoveryModes: ['momentum', 'account', 'innovation'],
      weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
      modePolicies: { momentum: { enabled: true }, account: { enabled: true }, innovation: { enabled: true } } } };
  await f.store.create('social_discovery_scopes', { id: 'scope-card-budget', tenant_id: task.tenantId,
    version: 3, status: 'active', created_by: 'owner', payload });
  await f.store.create('competitor_accounts', { id: 'account-card-budget', tenantId: task.tenantId,
    platform: 'tiktok', accountUrl });
  await bindWeeklyPreproductionAuthority({ store: f.store, tenantId: task.tenantId, actorUserId: 'owner',
    programId: task.programId, packageId: task.packageId, packageVersion: task.packageVersion,
    taskId: task.taskId, kind: 'discovery', expectedConsumerInputHash: supplementConsumerHash(task),
    discovery: { scopeId: 'scope-card-budget', scopeVersion: 3, requestedModes: ['account'] } });
  const port = await freePort();
  const tokenAuth: AuthProvider = { async verifyToken(header) {
    return header === 'Bearer valid' ? { tenantId: task.tenantId, userId: 'owner', dataAuthority: 'local' } : null;
  } };
  let publicCostReads=0;
  const server = createWeeklyCtaOnlyLocalApp(f.store, tokenAuth, { port, tenantId: task.tenantId,
    userId: 'owner', programId: task.programId, packageId: task.packageId,
    packageVersion: task.packageVersion,costPreflightReader:async({authorization})=>{publicCostReads++;const checkedAt=new Date(Date.now()-1000).toISOString(),validUntil=new Date(Date.now()+3600000).toISOString();return {schema:'weekly-account-collection-cost-preflight.v1',authorizationId:authorization.authorizationId,authorizationHash:authorization.recordHash,modeledUsage:{candidateCount:5,maximumMediaBytesPerCandidate:100*1024*1024,datasetReads:1,keyValueStoreReads:0,keyValueStoreLists:0,modeledTimedStorageGbHours:15.12,maximumExternalTransferGb:.09},publishedRatesUsd:{datasetReadsPer1000:.0004,keyValueStoreReadsPer1000:.005,keyValueStoreListsPer1000:.05,timedStoragePer1000GbHours:1,externalTransferPerGb:.2},observedCnyPerUsd:7.18,modeledNonRunUsd:.2,maximumRunChargeUsd:.05,modeledTotalCny:1.795,actorRunUrl:'https://api.apify.com/v2/actors/clockworks~tiktok-scraper/runs?maxItems=5&maxTotalChargeUsd=0.050000',evidenceRef:'apify-published-cost-preflight:'+'c'.repeat(64),checkedAt,validUntil,permitsPaidCollection:false,remainingRequirements:['verified_account_fx_ceiling','current_actor_minimum_charge_and_pricing','server_enforced_run_cap_receipt','post_run_storage_retention_control']};} }).listen(port, '127.0.0.1');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/api/overseas/social-programs/${task.programId}/operating-packages/${task.packageId}/collection-budget`;
  const bearer = { Authorization: 'Bearer valid' };
  assert.equal((await fetch(`${url}?version=1`)).status, 401);
  assert.equal((await fetch(`${url}?version=2`, { headers: bearer })).status, 409);
  const beforeResponse = await fetch(`${url}?version=1`, { headers: bearer });
  assert.equal(beforeResponse.status, 200);
  assert.equal(beforeResponse.headers.get('cache-control'), 'private, no-store');
  const before = (await beforeResponse.json() as { item: { accountUrl: string; targetCount: number;
    contextHash: string; authorization: null; paidBlocker: string; permitsPaidCollection: boolean } }).item;
  assert.equal(before.accountUrl, accountUrl);
  assert.equal(before.targetCount, 5);
  assert.equal(before.authorization, null);
  assert.equal(before.paidBlocker, 'weekly_preproduction_collection_budget_authorization_required');
  assert.equal(before.permitsPaidCollection, false);
  const body = { expectedPackageVersion: task.packageVersion, expectedContextHash: before.contextHash,
    totalLimitCny: 5, perRunLimitCny: 2 };
  const post = (value: unknown, headers: Record<string, string> = {}) => fetch(url, {
    method: 'POST', headers: { ...bearer, Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });
  assert.equal((await post(body, { Authorization: 'Bearer other' })).status, 401);
  assert.equal((await post(body, { Origin: 'http://other.test' })).status, 403);
  assert.equal((await post({ ...body, expectedContextHash: 'old' })).status, 409);
  assert.equal((await post({ ...body, perRunLimitCny: 6 })).status, 400);
  const bound = (await f.store.list<{id: string; payload: Record<string, unknown>}>('social_weekly_preproduction_jobs')).items[0]!;
  const changed = { ...bound.payload, label: 'same-scope-job-revision', recordHash: '' };
  const changedHash = socialRequestHash(changed);
  changed.recordHash = changedHash;
  assert.equal(await f.store.update('social_weekly_preproduction_jobs', bound.id,
    { payload: changed, record_hash: changedHash }), true);
  assert.equal((await post(body)).status, 409, 'a changed original job invalidates the open budget card');
  assert.equal(await f.store.update('social_weekly_preproduction_jobs', bound.id,
    { payload: bound.payload, record_hash: bound.payload.recordHash }), true);
  assert.equal((await f.store.list('social_weekly_account_collection_budget_authorizations')).totalItems, 0);
  const saved = await post(body);
  assert.equal(saved.status, 201, await saved.clone().text());
  const receipt = (await saved.json() as { item: { permitsPaidCollection: boolean; paidBlocker: string } }).item;
  assert.equal(receipt.permitsPaidCollection, false);
  assert.equal(receipt.paidBlocker, 'weekly_preproduction_collection_cost_ceiling_unverified');
  const after = (await (await fetch(`${url}?version=1`, { headers: bearer })).json() as { item: {
    authorization: { totalLimitCny: number; perRunLimitCny: number }; paidBlocker: string;
    permitsPaidCollection: boolean } }).item;
  assert.equal(after.authorization.totalLimitCny, 5);
  assert.equal(after.authorization.perRunLimitCny, 2);
  assert.equal(after.paidBlocker, 'weekly_preproduction_collection_cost_ceiling_unverified');
  assert.equal(after.permitsPaidCollection, false);
  const runtimeUrl=`${origin}/api/overseas/social-programs/${task.programId}/operating-packages/${task.packageId}/collection-runtime?version=1`;
  const runtime=(await (await fetch(runtimeUrl,{headers:bearer})).json() as {item:{publishedCostScenario:null|{knownNonActorScenarioCny:number;modeledCeilingCny:number;permitsPaidCollection:boolean};operationallyVerified:boolean}}).item;
  assert.equal(runtime.publishedCostScenario?.knownNonActorScenarioCny,1.436);
  assert.equal(runtime.publishedCostScenario?.modeledCeilingCny,1.795);
  assert.equal(runtime.publishedCostScenario?.permitsPaidCollection,false);
  assert.equal(runtime.operationallyVerified,false);
  assert.equal(publicCostReads,1);
  assert.equal((await post(body)).status, 409, 'immutable receipt is not silently overwritten');
  assert.equal((await f.store.list('social_discovery_runs')).totalItems, 0);
  assert.equal((await f.store.list('social_weekly_account_collection_budget_authorizations')).totalItems, 1);
});
