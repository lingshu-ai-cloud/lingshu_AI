import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
test('production queue contract rejects local fallback and validates TLS isolated Redis URLs',()=>{
 const s=source('server/queues/bullmq.ts');
 for(const value of ["env.NODE_ENV === 'production'",'QUEUE_BACKEND=bullmq is required in production',"['redis:', 'rediss:']","parsed.hash","maxRetriesPerRequest: null","enableReadyCheck: true","tls: {}","BULLMQ_PREFIX","BULLMQ_HEALTH_TIMEOUT_MS"])assert.ok(s.includes(value),value);
 assert.match(s,/state === 'failed'[\s\S]*existing.retry\('failed'\)/);
 assert.match(s,/throw new Error\('BullMQ health check failed or timed out'\)/);
});
test('publication authority requires database verified exact unique lease index and durable prior-effect guard',()=>{
 const p=source('server/storage/postgres.ts'),a=source('server/publishing/publicationAtomicStore.ts'),l=source('server/publishing/weeklyLineage.ts');
 assert.match(a,/currentDataAuthority\(\)==='local'\|\|await dataStore.supportsAtomicOperationLease\?\.\(\)!==true/);
 for(const token of ['i.indisvalid','i.indisready','i.indimmediate','i.indisunique','i.indnkeyatts = 3','idx_lingshu_durable_operation_lease_subject',"data->>'tenant_id'","data->>'lease_scope'","data->>'subject_id'","collection='durable_operation_leases'"])assert.ok(p.includes(token),token);
 assert.match(source('server/storage/pbStore.ts'),/supportsAtomicOperationLease: \(\) => false/);
 assert.ok(l.indexOf('await assertPublicationAtomicStore(dataStore)')<l.indexOf('await input.adapter.publish('));
 assert.match(l,/\['published','unknown','in_flight'\]/);
 assert.ok(l.indexOf("status: 'in_flight', started_at")<l.indexOf('await input.adapter.publish('));
});
test('web preparation avoids background jobs while real durable production worker requires isolated runtime',()=>{
 const r=source('server/runtime/processRole.ts'),b=source('server/runtime/backgroundJobs.ts'),q=source('server/starter198/socialContentProductionQueue.ts');
 assert.match(r,/role === 'all' \|\| role === 'worker'/);
 assert.match(b,/role === 'web'[\s\S]*background_jobs_forbidden_for_web_role/);
 assert.match(q,/durableWorker.start\(\)/);assert.match(q,/queue: 'social-content-production'/);
 assert.match(source('server/digitalEmployees/runtimeOrchestrator.ts'),/DIGITAL_EMPLOYEE_RUNTIME_ENABLED === 'false'/);
 assert.match(source('server/notifications/agentNotificationOutbox.ts'),/AGENT_NOTIFICATION_OUTBOX_WORKER_ENABLED === 'false'/);
});
test('dependency readiness separately checks Redis and worker heartbeat without claiming publication index verification',()=>{
 const r=source('server/runtime/readiness.ts'),o=source('server/runtime/socialOperatingObservability.ts'),i=source('server/index.ts');
 for(const token of ['await checkPostgres()','await checkBullMq()','social_operating_worker_unready'])assert.ok(r.includes(token),token);
 assert.ok(!r.includes('assertPublicationAtomicStore'));
 assert.ok(o.includes("state: versionMismatch ? 'version_mismatch'"));assert.ok(o.includes("state: 'stale'"));
 assert.match(i,/report.status !== 'ready'[\s\S]*res.status\(503\)/);
 assert.ok(source('docs/acceptance/infra-prep-queues-73c78766.md').includes('Do not forge a heartbeat'));
});
