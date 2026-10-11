import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import fs from 'node:fs/promises';

// Install before importing production adapters: even accidental fallback transport
// or dependency initialization cannot reach a provider, database or queue.
test('production adapter admission and controlled reconciliation never submit or use outbound transport', async () => {
  const originalFetch = globalThis.fetch;
  const originalConnect = Socket.prototype.connect;
  let fetchAttempts = 0;
  let socketAttempts = 0;
  globalThis.fetch = (async () => { fetchAttempts++; throw Error('dry_run_outbound_forbidden'); }) as typeof fetch;
  Socket.prototype.connect = function () { socketAttempts++; throw Error('dry_run_socket_forbidden'); } as typeof originalConnect;
  try {
    const [{ RunwayActTwoAdapter }, { SeedanceReferenceAdapter }, { selectReferenceAdapter }, { evaluateWeeklyProductionEnvironment }, { probeWeeklyProductionEnvironment }] = await Promise.all([
      import('../server/lib/runwayActTwoAdapter.js'), import('../server/lib/seedanceReferenceAdapter.js'),
      import('../server/lib/digitalHumanProviderRegistry.js'), import('../server/socialPrograms/weeklyProductionEnvironmentReadiness.js'),
      import('../server/socialPrograms/weeklyProductionEnvironmentProbe.js'),
    ]);
    const controlledEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production', DATA_BACKEND: 'postgres', DATABASE_URL: 'controlled-placeholder', QUEUE_BACKEND: 'bullmq', REDIS_URL: 'controlled-placeholder',
      DISABLE_LOCAL_AUTH_FALLBACK: 'true', ENABLE_LOCAL_DEV_FALLBACK: 'false', META_SOCIAL_APP_ID: 'controlled', META_SOCIAL_APP_SECRET: 'controlled',
      INSTAGRAM_APP_ID: 'controlled', INSTAGRAM_APP_SECRET: 'controlled', INSTAGRAM_CONTENT_PUBLISH_ENABLED: 'true',
      TIKTOK_CLIENT_KEY: 'controlled', TIKTOK_CLIENT_SECRET: 'controlled', TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved',
    };
    const configured = evaluateWeeklyProductionEnvironment(controlledEnv, true);
    assert.equal(configured.ready, true);
    assert.equal(evaluateWeeklyProductionEnvironment({ ...controlledEnv, ENABLE_LOCAL_DEV_FALLBACK: 'true' }, true).ready, false);
    assert.equal(evaluateWeeklyProductionEnvironment({ ...controlledEnv, TIKTOK_DIRECT_POST_RELEASE_MODE: 'pending' }, true).ready, false);
    const requests: Array<{ provider: string; method: string; path: string }> = [];
    let runwayState = 'RUNNING';
    let seedanceState = 'running';
    const transport = (provider: string): typeof fetch => (async (url, init) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.hostname, 'controlled.invalid');
      assert.equal(init?.method, 'GET', 'dry-run forbids POST/DELETE, including supplier submit and cancellation');
      assert.match(parsed.pathname, /\/tasks\/controlled-task$/);
      requests.push({ provider, method: init!.method!, path: parsed.pathname });
      return new Response(JSON.stringify(provider === 'runway'
        ? { status: runwayState, output: ['https://controlled.invalid/output.mp4'], cost: { credits: 2 } }
        : { status: seedanceState, content: { video_url: 'https://controlled.invalid/output.mp4' }, usage: { completion_tokens: 1000 } }), { status: 200 });
    }) as typeof fetch;
    const runway = new RunwayActTwoAdapter({ apiSecret: 'controlled-placeholder', baseUrl: 'https://controlled.invalid', transport: transport('runway'), cnyPerCredit: 0.5, estimatedCostCnyPerSecond: 1, qualityInspection: true });
    const seedance = new SeedanceReferenceAdapter({ apiKey: 'controlled-placeholder', model: 'controlled-model', baseUrl: 'https://controlled.invalid', transport: transport('seedance'), estimatedCostCnyPerSecond: 2, cnyPerThousandTokens: 0.3 });
    let submitCalls = 0;
    for (const adapter of [runway, seedance]) {
      adapter.submit = async () => { submitCalls++; throw Error('dry_run_submit_forbidden'); };
    }
    const select = (requiredPreservation: Array<'identity' | 'motion' | 'product'>, maxEstimatedCostCny = 10) => selectReferenceAdapter({ adapters: [runway, seedance], candidates: ['runway_act_two', 'runway_seedance'], method: 'reenact', targetDurationSeconds: 5, maxEstimatedCostCny, requiredPreservation });
    assert.equal(select(['identity', 'motion']).adapter, runway);
    assert.equal(select(['identity', 'product']).adapter, undefined);
    assert.equal(select(['identity'], 0).adapter, undefined);
    assert.deepEqual(await runway.status('controlled-task'), { state: 'pending' });
    runwayState = 'SUCCEEDED';
    const complete = await runway.status('controlled-task');
    assert.equal(complete.state, 'completed');
    assert.equal(complete.actualCostCny, 1);
    assert.equal((await runway.cost('controlled-task')).costSourceRef, 'runway-task:controlled-task:credits:2');
    assert.deepEqual(await seedance.status('controlled-task'), { state: 'pending' });
    seedanceState = 'succeeded';
    assert.equal((await seedance.status('controlled-task')).actualCostCny, 0.3);
    assert.equal((await seedance.cost('controlled-task')).costSourceRef, 'seedance-task:controlled-task:completion_tokens:1000');
    runwayState = 'UNRECOGNIZED';
    await assert.rejects(runway.status('controlled-task'), /未知任务状态/);
    const faultProbe = await probeWeeklyProductionEnvironment({ env: controlledEnv, atomicStore: () => { throw Error('secret_connection_value'); }, queue: async () => { throw Error('secret_connection_value'); }, timeoutMs: 100 });
    assert.equal(faultProbe.ready, false);
    assert.equal(JSON.stringify(faultProbe).includes('secret_connection_value'), false);
    assert.equal(submitCalls, 0);
    assert.equal(fetchAttempts, 0);
    assert.equal(socketAttempts, 0);
    const report = {
      kind: 'production_adapter_controlled_dry_run', ready: false, paidOperationsAllowed: false,
      productionPolicyParsed: controlledEnv.NODE_ENV === 'production', controlledConfigurationReady: configured.ready,
      realEnvironmentConfigurationReady: evaluateWeeklyProductionEnvironment(process.env, false).ready,
      adaptersConstructed: [runway.id, seedance.id], admissionPassed: true, preservationAndBudgetRejectionsPassed: true,
      controlledStatusAndCostCalls: requests, controlledUnknownStatusRejected: true, controlledDependencyFaultsRejected: true,
      submitCalls, fetchAttempts, socketAttempts,
      runtimeEvidenceObserved: false, tenantAuthorizationVerified: false, providerCredentialValidityVerified: false,
      actualDatabaseAndQueueVerified: false, qualityOrHumanApprovalExecuted: false, publicationPerformed: false,
      remainingEvidence: configured.runtimeEvidenceRequired,
      remainingCodeGaps: [],
      limitations: ['Instagram Login native adapter is covered by separate controlled tests; this dry-run provides no live token, permission, account-membership or publication evidence.', 'Credentials and dependency ports are placeholders; configured presence proves no credential validity.', 'Supplier status/cost responses are injected and prove adapter interpretation only.', 'No live tenant authorization, provider receipt, worker heartbeat, quality approval or platform release review was observed.'],
    };
    await fs.mkdir('work', { recursive: true });
    await fs.writeFile('work/production-provider-boundary-dry-run.json', JSON.stringify(report, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    Socket.prototype.connect = originalConnect;
  }
});
