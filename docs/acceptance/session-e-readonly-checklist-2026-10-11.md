# 会话 E：生产只读验收执行清单

日期：2026-10-11（Asia/Shanghai）。规则基准：`5bd6708` 的《缺口与 MVP 测试》第 11–12 节及仓库 `AGENTS.md`。本轮仅阅读本地已签入源码/文档并新增本清单；没有读取 `.env`、凭据，没有执行 SSH、外网访问、生产连接、迁移、部署或恢复。下面的在线命令是后续执行清单，不是本轮已执行记录。

## 责任与授权独立

运维 Agent 自主诊断、准备修复、组织本地检查并执行已经授权的只读核验；有权限的管理员负责生产访问权限，以及部署、迁移、恢复、启停消费者等生产变更授权。普通客户不负责选择数据库、队列、技术修复路径。内部批准、客户授权、人工创意验收分别留存，不能互相替代。

A 的 ¥5 数字人口播上限不覆盖 B、全片、推广、发布或生产变更。制作成功不授权发布，发布授权不授权部署。已有有效同范围授权不重复询问；缺管理员访问、扩大范围、授权过期/撤销或需要生产变更时，才升级对应负责人。授权记录至少包括授权人及权限依据、目标实例、允许动作、期限、撤销状态和来源；真实秘密只在受控终端或秘密管理器注入，不进入聊天、命令参数、仓库或报告。

## 可立即执行的离线顺序

在权威仓库根目录使用可信 Node 执行以下命令。只用签入的占位符模板，不将实际生产 env 传给检查工具，不 source 模板，不启动 app/worker。

```sh
node scripts/infra-prep-config-check.mjs
node scripts/infra-prep-postgres-readonly.mjs --dry-run
node scripts/infra-prep-backup-restore.mjs
```

第一项只检查模板合同，模板保留缺失项时非零退出是预期阻塞，不应补造配置。第二项输出固定只读 SQL，第三项输出备份预检计划；两者默认零连接、无服务写入。默认不传 manifest，避免意外读取真实备份路径。输出保存为本次离线准备证据，不能标记真实设施通过。需要验证准备工具行为时，使用既有隔离测试与网络 guard，不能直接加载 server 入口；具体测试通过数以本次实际日志为准，本清单没有重跑测试。

## 工具边界：不能误用名称判定只读

| 工具/动作 | 默认及实际边界 | 本轮适用性 |
| --- | --- | --- |
| `infra-prep-config-check.mjs` | 读取指定本地模板；不加载 dotenv、不查运行环境、不连接服务 | 可检查签入占位模板 |
| `infra-prep-postgres-readonly.mjs` | 默认 dry-run；`--execute` 才启动 psql，使用受限环境和固定只读事务 | 在线模式等待授权及目标确认 |
| `infra-prep-backup-restore.mjs` | 默认 dry-run；`--execute-read-only` 先读 PG/Redis 备份文件并核 SHA256，再连接 PG/Redis 执行 SELECT、PING、INFO | 不是零连接；不创建备份、不恢复 |
| `runtime-evidence-collector.mjs` | 离线合同检查始终 `runtimeVerified:false` | 不替代可信来源验真 |
| `cloud-backend-preflight.ts` | 会连接 PG/PB/Redis/COS；PB admin auth、SDK/队列探针不是全局零写保证 | 不作为本轮离线/严格只读入口 |
| PB→PG migration `--plan` | 认证并读取真实 PB 源 | 不是离线，需范围授权 |
| PB→PG migration `--verify` | 建 schema、写迁移报告，即使输出 `destructive:false` | 不得用于只读核验 |
| `postgres:schema` / migration `--apply` | DDL、记录复制、索引变更；文件复制另有 COS 写入 | 需独立生产变更授权 |
| app/server/worker 或 production Compose 启动 | 加载实际环境，可能启动 scheduler、心跳写入与消费；Compose 强制 worker 角色并开启爬虫 | 不得作为只读准备 |
| `deploy/backup.sh` / update / restore | 创建备份或变更服务/数据；备份脚本只覆盖 PB+应用数据 | 不是只读探针，需对应授权 |

## 恢复访问后的只读顺序

每步缺证据即记录该项阻塞，继续不依赖它的离线准备；不能降低门禁或改写结果。以下步骤须先有管理员提供的可达目标、批准的只读范围与受控凭据。本轮不执行。

1. **固定实例和代码身份。** 在批准的交互 SSH 终端只读核对 checkout 的 origin、branch、HEAD、工作树和 divergence；origin 必须符合 `AGENTS.md`。输出 Git remote 前核对其中无嵌入凭据。此阶段不 pull、不 stash/reset、不运行部署。把服务器 SHA 与批准候选 SHA 分开记录。
2. **PostgreSQL。** 管理员注入独立只读连接和 TLS 配置，核有效配置来源，避免 `.env.local` 覆盖。使用审定的非秘密全量 manifest 执行：

   ```sh
   node scripts/infra-prep-postgres-readonly.mjs --execute --manifest /APPROVED_PATH/migration-manifest.json
   ```

   核 core schema、实际有效/ready/immediate/unique 索引、租约三键及完整 partial predicate、全部 collection 数量和 PG-only/untracked 数量。`schemaReady` 与迁移元数据通过不能证明全量迁移；工具保留 `migrationReady:false`、`currentDataVerified:false`。另需独立冻结源快照与目标当前数据 digest、完整分页、tenant/task/run/version 关联及文件内容 SHA256。真实多客户端租约争用会写测试数据，须在明确专属隔离目标另行授权，不并入本只读序列。
3. **Redis/BullMQ。** 核生产 `QUEUE_BACKEND=bullmq`、批准 Redis DB 与唯一 `BULLMQ_PREFIX`、TLS、持久化及版本；通过批准的只读 Redis ACL 查看现有 PING/INFO 与指定 namespace 队列状态。不 enqueue、不启动消费者、不调用未知 SDK 方法；生产拒 local fallback。去重、重连、实际消费和恢复演练均需另行授权专属隔离测试。
4. **Worker、鉴权和存储。** 只读观察现有进程角色、同部署 SHA、队列连接状态、持久 heartbeat 时间和 max-age；不启动 worker 或伪造心跳。核精确 `NODE_ENV=production`、PB 身份依赖及有效 fallback policy；PG 业务切换不取消 PB users/auth。真实 token refresh/outage 及撤销测试另按凭据范围授权。COS 核对象引用、授权来源、大小与下载 SHA256；不上传/删除对象，下载权限及敏感内容范围由管理员确认。
5. **已有备份。** 核 PB/app、PG、Redis、COS 各自备份和同一冻结恢复点、加密、hash、版本、activeJobIds、unknownAttemptIds、备份后写入。现有 PB/app 备份不能当作完整覆盖。仅在批准文件路径及连接范围后执行：

   ```sh
   node scripts/infra-prep-backup-restore.mjs --execute-read-only --manifest=/APPROVED_PATH/backup-manifest.json
   ```

   `restoreEligible` 只是 preliminary；hash 与元数据通过不证明可恢复。真实恢复演练须另行授权专属隔离目标，未知外发任务不重播。
6. **readiness 原始结果。** 核已批准的服务地址，采集状态码、Content-Type、精确 JSON、实例/SHA 与时间。`/health` 200 或 `/ready` HTML 不通过。ready handler 会连接依赖，完整探针的零写边界需先审核；不得通过启动服务、删 required capabilities 或调整 fallback 得到假通过。路由修复及上线是独立生产变更。
7. **六类来源验真。** 只读读取既有原始证据并核同 scope、版本、账号、时间、来源及原 attempt，不为补证据发送消息或发布。缺失来源交对应执行负责人，基础设施配置不替代业务真实性。

## 六类真实证据清单

| evidence key | 必需权威来源 | 当前结论 |
| --- | --- | --- |
| `tenant_authenticated_scope` | 正式身份上下文、同租户完整 DataStore 只读导出 | 未验真 |
| `weekly_package_and_execution_graph` | 正式周包、固定版本图、持久 job 和真实节点记录 | 未验真 |
| `whatsapp_connected_account_and_approved_recipient` | WABA/phone identity、当前授权、批准 recipient、delivered/read 原回执 | 未验真；不得发送补证据 |
| `messenger_connected_page_and_scoped_recipient` | 实际 grants、Page 归属/订阅、同 Page PSID、原回执 | 未验真 |
| `instagram_connected_professional_account_and_scoped_recipient` | provider 专业账号回读、正式签名入站 webhook、recipient 关系 | 未验真 |
| `publication_account_token_and_provider_capability_receipt` | 当前 token authority、可信 provider probe、原 attempt、最终回执 | 未验真；不得发布补证据 |

六类证据以 `real-runtime-evidence-spec.md` 为合同。不能将离线 collector 输出、配置 flag、平台批准自填值或其他租户/版本回执提升为真实验收。统一 MVP 执行包由经营/编导 Agent 冻结；本会话不替 A–D 选产品、拼接候选或创建授权。

## 当前阻塞与管理员例外

最后一次已有线上记录（2026-10-10）为 `43.159.41.222:22` SSH banner 超时、公网 `/api/overseas/ready` 返回 SPA HTML。本轮未重试，因此不能声称 2026-10-11 连通状态有变化。远端 SHA、实际 PG/Redis/Worker/PB/COS、完整备份和六类正式证据仍未确认；生产 `ready:true` 尚无权威证明。

管理员例外应一次收束为：可达主机/端口/用户名与只读访问范围、批准候选 SHA、批准目标/namespace、受控凭据与备份 manifest 的来源。若诊断要求部署、迁移、恢复、启停消费者或扩大访问，提交具体修复包、证据、推荐方案及所需授权给管理员；不得让普通客户承担技术判断。部署获独立授权后仍须遵守交互 SSH、现有 checkout GitHub HTTPS、`git pull --ff-only` 和 `bash deploy/update.sh` 的 canonical 路径；本清单不授权这些动作。

后续汇报继续分开记录八项：本地受控合同、真实媒体、真实付费供应商、创意质量、真实发布、真实平台回执、真实指标、生产 ready:true；另记录 Agent 已自主完成的决策、管理员例外及依据。本轮完成的是只读验收准备文档，未新增任何真实运行通过结论。
