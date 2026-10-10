# 生产基础设施接入准备与停写切换 runbook

审计基准：`73c78766c985871cd925453aeb5f3e937ec8b3f7`。日期：2026-10-10。此阶段仅文档、模板、安全检查工具及隔离测试；没有连接真实服务、安装软件、运行生产迁移或部署。后续执行生产命令需当次明确授权，按 `AGENTS.md` 使用现有 Ubuntu 服务器的交互 SSH 和规范部署入口 `bash deploy/update.sh`。

## 可立即运行的离线检查

在仓库根目录执行；不加载 `.env*`、不启动 app/worker、不访问数据库或供应商：

```sh
node scripts/infra-prep-config-check.mjs
node scripts/infra-prep-postgres-readonly.mjs
node scripts/infra-prep-backup-restore.mjs
node --test scripts/infra-prep-*.test.mjs
```

`deploy/production-infrastructure.env.example` 是占位符审查模板，不可 source，不可当作完整生产 env。模板检查失败退出非零，输出只包含变量名和错误代码。准备阶段仅 `PROCESS_ROLE=web`；`worker/all` 会启动无独立禁用开关的 scheduler/生产消费等，不能靠关闭发布开关保证静默。Compose 对 worker 会覆盖角色为 `worker`、爬虫开关为 `1`，因此不要启动现有 production compose 来做“只读预检”。

## 环境配置与实际边界

| 配置 | 准备值/要求 | 实际行为及来源 |
|---|---|---|
| `DATA_BACKEND` | `postgres` | business 和 lease 转 PG，`users`/登录保留 PB；storage/index.ts。默认 PB 仍存在，不能假设 production 自动拒绝 PB |
| `DATABASE_URL` | secret manager 注入 | postgresPool 懒连接；凭据不放命令行或日志 |
| `DATABASE_SSL_MODE` | 建议 `verify-full` | `require` 加密但 `rejectUnauthorized=false`；`verify-full` 校验证书；先验证 CA/主机证书，禁止降级绕过 |
| `DATABASE_POOL_MAX` | `10`，每进程预算 | 实现约束 2–50；web/worker 副本总连接数必须计入容量 |
| `DATABASE_APPLICATION_NAME` | 明确安装/角色 | 最多63字符，用于数据库审计 |
| `QUEUE_BACKEND` / `REDIS_URL` | `bullmq` / `rediss://` | production 拒绝 local queue；Redis DB 与 prefix 必须属于本安装 |
| `BULLMQ_PREFIX` | 唯一安装 prefix | 不同环境不能共享 DB+prefix；调换 prefix 会留下旧队列，不能当作清空 |
| `PROCESS_ROLE_SPLIT_ENABLED` / `PROCESS_ROLE` | `true` / `web` | 准备不启动后台；正式 Compose app=web、worker=worker |
| `DISABLE_LOCAL_AUTH_FALLBACK` / `ENABLE_LOCAL_DEV_FALLBACK` | `true` / `false` | production强制禁本地身份；此前成功token可在身份缓存TTL内复用，未缓存验证故障503。必须核NODE_ENV精确production |
| `PB_URL` / `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | 私网/secret manager | PG cutover 仍依赖 PB 登录/用户，不可下线 PB |
| `RUNTIME_SCHEMA_REPAIR_ENABLED` | `false` | schema 变更走受审迁移，预检不自修复 |
| `REQUIRED_CAPABILITIES` | 保持业务约定完整集合 | 不得删能力使 ready 假通过；模板空供应商凭据不会代表 ready |
| lease/并发/重试参数 | 模板提供真实变量名 | 配置数值不等于原子能力；真实 catalog 和并发争用验收另做 |

完整来源与语义分别见 [存储审计](infra-prep-storage-73c78766.md)、[队列/租约审计](infra-prep-queues-73c78766.md)、[认证审计](infra-prep-auth-73c78766.md)。`deploy/make-production-env.sh` 没有完整生成 PG/Redis 配置；`deploy/update.sh` 只自动执行 PB 迁移，不自动执行 PG schema、数据复制或独立验收。现有 Compose 不提供 PG/Redis 服务。应用 loadEnvironment 会读取本地及用户目录 dotenv 文件，不能直接借实际 server 入口做隔离检查。

## 停写迁移顺序与停止条件

以下为未来获授权维护窗口的检查点，每点失败立即停止，保持停写；不跳点、不盲重跑外部副作用。

1. 在交互 SSH 中确认远程 checkout origin、分支、干净状态、HEAD 与批准版本。通过 HTTPS `git pull --ff-only`，GitHub credential 只在终端提示时输入，不保存。冻结配置版本、源 schema、迁移清单与对象存储键清单；敏感 env 不纳入报告。
2. 独立验证 PG TLS/权限/磁盘、Redis 持久化与 DB/prefix、PB 私网登录依赖、共享 `data` 发布上传卷和对象存储权限。准备单独 PG+Redis+PB+对象存储备份；现有 `backup-production-data.sh` 只覆盖应用 data/PB，不能据此宣称完整备份。先在专属隔离目标演练恢复，保留时间点和校验清单。
3. 进入维护模式并停全部写入：网关/用户写请求、app/worker、所有副本、定时/手工任务、爬虫、webhook 和外部集成。核实没有 active 外发、未知 provider attempt 或持有 lease；不能直接回收未知发送。停止后再形成冻结源备份和全 collection/ID/current-data 校验基线。仅停 Caddy 不足以冻结其他写入。
4. PB 先应用完整受审 `pb_migrations`；验证 source collections、字段及唯一索引，保留 users/auth。正式规范 update 可能立即启动 worker，PG 尚未验收前不能直接以该脚本当迁移编排；部署 owner 需先安排受审停写窗口与明确检查点，不绕过 AGENTS 的部署路径。
5. 对专属目标先执行 PG schema，再停写复制 PB business/文件并验证唯一索引。仓库命令为 `pnpm postgres:schema`、`MIGRATION_APPLY=true pnpm migrate:pocketbase-postgres -- --apply --copy-files`；使用已审秘密注入环境，不在参数嵌入 URL。这些是写操作，本阶段未运行。注意 schema advisory lock 的 Pool session 归属风险；真实迁移前必须演练或修复该阻塞。
6. `--plan` 读取 PB，会连接真实源，不是离线；`--verify` 会 DDL/写迁移报告，不是只读，且仅 cached source_hash 比较无法检测 PG 当前 data 漂移/PG-only rows。不能作为唯一验收。改用新增只读工具验 core schema/catalog/lease index，另用独立冻结快照核每 collection 全 ID、所有行（包括 source_hash NULL）及当前 data canonical hash，文件 HEAD/大小/hash。分页必须完整稳定，无重复/缺页/源写入。
7. 在写入仍冻结时配置 `DATA_BACKEND=postgres`、`QUEUE_BACKEND=bullmq`，保留 PB auth；执行只读预检。真实隔离环境还需多客户端 lease 争用仅单赢家、旧 token 拒绝、超时和 Redis enqueue 去重/重连/worker消费演练。这些会写测试数据，不能并入“只读预检”。
8. 后续获部署授权再通过规范 `deploy/update.sh` 启动批准的单活消费者与 web。先检查 `/api/overseas/health`、`/api/overseas/ready`、角色、build SHA、PG/PB/Redis 依赖、durable heartbeat；不要降低能力要求或 fallback。证据应包括部署 SHA、Compose 服务状态和 exact ready JSON。
9. 首个实际任务要来自已授权范围，核业务 DB/Redis/平台回执的一致结果与原 task/run/account/version。逐项开放 worker/外发/付费开关；未验证的开关继续关闭。监控 backlog、failed/stalled、lease 争用、心跳和认证503，达到预设阈值立即停止新写入进入对账。

## 只读健康验收

未来在授权服务器执行的 GET（本阶段未执行）：

```sh
curl --fail --silent --show-error http://127.0.0.1:18788/api/overseas/health
curl --fail --silent --show-error http://127.0.0.1:18788/api/overseas/ready
```

端口必须与实际 `APP_HOST_PORT` 及单一 app 映射一致。`health` 是存活/启动报告，不能代替 `ready`；`ready` 503即失败，200也不能单独证明租约索引或数据复制完整。ready 实际会连接 PG/PB/Redis、读业务/心跳，生产环境未运行此探针。Redis健康计数探针不是全局零写保证；准备web无worker心跳应保留503，不伪造心跳。只读 PG 工具不能凭没有错误就声明业务迁移完整；跨源当前数据与文件校验仍独立必要。

## 安全工具的连接模式（仅后续获明确授权时）

```sh
node scripts/infra-prep-postgres-readonly.mjs --execute --manifest /PRIVATE_PATH/migration-manifest.json
node scripts/infra-prep-backup-restore.mjs --execute-read-only --manifest=/PRIVATE_PATH/backup-manifest.json
```

通过批准的秘密管理器注入凭据，不在命令行嵌入值。PG工具可用INFRA_PREP_PG_SSL_ROOT_CERT显式指定只读CA文件，INFRA_PREP_PSQL_BIN仅供隔离fake命令测试；生产只用受信系统psql。占位符凭据被连接模式拒绝。只读PG工具在强制只读事务中核catalog，缺表/错误索引/输出不完整即失败；manifest指定runId及collections，每项包括name、expectedCount、requiredUniqueIndexes（name/fields/predicate），核全部记录计数及指定迁移登记/唯一索引。报告schemaReady、migrationMetadataReady与migrationReady/currentDataVerified分离；缺manifest不宣称迁移登记已核验。备份预检先流式验证本地独立PG和Redis artifact SHA256，再按顺序读PG版本/index metadata、Redis PING/INFO；任一失败即停。它不创建备份、不恢复、不发SAVE/BGSAVE、不清空Redis。清洁子进程环境避免继承PGSERVICE/PGOPTIONS重定向目标；敏感stdout/stderr不直接透传。

备份manifest须声明schemaVersion=infra-backup.v1、cutoverId、createdAt、sourceCommit、postgres/redis各artifact/sha256/version，以及activeJobIds、unknownAttemptIds、admissionStopped、cutoverPhase、postBackupWrites、consistentRecoveryPoint；示例见deploy/production-backup-manifest.example.json。restoreEligible仅preliminary；post-cutover/备份后有写入/恢复点不一致不得回滚，绝非恢复授权。

## 回滚与备份/恢复边界

- 切换前或 PG 尚未接收任何新业务写入：停全部消费者/入口，保留失败目标及报告，恢复冻结 PB/data/config 的一致快照，确认旧版仍满足原子发布/授权要求；未知外发先对账，禁止自动重发。
- PG 已接收新业务写入、Redis已有新job或平台已有回执：禁止只将 DATA_BACKEND 改回 PB，禁止覆盖 Redis 或重播历史 job。先停写，导出 PG 增量和 task/run/attempt/outbox/receipt，人工确定数据权威、反向同步与外部结果；没有一致恢复方案继续维护模式。
- Redis恢复会重现 queued/active/stalled jobs，与 PG/平台账本不同时点会重复执行。必须与 PG 同一冻结窗口并保留 job IDs、namespace、版本，恢复到专属隔离实例演练；不能 `FLUSHALL`、`FLUSHDB`、改 prefix 规避 backlog。
- 新工具只做备份/恢复预检，不自动恢复。dry-run不代表可恢复；真实授权的备份必须验证加密、完整性、恢复点、PG角色/扩展/schema兼容、Redis版本/持久化兼容、对象存储引用。恢复操作者应保留现有实例快照并按已演练方案执行，任一步失败停止。
- 保持现有 HMAC/加密 key 的安装一致性；随意换 key 会使平台凭据解密、API key、签名链接/会话失效。不得将真实 key写到仓库或报告。

## 本阶段验证记录

仅静态文件与隔离 mock/fake-command 合同。最终六份测试文件共39项全部通过（strict loopback guard）；默认dry-run、缺凭据/占位符拒绝、无DDL/报告写DB、真实fake child、TLS冲突、hash/版本失败即停均受覆盖。审计证据见infra-prep-evidence-73c78766.json，提交 SHA 在交付证据中；不声称真实 PG/Redis/BullMQ、生产 token交换、真实多客户端原子事务或生产回滚演练通过。
