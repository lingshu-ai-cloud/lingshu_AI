# 会话 D：单平台发布与指标闭环准备

日期：2026-10-10。权威目录为 `local-integrated-flow`。本轮协调 OAuth/归属、attempt/恢复、指标三个子 Agent，执行本地受控验证；没有真实 OAuth、平台请求、发布、付费生成、部署或迁移。工作树已有其他会话修改，本次仅提交 D 负责文件。

## 发布前可审查清单

| 项目 | 具体候选与证据 | 当前结论 |
| --- | --- | --- |
| 平台/账号 | Facebook，Ads Integration Test Lab；Page `1323567870837055`；account `social_accounts_ff33bdc3e749450dbfb158a7ca0afb26`；`data/local-store/social_accounts.json` 唯一记录 | 候选，尚非可用发布账号 |
| 账号归属 | `local_tenant_customer_messenger_smoke_20261009`；旧消息迁移证据出现 `agucjnsbxaz7cl3` | 必须由责任人确认内容任务与账号同租户；不得跨租户借用 |
| OAuth | 现有 scope 为 pages_show_list、pages_read_engagement、pages_messaging、pages_manage_metadata；缺 pages_manage_posts。tenant Meta app 有配置但 pending；token 有值，无到期记录 | 发帖 grant、当前 token 身份/有效期、原生 Page 管理资格及能力探测未核验。未保存 secret |
| 内容 | 历史候选 `artifacts/e2e/topfeelpack-2026-09-27/topfeelpack-viral-remix-final.mp4`，8.56 秒、720×1280、H.264/AAC | 技术通过、创意不可发布；不能直接作为本次发布包。须由会话 C 提供同租户 task/version、SHA256、可发布人工验收、标题/文案/封面/素材授权 |
| 预算 | 本轮实际外部请求与付费支出为 0；未获真实发布及推广预算 | 后续拟定仅 1 条自然发布、0 推广支出；供应商费用以 A/B/C 证据为准，仍须明确批准，不假定免费或已付费 |
| 动作 | 待门禁齐备后，通过现有受鉴权发布入口，对冻结版本创建一个原 attempt，向上述 Page 发布一次视频，保存平台 ID 与原始脱敏回执 | 待批准；当前不可执行，无批准编号 |
| unknown | 超时后只查询该原 attempt/provider receipt，禁止重置、重复创建、盲目重发 | 本地受控通过，真实演练未完成 |
| 指标 | 按同 account/native post ID 回收播放、赞、评、转；保存捕获时间、缺失原因和脱敏平台响应 | 无真实数据；缺失保持暂无数据。账号级 shares 不得归属单条视频 |

`artifacts/customer-smoke/real-messenger-results.json` 只证明消息能力；connected、环境 flag、pending app 与旧 receipt 均不证明发帖资格。现在不存在全部条件齐备的具体发布包，因此本轮不请求空泛发布批准。责任人应先补齐上述外部证据和 C 的内容包，再批准精确账号、版本、可见性、预算与动作。

## 本地受控证据

- `node scripts/platform-production-readiness.controlled.mjs`：54/54 通过。runner 清除真实凭据并隔离网络，覆盖 OAuth nonce、tenant app、TikTok consent、Instagram publishing、原 receipt 恢复和 Worker 合同；不证明真实平台批准。
- 原 attempt 精准测试 8/8 通过：`platformPublisherRecovery`、`receiptRecovery`、`pendingPublishGuard`、`directPublishLease`、`publishSourceClaim`、`weeklyPublicationRuntime`、`platformPublisherTikTok`、`weeklyPublicationExecutionWorker`。unknown 重复执行断言 publishCalls=1，provider 漂移拒绝，未决 attempt 重置/重提 409。
- 执行器使用 `/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`，仓库根目录运行；平台日志位于 `work/session-d/platform-controlled.log`。
- 指标归一化与四平台视频适配缺失值测试独立复跑 2/2 通过；子 Agent 的指标/复盘精准测试 4/4 通过。额外重跑 `weeklyDurablePublicationReview.integration.test.ts` 出现 `weekly_quality_audit_detector_report_unverified`，不能记为通过；该失败需由质量门禁负责会话核对共享工作树的 detector 证据，不降低门禁。
- 最终 `tsc --noEmit` exit 0，diff 空白检查通过。YouTube 视频播放/评论缺失展示“暂无数据”，明确返回的 0 仍正常展示。

手工 receipt 恢复目前只支持 YouTube。上传超时无视频 ID 时保持 unknown，由人工找到 ID 后核验原 attempt、频道、跟踪链接、时间和公开状态。Instagram 容器 PUBLISHED 缺最终媒体 ID 仍 unknown，不能重新 container publish。自动 YouTube/FB receipt 查询没有再次核验频道/Page 归属，必须保持上层原 attempt 与能力绑定证据；任意可读媒体 ID 不能证明本次发布。

## 真实指标与复盘边界

审计发现 `Number(null)`、空字符串和 boolean 会伪造零；部分平台视频适配层与采集路由也存在 `|| 0`。本轮修复单视频采集路径与指标归一化，保留供应商明确返回的零，缺失字段不写入快照。单条视频无数据时不得生成基于虚构表现的复盘或下轮推荐。

YouTube 单视频 statistics 不返回 shares，现有 shares 为账号级 daily analytics，不能补作该视频转发。账号级 analytics 的缺列补零及快照 raw_metrics 仅 source 标签的证据完整性仍需后续处理；真实采集时必须独立保存脱敏供应商响应。未找到本次 MVP 的真实社媒 attempt、回执、指标或真实 unknown 演练。

发布后应先捕获真实累计 baseline，再在观测窗口回收后续值；首个累计观测不是流量增量，不能虚构发布时基线为 0。复盘需要真实 receipt、归因与有效 baseline；不足时仅 observe。默认 minimumOwnedContent=2，单条 MVP 仍可能显示 insufficient，不能据此声称扩量验收通过。

## 八项汇报

| 口径 | 结果 |
| --- | --- |
| 本地受控合同 | 本轮平台准备 54/54、原 attempt 8/8 通过；指标修复验证见提交附记 |
| 真实媒体文件 | 历史真实 MP4 存在；本轮未生成新的 MVP 成片 |
| 真实付费供应商 | 本轮未调用；历史供应商证据不代替本次 MVP |
| 创意质量 | 历史候选未通过；等待 C 的可发布验收 |
| 真实发布 | 未执行，未批准且门禁未齐 |
| 真实平台回执 | 未取得 |
| 真实指标 | 未回收，保持暂无数据 |
| 生产 readiness=true | 未证明；既有记录 ready=false，公网 ready 返回 HTML，见 production-live-probe-2026-10-10.md；本轮未重测生产 |
