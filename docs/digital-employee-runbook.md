# 数字员工运行手册

## 安全边界

- 生产环境禁止本地存储 fallback；开发时仅在显式设置 `ENABLE_LOCAL_STORE_FALLBACK=true` 后启用。
- 支持会话对数字员工 API 只读。审批只能由绑定负责人执行。
- 真实发布默认需人工审批。未有已批准的 payload hash、目标账号、排期和渠道连接时，只写 `outbound_action_ledger.status=dry_run`，不写入 `posts`。
- 正式发布必须同时设置 `PUBLISH_SCHEDULER_ENABLED=true`、`DIGITAL_EMPLOYEE_VOICEOVER_MODE=required` 和可用的 DashScope/Qwen 或 MiniMax 凭证；启动时会 fail fast。
- 平台调用只有收到确定性 4xx 拒绝才允许进入失败重试。无响应、网络超时、408/409/425、5xx、成功但缺少平台内容 ID，或成功结果未能可靠落库，都会立即停止后续账号并进入 `needs_reconciliation`；必须逐账号提交平台回执，禁止 blind retry。`PUBLISH_ACCOUNT_TIMEOUT_MS` 应小于 `PUBLISH_SCHEDULER_LEASE_MS`，服务会把活跃 lease 至少延长到调用超时后 60 秒。

## 口播与成片质量门禁

- 数字员工使用与 Studio 相同的 `DASHSCOPE_API_KEY`/`QWEN_TTS_*` 和 `MINIMAX_*` 配置契约。`DIGITAL_EMPLOYEE_TTS_PROVIDER=auto` 按 Qwen、MiniMax 顺序尝试；固定 provider 时不会暗中换引擎。
- 口播会先校验返回地址、公网 DNS、大小和音频魔数，再通过 FFmpeg 解码为 24kHz 单声道 WAV。租户私有文件存入 `data/tts/tenants/<tenant>`，用输入指纹幂等复用，并将 provider、音频 SHA-256、字节数、时长、原文 SHA-256 写入 Studio 项目元数据。
- 已配置 provider 时，请求失败、超时、返回超限、魔数伪造、无法解码或超过 60 秒都会使渲染失败，不得回退为静音成片。
- 只有非生产、未开启 real-publish 的自动化测试可显式设置 `DIGITAL_EMPLOYEE_VOICEOVER_MODE=silent_test`。该产物元数据标为 `silent_fallback`；生产或 real-publish 会拒绝此回退。

## 本地验证

1. `npm ci`
2. `npm run test:digital-employees`
3. `npm run lint`
4. `npm run build`
5. 配置本地 PocketBase 后运行 `npm run setup:pb -- --check`，检查数字员工集合及唯一索引。

## 恢复演练

- 停止 API/Worker，备份 PocketBase `pb_data` 和迁移版本。
- 重启后 Worker 扫描 `planning`/`running` 运行；过期 lease 会重新被领取。
- 重复任务通过 `run_id:task_key:version` 幂等键恢复；Studio 草稿使用原表 `legacy_id` 去重。
- 事件以 `(tenant_id, run_id, sequence)` 唯一，冲突时有限重试；客户端以游标补拉。

## 可观测性

- `/api/overseas/livez` 只验证进程存活；`/api/overseas/readyz` 同时验证 PocketBase、canonical schema、worker 心跳和积压，编排器必须使用后者。
- `/api/overseas/metrics` 输出基础 Prometheus 指标；生产环境需要 Bearer `METRICS_TOKEN`。
- HTTP 异常输出结构化 JSON，包含 requestId；outbox backlog/dead-letter 与定时发布人工对账会进入 readiness/metrics。
- 建议对 `workflow_runs` 长时间 running/waiting、过期 lease、`workflow_tasks.attempt >= max_attempts`、outbox 积压和失败率设置告警。

## 已知剩余风险

- 商品导入已固定到仓库内的 SheetJS `0.20.3` 官方 tarball，生产依赖审计为 0 漏洞；CSV/XLSX 回归由 `npm run test:storage-hardening` 覆盖。
- Electron 开发依赖已升级并完成桌面入口安全加固；当前 `npm audit`（包含 devDependencies）与 `npm audit --omit=dev` 均为 0 漏洞。服务端生产运行时仍只安装 production dependencies。
