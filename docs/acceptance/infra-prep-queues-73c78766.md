# Queue and publication infrastructure preparation

Source baseline: `73c78766` (local short HEAD `73c7876`). This is a read-only source audit. No service connectivity, infrastructure changes, migrations, deployment, or live publishing were performed. Static tests establish source contracts, not availability or concurrent behavior on a real database.

## Required authority and isolation

Real publication invokes `assertPublicationAtomicStore` before creating the external-effect attempt. Local authority and backends without verified atomic lease support fail with `publication_atomic_store_unavailable`. `pbStore` reports false even though the PocketBase lease migration exists. The current verified production port is PostgreSQL (`DATA_BACKEND=postgres`, `DATABASE_URL` supplied privately); authentication and users remain on PocketBase. Redis does not confer publication atomicity.

`PostgresStore.supportsAtomicOperationLease` reads PostgreSQL catalogs and requires one valid, ready, immediate unique three-key index `idx_lingshu_durable_operation_lease_subject` on `lingshu_records`, exact expression keys `data ->> 'tenant_id'`, `data ->> 'lease_scope'`, `data ->> 'subject_id'`, exact partial predicate `collection = 'durable_operation_leases'`. Mere index-name existence is insufficient. Core schema also defines unique tenant/job-key and tenant/task/run content job indexes. Applying schema is a separately authorized operation; do not execute it during preparation.

The durable lease implementation checks tenant/scope/subject, token, owner and timestamps; expired leases are reclaimed with generation fencing and grace. Publication quota and original-production/account leases protect reservation and durable `in_flight` creation, then are released before HTTP publishing. The durable attempt is the persist-before-effect barrier: published/unknown/in_flight reservations prevent another send. Exceptions become unknown; recovery reconciles an existing attempt rather than publishing again. Do not delete leases, attempts, jobs or unknown receipts to “retry”.

## Exact queue configuration

| Setting | Source contract |
| --- | --- |
| `NODE_ENV=production` | Requires `QUEUE_BACKEND=bullmq`; local queue fallback throws. |
| `QUEUE_BACKEND=bullmq` | Durable Redis wake-up delivery; local default is development only. |
| `REDIS_URL` | Required valid `redis://` or `rediss://`; explicit host, optional numeric database, no fragment. Use a separate isolated endpoint/database with `rediss://` for preparation; credentials stay outside documents/logs. |
| `BULLMQ_PREFIX` | Defaults `lingshu`; sanitized to alphanumeric/underscore/hyphen, at most 32 characters. Choose a unique environment prefix and check the sanitized value cannot collide. |
| `BULLMQ_HEALTH_TIMEOUT_MS` | Default 2000 ms; bounded 1–30000 ms. |
| `PROCESS_ROLE=web`, `PROCESS_ROLE_SPLIT_ENABLED=true` | Silent preparation role: starts HTTP but forbids background jobs. Worker role has no HTTP listener. |
| `WORKER_HEARTBEAT_INTERVAL_MS` | Default 15000 ms; bounded 5000–60000 ms. |
| `WORKER_HEARTBEAT_MAX_AGE_MS` | Default 60000 ms; bounded 10000–600000 ms. |
| `CONTENT_EXECUTION_WORKER_CONCURRENCY` | Durable dispatcher default 4; limits bounded 1–100. |
| `SOCIAL_CONTENT_PRODUCTION_CONCURRENCY` | Bull wake-up worker default 4; Bull worker clamps 1–20. |
| `CONTENT_EXECUTION_POLL_INTERVAL_MS` | Default 2000 ms; bounded 250–60000 ms. |
| `CONTENT_EXECUTION_LEASE_MS` | Default 30 minutes; bounded 1 minute–2 hours. |

Bull queue names become `${sanitizedPrefix}-${sanitizedQueueName}`. A wake-up job contains `jobId`; business authority remains the persisted content execution job and database leases. `social-content-production` is registered in `startBackgroundJobs`; its durable poller starts even without a dedicated enable flag. Bull job IDs deduplicate waiting/active/completed jobs; explicit enqueue retries failed jobs. Queue defaults are one attempt, completed retention 24 hours/5000 jobs, failed retention 14 days/10000 jobs. Persistent business jobs own retry classification and delay; wake-ups are not the sole durable record. Configure Redis persistence/eviction and backups during authorized provisioning; source code does not prove those infrastructure properties.

## Silent preparation profile and hazards

Use web role only, isolated data/Redis/object storage, no real customer/provider credentials, no published assignments or active customer sends, and a deny-egress test environment. Set the following explicitly false: `DIGITAL_EMPLOYEE_RUNTIME_ENABLED`, `AGENT_NOTIFICATION_OUTBOX_WORKER_ENABLED`, `FOLLOWUP_WORKER_ENABLED`, `PUBLISH_SCHEDULER_ENABLED`, `STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED`, `STARTER_QUOTE_ARTIFACT_WORKER_ENABLED`, `STARTER_198_ORCHESTRATOR_WORKER_ENABLED`, `SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED`, `SOCIAL_WEEKLY_PUBLISHING_WORKER_ENABLED`, `SOCIAL_WEEKLY_REAL_PUBLISHING_ENABLED`, `SOCIAL_ENGAGEMENT_INGESTION_WORKER_ENABLED`, `PLATFORM_ADS_AUTOMATION_ENABLED`.

Digital employee runtime and agent notification outbox default on unless explicitly false. Follow-up defaults manual-only and requires `FOLLOWUP_WORKER_ENABLED=true` for scheduled dispatch. Scheduled publishing and weekly real publishing require explicit true flags. These flags do not make `worker`/`all` silent: content production poller, scheduler registration, other recovery and maintenance initializers still run. Never start worker against copied live queues/accounts just to produce a green readiness result.

## Health and acceptance gates

`GET /api/overseas/health` is liveness/build/role reporting and can return HTTP 200 with degraded startup status. `GET /api/overseas/ready` is dependency readiness, returns 503 when degraded, and must be inspected as JSON rather than using liveness alone. It checks PostgreSQL when selected, PocketBase health/auth authority and required collections, Redis readiness/job counts, and operating worker state. Redis errors are redacted to a stable category. The Redis health queue can create a connection/queue object; readiness is an operational dependency probe, not guaranteed globally zero-write infrastructure traffic.

Web role requires a fresh ready worker heartbeat with the matching build SHA (when known); an intentionally silent web-only preparation can therefore remain 503/missing heartbeat. Do not forge a heartbeat or enable workers to hide this expected gap. Worker readiness reflects initializer state and heartbeat; it is not a per-job success guarantee. `/ready` does not independently call the publication atomic index probe, so its ready status alone is insufficient for real publication acceptance.

Later authorized isolated verification must record: exact commit/build for web and worker; DB catalog/index result without secrets; isolated Redis endpoint/database and sanitized prefix; zero access to production tenants/accounts; controlled two-consumer lease contention and expiry/fencing; persisted job restart/recovery with one external-effect call; unknown outcome reconciled with zero resend; Redis restart and lost-wake-up DB poll recovery; fresh/stale/wrong-build heartbeat readiness transitions; denied outbound sockets. Use controlled providers and never real publishing to establish these gates.

## Rollback preparation

Record original environment, artifact/commit and migration versions securely before any authorized change. Stop admission and effect-producing consumers first; capture queued/running/blocked/unknown job and attempt IDs, active leases and heartbeat/build evidence. Preserve Redis and database evidence. Roll back application/environment as one compatible pair; do not switch `QUEUE_BACKEND=local` in production, fall back to PocketBase for publishing, clear Redis, or reverse durable evidence migrations while jobs remain. Restart only after compatibility and queue authority checks, then reconcile unknown effects before any approved resume. AGENTS.md requires explicit deployment authorization and the existing interactive SSH update path; this document grants none.

## Source references

- `server/queues/bullmq.ts`; `server/contentExecution/durableQueue.ts`; `server/starter198/socialContentProductionQueue.ts`
- `server/runtime/backgroundJobs.ts`; `processRole.ts`; `readiness.ts`; `workerHeartbeat.ts`; `socialOperatingObservability.ts`
- `server/storage/postgres.ts`; `pbStore.ts`; `index.ts`; `server/runtime/durableLease.ts`
- `server/publishing/publicationAtomicStore.ts`; `weeklyLineage.ts`; `weeklyPublicationWorker.ts`
- `pb_migrations/1789776001_create_durable_operation_leases.js`; `.env.production.example`

Static check: `node --test scripts/infra-prep-queues.test.mjs`. No application modules are imported and no services are contacted.

## Backup/restore precheck tool

`scripts/infra-prep-backup-restore.mjs` defaults to dry-run: no child commands or connections. `--execute-read-only --manifest=<private-file>` requires credential-bearing `DATABASE_URL` and `REDIS_URL`, validates the independent PostgreSQL and Redis artifact SHA-256 hashes, then performs PostgreSQL SELECT server-version/index metadata (forced read-only transaction/session) and Redis PING/INFO persistence/INFO server only. Each failed exit, missing metadata, loading Redis or failed persistence status stops subsequent steps. Credentials use child environment variables; command arguments and public reports omit them. Commands time out, stderr is suppressed, and failures use stable categories. The tool provides no backup creation or restore operation. Do not run its connection mode without explicit authorization for the target; this audit ran only fake commands.

Manifest contract: `schemaVersion: infra-backup.v1`, `cutoverId`, `createdAt`, `sourceCommit`, independent `postgres` and `redis` entries (`artifact` local file path, 64-hex `sha256`, `version`), `activeJobIds`, `unknownAttemptIds`, `admissionStopped`, `cutoverPhase` (`pre-cutover`/`post-cutover`), `postBackupWrites`, `consistentRecoveryPoint`. Private manifest files should use absolute artifact paths. Hash checks establish artifact integrity, not restore success or snapshot consistency. Metadata probe is preliminary; the publication capability check remains the exact index acceptance authority. `eligibility: preliminary` is always explicit. `restoreEligible` additionally requires pre-cutover, no post-backup writes and declared consistent recovery point along with stopped admission and empty active/unknown sets; it is not restore authorization, application compatibility proof, or proof that no effects occurred after the manifest.

An authorized PostgreSQL backup normally uses a separately managed `pg_dump` artifact and restores into an isolated database for row/schema/index validation. Redis requires its own infrastructure-managed RDB/AOF snapshot plus configuration/version and persistence verification; a PostgreSQL dump does not contain Redis state. Do not run SAVE/BGSAVE, overwrite Redis files, or perform restore from this tool. Both artifacts must share a declared cutover and admission boundary; preserve post-cutover task/attempt journals and reconcile every unknown or active external effect before deciding rollback. A completed effect after cutover cannot be undone by restoring its old database or queue. Blind restore can resend already completed effects.

Safe local checks: `node scripts/infra-prep-backup-restore.mjs` and `node --test scripts/infra-prep-backup-restore.test.mjs scripts/infra-prep-queues.test.mjs`. These default/test commands do not contact PostgreSQL or Redis.

Connection mode requires `DATABASE_SSL_MODE=require` or `verify-full` and rejects a conflicting/downgrading URL `sslmode`; PostgreSQL user/database are mandatory. Child command environments are reconstructed, omitting inherited PGSERVICE/PGOPTIONS and unrelated credentials. Artifact hashing streams bytes rather than loading full backups. Target PostgreSQL/Redis major versions must match manifest versions.
