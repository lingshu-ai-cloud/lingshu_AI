# 生产 readiness 门禁审计

2026-10-10，仅本地离线审计。没有启动 `server/index.ts`、后台 worker、供应商请求或生产基础设施。当前执行 shell 未加载生产 env；目标配置变量的 env presence 全部缺失，不能由此推断生产机器缺少凭据。修复后实际默认 key-file fallback 让本地 text/qwen 配置门禁通过；本地生产默认策略余下 TTS、video、digital_human 三项配置阻塞。顶层 ready=false，生产数据库/队列/worker 仍未观测。

```sh
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
pnpm exec tsx scripts/production-gate-readiness-audit.ts
pnpm exec tsx --test server/runtime/readiness.test.ts server/runtime/processRole.test.ts server/runtime/contentExternalPreflight.test.ts
pnpm exec tsx --test scripts/production-gate-readiness-keyfile.test.ts
```

审计脚本仅输出变量名与 presence 布尔，不输出凭据值、不读取 dotenv、不执行配置指定的 Python；readiness helper 对私有密钥文件仅核验可读且非空，内容不序列化。配置在受控副本中按 production 默认策略计算，结果不等于实际运行 ready。既有 3 个测试文件通过；新增 Qwen 文件凭据兼容测试首次失败：实际 `dashscopeApiKey()` 接受可读 `DASHSCOPE_API_KEY_FILE`，`runtimeCapabilities()` 的 text/qwen 两项仅检查 `DASHSCOPE_API_KEY`，导致 false-negative。已按 root 授权修正同一 helper：text/qwen/semantic/逐句语义门禁共同检查真实可读且非空文件；missing、空白和目录均保持阻塞。provider 默认 home 路径与实际 client 一致；注入 env 的离线函数只使用明确指定文件。新增安全测试还验证 unknown required 必须失败且不输出凭据。最终 focused command 为 5/5 PASS；`git diff --check` 通过。

## 默认生产能力与精确配置

未指定 `REQUIRED_CAPABILITIES` 时默认要求 `text_generation,qwen_generation,tts,video_generation,digital_human`。即使 `OVERSEAS_LLM_BACKEND=gemini`，仍额外要求 Qwen。

| 能力/组合 | 配置门禁要求 |
|---|---|
| text_generation | `OVERSEAS_LLM_BACKEND=qwen`（默认）+ `DASHSCOPE_API_KEY` 或可读非空 `DASHSCOPE_API_KEY_FILE`；或 `OVERSEAS_LLM_BACKEND=gemini` + `GEMINI_API_KEY` |
| qwen_generation | `DASHSCOPE_API_KEY` 或可读非空 `DASHSCOPE_API_KEY_FILE`（修复后与实际 client 一致） |
| tts | `MINIMAX_API_KEY`、`PIPER_BIN`、`XTTS_BIN` 至少一个存在；未验证本地二进制或供应商凭据 |
| video_generation | `SEEDANCE_VIDEO_ENABLED=true` + `SEEDANCE_API_KEY`；或 `GEMINI_VIDEO_ENABLED=true` + `GEMINI_API_KEY` |
| digital_human | 下表任一 provider 组合完整即可；配置完整不是付费执行成功 |
| starter_workers（显式 required 才影响 ready） | worker/all role，且 `STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED=true`、`STARTER_QUOTE_ARTIFACT_WORKER_ENABLED=true`、`STARTER_198_ORCHESTRATOR_WORKER_ENABLED=true` |
| scheduled_publishing（显式 required） | worker/all role + `PUBLISH_SCHEDULER_ENABLED=true` |
| quote（显式 required） | `QUOTE_SKILL_ENABLED=true` |
| platform_ads（显式 required） | `TENANT_PLATFORM_APP_KEY` |

| 数字人 provider | 必需变量组合 |
|---|---|
| HeyGen | `HEYGEN_GENERATION_ENABLED=true`、`HEYGEN_API_KEY` |
| Custom | `DIGITAL_HUMAN_API_URL`、`DIGITAL_HUMAN_API_KEY` |
| Runway Act-Two | `RUNWAY_ACT_TWO_ENABLED=true`、`RUNWAYML_API_SECRET`、云存储四组；正数 `RUNWAY_ACT_TWO_CNY_PER_CREDIT`、`RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND`、`DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT`、`DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY` |
| Seedance Reference | `SEEDANCE_REFERENCE_ENABLED=true`、`SEEDANCE_API_KEY`、`SEEDANCE_MODEL`、云存储四组；正数 `SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND`、`DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT`、`DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY` |

云存储四组各至少一项：endpoint=`OBJECT_STORAGE_ENDPOINT`/`R2_ACCOUNT_ID`/`COS_ENDPOINT`/`COS_REGION`；access=`OBJECT_STORAGE_ACCESS_KEY_ID`/`R2_ACCESS_KEY_ID`/`COS_SECRET_ID`；secret=`OBJECT_STORAGE_SECRET_ACCESS_KEY`/`R2_SECRET_ACCESS_KEY`/`COS_SECRET_KEY`；bucket=`OBJECT_STORAGE_BUCKET_NAME`/`R2_BUCKET_NAME`/`COS_BUCKET`。当前配置门禁允许跨组混用别名，只证明字段存在，未验证 driver 组合和可达性。

逐句复刻独立于 generic video switch：Seedance 要求 `SEEDANCE_SENTENCE_ENABLED=true`、`SEEDANCE_API_KEY`、`SEEDANCE_MODEL`；HeyGen 要求该 provider 的上述两变量；两者均要求 `SEEDREAM_API_KEY` 或 `SEEDANCE_API_KEY` 用于目标人物首帧。`OBJECT_STORAGE_DRIVER` 生产默认 cos，需要云存储四组；local + Seedance 另要求 `LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL` 为 HTTPS。开启 `DIGITAL_HUMAN_SEMANTIC_QA_ENABLED=true` 时另要求 `DASHSCOPE_API_KEY` 或 `DASHSCOPE_API_KEY_FILE` 以及 `QWEN_DIGITAL_HUMAN_QA_MODEL`。

自动放行需同时有：`DIGITAL_HUMAN_VISUAL_QA_PYTHON` 实际执行 `person_replacement_visual_qa.py --self-check` 通过；语义 QA 上述开关与模型；`DIGITAL_HUMAN_SYNCNET_QA_ENABLED=true`、`DIGITAL_HUMAN_SYNCNET_QA_PYTHON`、`DIGITAL_HUMAN_SYNCNET_DIR` 及模型/runner 文件。`material_cleanup` 需 `MATERIAL_CLEANUP_PYTHON`、`MATERIAL_CLEANUP_SCRIPT`，实际 self-check 还要求 `seedanceUsed=false`。QA provider 凭据仅按配置核验，渲染结果仍需逐条真实质量凭据。

## 真实 ready 的数据库、队列和 worker 边界

`runtimeReadiness` 读取 PocketBase health、`starter_198_access` 和社交经营集合；业务切换 `DATA_BACKEND=postgres` 时还需 `DATABASE_URL`、SQL `SELECT 1` 与 `public.lingshu_records`，认证继续依赖 `PB_URL` 和 PocketBase。集合权限使用 `PB_ADMIN_EMAIL`、`PB_ADMIN_PASSWORD`；审计不读取其值，也没有尝试认证。`QUEUE_BACKEND=bullmq` 要求 `REDIS_URL`，实际检查 Redis/BullMQ 健康（超时 `BULLMQ_HEALTH_TIMEOUT_MS`）；local 模式不执行此检查。

`PROCESS_ROLE=web/worker` 需要 `PROCESS_ROLE_SPLIT_ENABLED=true`。Compose app=web、worker=worker，worker 无 HTTP listener。web ready 从数据库读取真实 worker heartbeat：默认 `WORKER_HEARTBEAT_MAX_AGE_MS=60000`、`WORKER_HEARTBEAT_INTERVAL_MS=15000`；过期、缺失、未来时钟、build mismatch 都受阻。构建 SHA 来自 `APP_BUILD_SHA`/`GIT_COMMIT_SHA`/`COMMIT_SHA` 或 git；unknown SHA 降低版本一致性验证。all/worker readiness 使用当前进程 `backgroundJobRuntimeState`，独立 audit 进程不会代表已有 worker。

worker ready 只表明后台初始化完成并 heartbeat 新鲜/版本匹配。它不证明每个执行周期正在推进、每个开关启用、真实供应商成功、账号授权有效、发布已发生或剩余预算可信。`weeklyExecution` 的 web 返回值明确来自 `local_process`，不能把 web 本地计数当 worker 容器生产进展。

## 部署容器中的只读复现（仅文档，未执行）

在已有部署 checkout，复用容器内环境，不启动新 server，不使用 `docker compose up/run`：

```sh
# 各容器仅执行配置函数；不显示 env 值。
docker compose exec -T app pnpm exec tsx scripts/production-gate-readiness-audit.ts
docker compose exec -T worker pnpm exec tsx scripts/production-gate-readiness-audit.ts
# 读取已有 web listener 的真实运行门禁；HTTP 503 保留 body 判断问题。
docker compose exec -T app curl -sS -i http://127.0.0.1:8788/api/overseas/ready
```

发布 compose `deploy/compose.release.yml` 只有 app，无独立 worker service；应按部署实际文件使用 `docker compose -f deploy/compose.release.yml exec -T app ...`，不要套用 worker 命令。审计没有执行任何部署命令。

若 audit 文件尚未存在于部署 checkout，不复制、不部署；只用已有 GET ready。其响应可能包含底层数据库错误字符串，分享前需自行脱敏，禁止公开连接凭据。镜像无 pnpm/tsx 时保留现有 HTTP GET 复现，不安装依赖。不在独立 worker 容器启动 `server/index.ts` 来“验证”门禁。

本地结果保存 `work/production-gate-readiness/configuration.json`、`contracts.log`、`keyfile.log`。区分代码合同失败（Qwen key-file 不一致）、本shell配置未加载、以及未观测的生产环境/数据库/凭据有效性；没有将其混为已证实生产不可用。

## 周包发布环境 probe 当前九项阻塞

root 当前基线 `probeWeeklyProductionEnvironment` 为 `ready=false`，九项如下。此分类来自 `weeklyProductionEnvironmentReadiness.ts` 与 `weeklyProductionEnvironmentProbe.ts`，不是旧七项基线。这里没有另联生产复查。

| check key | 必需配置/证据 | 缺口类别 |
|---|---|---|
| postgres_business_store | `DATA_BACKEND=postgres` + `DATABASE_URL` | 配置 |
| atomic_publication_lease | PostgreSQL 的 `idx_lingshu_durable_operation_lease_subject` 必须有效、即时且唯一，覆盖 tenant_id/lease_scope/subject_id，predicate 精确对应 durable_operation_leases | 运行存储/schema证据；实现已存在，非已证实代码缺失 |
| durable_worker_queue | `QUEUE_BACKEND=bullmq` + `REDIS_URL` | 配置 |
| production_auth_fail_closed | `DISABLE_LOCAL_AUTH_FALLBACK=true` 且 `ENABLE_LOCAL_DEV_FALLBACK` 不为 true | 配置/安全策略 |
| meta_social_oauth | `META_SOCIAL_APP_ID` + `META_SOCIAL_APP_SECRET` | OAuth 配置 |
| instagram_login_oauth | `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` | OAuth 配置 |
| instagram_publication_scope | `INSTAGRAM_CONTENT_PUBLISH_ENABLED=true` | 授权开关 |
| tiktok_direct_post | `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` + `TIKTOK_DIRECT_POST_RELEASE_MODE=approved` | 应用审批配置 |
| durable_worker_queue_connection | 实际 queue probe 成功且 queue backend 为 bullmq | 运行依赖；无连接观察时不可证明 |

此外必须逐租户/逐任务核验六类持久证据：`tenant_authenticated_scope`、`weekly_package_and_execution_graph`、`whatsapp_connected_account_and_approved_recipient`、`messenger_connected_page_and_scoped_recipient`、`instagram_connected_professional_account_and_scoped_recipient`、`publication_account_token_and_provider_capability_receipt`。配置完整不得代替这六类真实证据。

九项是父任务当前探测环境的阻塞结果，不能推断已部署机器的同名配置必然缺失。Instagram开关不能代替实际 content_publish 权限与专业账号授权；TikTok release mode 字符串不能代替平台批准凭据。数据库缺索引时需独立审批迁移，本次仅指出要求，不执行DDL。
