# Postgres business store：切换前只读准备审计

基准：`73c78766c985871cd925453aeb5f3e937ec8b3f7`，2026-10-10。范围仅源码；没有读取实际密钥、连接 PocketBase/Postgres/COS、执行迁移、部署或修改生产实现。工作区已有脏文件不属于本审计。以下操作步骤是未来获授权窗口的准备要求，当前没有执行。

结论：业务记录具备 Postgres 路由和通用 JSONB store，但不能凭配置存在、现有 preflight 或 migration `verified:true` 判定完整切换成功。当前有验收与恢复缺口，切换前需要独立证据和停写边界；源码没有自动双写或 Postgres → PocketBase 反向迁移。

## 精确配置与数据边界

| 配置 | 源码行为 | 位置 |
| --- | --- | --- |
| `DATA_BACKEND` | 缺省 `pocketbase`；trim/lowercase 后仅接受 pocketbase/postgres。模块初始化选定 `store`，修改配置需要重启所有进程 | `server/storage/postgres.ts:9`；`server/storage/index.ts:15` |
| `DATABASE_URL` | 选用 PG 时必需，首个 pool 被缓存；不打印连接串 | `server/storage/postgres.ts:30` |
| `DATABASE_SSL_MODE` | disable/require/verify-full；production 缺省 require。require 的 `rejectUnauthorized=false`，verify-full 才验证服务端证书 | `server/storage/postgres.ts:21` |
| `DATABASE_POOL_MAX` | 缺省 10，整数限制 2–50，非法整数回退 10；每个进程各自 pool | `server/storage/postgres.ts:34` |
| `DATABASE_APPLICATION_NAME` | 缺省 lingshu-ai，截断 63 字符；idle timeout 30s、connect timeout 5s 固定 | `server/storage/postgres.ts:35` |
| `PB_URL`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` | PB 继续承担用户/认证与迁移源；缺省 PB_URL localhost:8090，Compose 强制 pocketbase:8090 | `server/storage/pb.ts:17,69`；`docker-compose.yml:12,45` |
| `MIGRATION_APPLY` | 仅 `--apply` 与值 true 同时满足才允许 apply。verify 没有同等写授权开关 | `scripts/migrate-pocketbase-to-postgres.ts:110` |
| `MIGRATION_RUN_ID` | 控制迁移报告 ID；未设时生成新 ID。重复 ID 会改写报告状态，非数据库事务 checkpoint | 同上 `:119,394` |
| `MIGRATION_COPY_FILES` / `--copy-files` | 仅 apply 可用。独立 verify 无论是否有文件都要求显式可用 COS | 同上 `:115,381` |

环境加载顺序是 repo `.env` → 用户 `.config/lingshu-ai/.env` → `.env.local` → repo `.env.local`；最后一个 `override:true` 可覆盖已有进程环境（`server/loadEnvironment.ts:5–9`）。源码不会自动加载 `.env.production`，Compose 用 env_file 注入（`docker-compose.yml:7,41`）。模板 `.env.production.example:51–55` 声明 PG，不代表 `deploy/make-production-env.sh` 已生成同配置；该生成器没有 DATA_BACKEND/DATABASE 配置段。不得输出真实配置值来验收，只记录有效键存在、来源、脱敏指纹。

`server/storage/index.ts:18–28` 在 PG 模式将 `users` 留在 PB，认证仍是 `pbAuth`；旧 PB records helper 也将 `users` 和 `_superusers` 排除于 PG（`server/storage/pb.ts:10–14`）。迁移器会把非内部 `users` 复制到 PG供审计，但运行时 users 读取并不使用这份副本（migration `:134–141`）。PB 不能下线。

PG store 没有 collection schema registry、PocketBase required-field/rule 校验或 SQL RLS；`getById/update/delete` 仅 collection+id，list 的 tenant 约束依赖调用方明确 where（`server/storage/postgres.ts:227–284`）。用户认证与 tenant/record payload 校验必须继续生效。此审计不宣称所有 route 已完成 tenant 隔离验证。

## 当前迁移实现与顺序

1. 先批准固定源/目标、源码版本、全量 collection manifest、停写窗口与备份恢复责任人。冻结所有业务写入方，包括 web、worker、Mac 采集端、定时器和独立脚本；仅停 caddy 不能冻结外部直连 PB 写入。
2. 保留一致的 PB volume + app data 备份，另取得可实际恢复的 PG 备份/PITR 点和 COS 清单。`deploy/backup.sh:6–10` 与 `scripts/backup-production-data.sh:153–173` 仅打包 PB/app data，没有 PG dump 或 COS 对象备份。它不能被当成完整切换回滚资产。
3. 在获授权隔离演练中先让源 PB 达到固定提交的正式 migration 集。基准末尾正式文件包括 `1791535000_add_instagram_tenant_app.js`、`1791535001_extend_social_accounts_instagram_login.js`、`1791587000_create_weekly_producer_jobs.js`；工作区未提交的 assistant migration 不属于这个基准。否则复制出来的 collection indexes 不包含新 producer 唯一约束。
4. 配置目标 PG 的连接、TLS、schema 所有权与角色权限。在演练目标执行 `postgres:schema` 建通用 `lingshu_records`、基础唯一索引、migration 报告表（`server/storage/postgres.ts:91–150`；`scripts/apply-postgres-schema.ts:5`）。这是写操作，不是只读探测。
5. 迁移 plan 会认证并分页读取 PB，默认不连 PG、不复制 COS；当前 collection manifest 读取不完整保证，须独立核对。冻结的 manifest 应逐一确认全部已选中 collection，不能仅对 `--collections` 子集成功就称全量成功。
6. 经授权 apply：固定 run ID，`--apply` + `MIGRATION_APPLY=true`。有 PB file 字段的集合应 `--copy-files`，先逐记录复制文件到 COS/记录 `_objectFiles` 后 upsert PG，再从源 collection 元数据翻译 unique indexes（migration `:208–259,263–294,369–378,414–424`）。普通索引和 required-field schema 不会被翻译。
7. 验证每一个集合的真正目标内容、tenant/run/task/version/hash、全部唯一索引定义以及全部文件内容，再评估服务可用性。当前 `--verify` 可作额外迁移工具检查，但属于写操作，不能代替下一节只读验收。
8. 全部证据通过后，在仍停写的窗口统一切换 web 与 worker `DATA_BACKEND=postgres`，逐进程核有效配置来源并重启。然后只读 canary、检查认证仍走 PB、业务/lease 走 PG；最后另获准恢复 worker/写流量。未知外发任务保持未知，仅核查回执，不重发。

Canonical `deploy/update.sh:42–52` 只负责停 caddy/app/worker、更新 PB migration、bootstrap 管理员、启动 app/worker；没有 PG schema/apply/verify 步骤。`docker-compose.yml` 只有 app/worker/pocketbase/caddy，PG 必须是另行准备的目标；没有 PG depends_on 或 healthcheck。不可通过照跑 update.sh 推断业务数据库迁移已发生。实际未来部署仍须遵循 AGENTS.md 的明确授权与 canonical 路径，本审计没有授权修改该路径。

## 严格只读验收

现有 `--verify` 会调用 `ensurePostgresSchema`，并 INSERT/UPDATE `lingshu_migration_runs`/`lingshu_migration_collections`（migration `:391–400,447–454`），即使文案输出 `destructive:false` 也有写。cloud-backend-preflight 的 PG probe 仅 SELECT，但 schema 为 null 仍返回 ready=true（`scripts/cloud-backend-preflight.ts:31–37`）。完整 preflight 还会 PB admin auth 与 Redis/COS 请求，不是纯 PG 只读命令。

未来操作员应使用独立只读 DB 角色/连接，并显式只读事务，限制超时。以下 SQL 仅模板，当前未连接或执行：

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT current_setting('server_version'), to_regclass('public.lingshu_records');
SELECT collection, count(*) AS actual_count,
       count(*) FILTER (WHERE source_hash IS NULL) AS pg_only_or_untracked
FROM public.lingshu_records GROUP BY collection ORDER BY collection;
SELECT collection, id, tenant_id
FROM public.lingshu_records
WHERE data->>'id' IS DISTINCT FROM id
   OR COALESCE(NULLIF(data->>'tenantId',''),NULLIF(data->>'tenant_id',''))
      IS DISTINCT FROM tenant_id;
SELECT idx.relname, i.indisvalid, i.indisready, i.indisunique,
       pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred,i.indrelid)
FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
WHERE i.indrelid=to_regclass('public.lingshu_records') ORDER BY idx.relname;
COMMIT;
```

这只证明结构和数据库快照，不证明源/目标内容一致。必须对固定 PB 源快照与 PG **所有**记录独立导出/计算 canonical 内容摘要；迁移添加的 `_objectFiles` 和材料 object keys 要通过明确转换规则分开校验，不能删除所有业务变化来求相等。输出脱敏 manifest、各集合全量 count、PG-only IDs 数量、转换后 current-data digest、tenant/version/task lineage 核对结果与 schema/index fingerprint；不输出敏感业务记录或 token。

文件验收要按源 collection file schema 找齐文件，校验对象存在、精确大小及下载内容 SHA256。当前 `verifyTargetFiles` 只 HEAD/size，size<=0 时不核大小，不校 SHA256/ETag 的内容一致性（migration `:323–344`）。数据库 data 内的 `_objectFiles.sha256` 只是声称值，不是对象的现存内容证明。PG 模式文件 URL 不 fallback PB：没有 object reference 会返回 null（`server/storage/files.ts:103–106`）。因此不复制 PB files 的记录迁移成功不能证明用户仍能读文件。

只读 SQL 核索引必须包括所有 PB unique 约束转译结果，尤其租约、主任务幂等、S2 exception/events、原 run、producer jobs；源码对 atomic lease 检查会严格比较实际 index 的有效/ready/immediate/unique、三键与 partial predicate（`server/storage/postgres.ts:198–219`）。`checkPostgres` 仅 SELECT1+表存在（`:389–393`）；readiness 额外只读 starter entitlement/经营集合（`server/runtime/readiness.ts:338–348`），均不能证明全量迁移或每个 collection 真实存在：JSONB store 查询一个没迁移的 collection 也可返回空集。

## 风险与补缺要求

| 编号 | 可定位风险 | 切换前最小要求 |
| --- | --- | --- |
| ST-01 | collection metadata 只取 page1/perPage500；record 页总数缺省1，没有 total 稳定性、重复 ID或完整页断言（migration `:134–153`） | 固定全量 manifest；按 snapshot 完整分页核验；缺页/重复/源漂移必须失败 |
| ST-02 | targetVerification 只 count 非 null source_hash，digest 来自缓存 hash，不重新 hash `data`（`:296–310`） | 独立对所有 PG rows 的 current content/额外 rows 核验，不用报告 completed 代替 |
| ST-03 | apply 同 id upsert 可覆盖目标业务字段；逐记录提交、文件/记录/索引无共同事务（`:273–293,414–424`） | 停写、有恢复点；失败范围清单；不要在切换后带写目标重跑 apply |
| ST-04 | session advisory lock 用三次 executor.query；默认 executor 是 pool，连接亲和未保证（`postgres.ts:153–159`） | schema apply 由单一受控操作员独占；后续实现应专用 client/同一 session 并确认 lock/unlock |
| ST-05 | 文件 verify 不读内容hash；apply 无文件复制也可能产生不可用文件记录 | 独立文件内容与引用证明；COS 原对象保留，不自动清理 |
| ST-06 | `DATABASE_SSL_MODE=require` 不核证书，`.env.local` 可覆盖 injected env | 核有效 TLS 与配置来源；按实际服务证书验证 verify-full，可用性未测前不声称通过 |
| ST-07 | preflight/schema-ready ≠业务迁移-ready；source PB users/认证仍必须在线 | 逐 tenant 只读 canary，正式租约索引证明、两进程同配置，保留 PB |
| ST-08 |备份脚本无 PG/COS、无反向同步；模式改回PB会遗漏PG期间写入 | 切换前取得PG恢复资产；切换后回滚需停写并审计/回放PG增量，禁止自动改回旧PB |

## 回滚与失败恢复边界

- 切换前/尚未接受 PG 业务写入：停全部写方并保存失败报告；保持 PB 为唯一活动业务源。可以在明确授权窗口恢复原配置并重启，但不得删除失败目标或 COS 对象来“清洁”证据。独立目标回退依赖预先验证的 PG 备份/PITR，非 migration 工具 down 模式。
- 切换后已有 PG 业务写入：先停写并冻结队列/原 run 状态、保存 PG/PB/COS 快照。仅将 DATA_BACKEND 改回PB会丢弃切换后的业务变化，没有双写/反向迁移能补救。必须先确定增量集合与逐 tenant/version/consumer lineage 的回放/修复方案；未知发送/发布回执不重放外发。必要时修复 PG 继续服务比盲退旧 PB 更可审计。
- apply中断：它可按固定 IDs重新 upsert，也会重写目标；同 run ID 仅关联报告而非事务恢复点。重跑前证明源仍是同冻结快照、目标无新增业务写入、对象同内容、原 unique index 全部成功；否则保留失败关闭状态。工具不会清理源删除导致的目标多余记录。
- schema回滚：源码只有 CREATE/ALTER IF NOT EXISTS，没有自动down。不得因为应用代码回退就 DROP通用业务表或批量删除 producer/exception 记录。

## 本次静态验证

仅运行新 `scripts/infra-prep-storage.test.mjs`，使用 git读取固定提交源码，不导入应用模块、不加载环境、不发网络请求。测试固定关键路由、schema、迁移写边界及报告限制。通过只说明审计与基准源码一致，不证明真实数据库、TLS、权限、备份或迁移演练成功。

## 新增真正只读工具（本轮准备产物）

`node scripts/infra-prep-postgres-readonly.mjs` 默认仅 dry-run，输出固定 SQL，不加载应用/env 文件、不导入数据库 SDK、不启动 psql。`--execute` 才能启动子进程，并且必须提供明确包含 user/password/database 的 `DATABASE_URL`；单独 inherited PGSERVICE 不会获得执行许可。连接串只通过 child PGDATABASE 环境传入，不出现在 argv/报告中。URL 只允许一个 `sslmode` query 参数，必须与 `DATABASE_SSL_MODE` 一致；其余 query（host/dbname/user/password/options/service 等）一律拒绝。

执行工具仅允许 TLS require/verify-full，缺省 require；可用 `INFRA_PREP_PG_SSL_ROOT_CERT` 显式指定 psql 证书路径（这是新工具配置，不是 Node app 的既有配置）。重建最小子进程环境：PATH + 明确的连接/TLS/只读参数；不继承 PGOPTIONS/PGSERVICE/PGHOST/PGPASSWORD、NODE_OPTIONS、APIFY_TOKEN、REDIS_URL 等未知 hook 或其他服务密钥。`psql -X --no-password` 避免用户 rc 与交互口令，固定 REPEATABLE READ READ ONLY transaction、statement/lock/connect 超时，失败仅输出稳定 reason code。

工具核验实际 transaction/TLS、三个 core table 的精确 required columns/type/nullability、PK/check/FK，以及六个核心唯一索引的 valid/ready/immediate/unique、键数、表达式和完整 partial predicate。归一仅处理 quoted literal 外部的空白、括号和 text casts，保留字面量内容；相似租约 scope 或附加 OR 谓词会拒绝。库存 count 包含全部 PG rows，另列 PG-only/untracked 数量；输出只有合法 collection 名与十进制 counts，不回显其他 catalog properties。

可提供独立审定的非秘密 manifest：

```json
{
  "runId": "fixed-migration-run-id",
  "collections": [{
    "name": "durable_operation_leases",
    "expectedCount": 0,
    "requiredUniqueIndexes": [{
      "name": "idx_lingshu_durable_operation_lease_subject",
      "fields": ["tenant_id", "lease_scope", "subject_id"],
      "predicate": "collection = 'durable_operation_leases'"
    }]
  }]
}
```

未来经授权使用 `node scripts/infra-prep-postgres-readonly.mjs --execute --manifest <approved-manifest.json>`。manifest 每个集合需要正式 migration report 行；零行集合通过 report + 实际0证明覆盖，而不把不存在的 collection inventory 自动算迁移成功。它核对固定 run completed、唯一 report 行、报告 counts 与真实总数、审定 expectedCount、manifest要求的实际 unique indexes。manifest 不能省略正式迁移的集合，亦不能把工具示例当成实际全量 manifest。

报告分开输出 `schemaReady`、`manifestCoverageReady`、`migrationMetadataReady`；缺 manifest 时后两者为 null。`migrationReady:false` 和 `currentDataVerified:false` 始终保留：即使结构、报告和数量全通过，也没有 current-data digest、tenant业务 lineage 或文件 SHA256 的证明，不可当全量迁移准入。退出0仅说明本工具检查通过，无顶层“整体 ready=true”。

本次实际验证：两个新测试文件合计13/13通过。其中只读工具7例包含真实启动一次本地 fake psql executable（仅读 stdin/输出固定 catalog；没有 socket），默认/缺配置零 child、TLS/URI负例、错误脱敏、索引 literal/谓词负例、manifest缺行/错误状态/count/unique负例、PG-only inventory；另6例固定提交源码审计。未连接真实 Postgres，故尚无真实 SQL执行/证书/权限/备份可恢复性的证明。
