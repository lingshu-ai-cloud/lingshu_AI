# 会话 E：生产基础设施与上线门禁只读复核

复核时间：2026-10-10 23:15（Asia/Shanghai）。本地基准 HEAD：`9e1b1236c15b8cec21cf6aa7f099d69b1436e78b`；分支：`XIXI改数字员工联调（未完成版）`。origin 为 `https://github.com/lingshu-ai-cloud/lingshu_AI.git`。工作树含其他会话改动，本次仅提交本报告。三名子 Agent 分别复核基础设施、readiness 路由、六类证据。

## 本轮直接证据

- 无认证 GET `https://app.lingshu.site/api/overseas/ready`：HTTP/2 200，`content-type: text/html; charset=UTF-8`，`via: 1.1 Caddy`，`x-powered-by: Express`；正文以 `<!doctype html>` 开始。此结果不构成 readiness 通过。
- `ssh -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=8 -o ConnectionAttempts=1 root@43.159.41.222 true`：退出 255；`Connection timed out during banner exchange`、`Connection to 43.159.41.222 port 22 timed out`。未进入远端，远端 origin、分支、HEAD、工作树与 divergence 全部未核验。
- 使用桌面 bundled Node 执行既有 `runtime-evidence-collector`、scope/customer/provider 和六组 `infra-prep` 测试：61 tests，61 pass，0 fail。它们使用受控夹具，不证明真实生产服务。
- 未读取真实 env 或凭据，未启动 Worker/Compose，未连接生产数据库/队列，未迁移、恢复、付费调用、发布、推送或部署。

## /ready 修复准备与边界

`server/index.ts` 已在 API limiter 和 SPA fallback 前注册 JSON readiness 路由；非 ready 返回 503。`server/runtime/readiness.ts` 的运行报告使用 `status: ready|degraded`、`build`、`role`、`issues`，不同于周执行门禁的 `ready: boolean`。

公网 HTML 支持旧服务或错误 upstream 的假设，但不能证明具体远端 SHA，也不能在 SSH 阻塞时确定代理配置。当前源码已含路由，盲目再加路由无法解决现网问题。

另有独立缺口：`deploy/update.sh` 末尾仅 `curl -fsS .../ready`，会误接受 HTML 200。未来获部署授权前，应准备严格探针验证：HTTP 200、JSON content type、可解析对象、`status === 'ready'`、空 issues、预期 build SHA 和角色；再单独核周门禁 `ready:true`。本次按安全只读范围记录修复要求，未修改或运行部署脚本。

## 基础设施待核验清单

| 范围 | 源码准备及真实缺口 |
| --- | --- |
| PostgreSQL | 要求业务 backend、数据库配置和 TLS；需真实 catalog/唯一索引、完整 manifest/count/current-data digest、租户任务版本关联。业务迁入 PG 后 users/auth 仍依赖 PocketBase。尚无生产连接证据。 |
| Redis/BullMQ | 要求生产持久队列、独立 DB/prefix；需持久化策略、去重、重连、backlog/failed/stalled 与真实消费证据。配置模板不是实际配置。 |
| Worker | 需 web/worker 角色拆分、同部署 SHA、队列连接、持久心跳及恢复证据；现有启动会触发 scheduler/消费，不属于本轮只读动作。 |
| 鉴权 | production 源码强制禁止本地 fallback；静态配置缺 flag 不等于已观察到现网漏洞。仍缺真实 PB 身份、token 生命周期与故障 fail-closed 证据。 |
| 对象存储 | 生产要求 COS；需真实对象 HEAD、size、内容 SHA256、授权引用。只核配置存在不能证明对象可读，凭据不得入报告。 |
| 备份 | 当前 canonical 脚本覆盖 PB 与 app data，未完整覆盖 PG/Redis/COS；需一致恢复点、独立 artifact/hash/version、对象清单、active jobs/unknown attempts 对账与隔离恢复演练。 |

`infra-prep-postgres-readonly.mjs` 默认 dry run；未来真实执行需可达目标及授权。迁移 `--verify` 包含 DDL/报告写入，不能当作只读探测。恢复演练也不得在生产执行。

## 六类真实证据

以下六类均有规范/离线合同，均缺当前正式范围的可信生产验真：

| evidence key | 缺失权威来源 |
| --- | --- |
| tenant_authenticated_scope | 正式身份上下文与完整同租户 DataStore 只读导出 |
| weekly_package_and_execution_graph | 正式周包、固定版本图、持久 job 与真实节点运行记录 |
| whatsapp_connected_account_and_approved_recipient | WABA/phone identity、当前授权、批准 recipient 与 delivered/read 回执 |
| messenger_connected_page_and_scoped_recipient | 实际 grants、Page 归属/订阅、同 Page PSID 与原回执 |
| instagram_connected_professional_account_and_scoped_recipient | provider 专业账号回读、正式签名入站 webhook 与 recipient 关系 |
| publication_account_token_and_provider_capability_receipt | 当前 token authority、可信 provider probe、原 attempt 与最终回执 |

collector 强制 `runtimeVerified:false`；离线检查通过不能提升成真实证据。九项周 readiness 即使通过，也不消费或验真上述六类证据。Instagram Login 原生发布路径仍有 fail-closed 缺口，配置开关与 TikTok approved flag 不替代平台批准。

## 八项汇报

| 口径 | 结论 |
| --- | --- |
| 本地受控合同 | 本轮基础设施与证据合同 61/61 通过；既有平台 54/54 记录本轮未重跑。 |
| 真实媒体文件 | 既有本地 MP4 记录为 8.56 秒、720×1280、H.264/AAC；本轮未生成或重新验媒体。 |
| 真实付费供应商 | 本轮未调用；既有该 MP4 未调用真实数字人或关键 AIGC 供应商。 |
| 创意质量 | 既有成片未通过，需修改、不可发布；本轮无新增验收。 |
| 真实发布 | 未完成，本轮未发布。 |
| 真实平台回执 | 未取得可信新增回执。 |
| 真实指标 | 未回收，不能补零或伪造。 |
| 生产 ready:true | 未证明；公网为 HTML，远端与真实依赖不可核验。 |

## 继续条件

首先需要可达的 Ubuntu SSH 主机、端口与用户名；凭据仅在交互式终端输入。恢复连通后先只读核对远端 Git 状态、服务角色、真实依赖、备份和六类证据。迁移、恢复、启动消费、部署、付费和发布须有对应明确授权；部署只能按 AGENTS.md 的交互式 SSH、GitHub HTTPS 与 `bash deploy/update.sh` 路径进行。当前状态为“只读准备完成，生产验收阻塞”，不能标记上线完成。
