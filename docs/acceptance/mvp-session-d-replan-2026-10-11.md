# 会话 D：按 5bd6708 重规划

日期：2026-10-11；依据《缺口与MVP测试》第 11–12 节。三个子 Agent 分别只读核验统一身份/账号、授权/原 attempt、指标；主 Agent 补充现有运行入口的人机边界测试。未真实 OAuth、发布、付费生成、部署或迁移。

## 身份门禁与一次发布审查包

没有最终统一执行包，以下是明确阻塞的审查草案，不能当成授权或可执行发布任务。经营/编导负责人应统一后交付 D，D 不另选产品、账号或版本。

| 字段 | 权威现状 / 待冻结要求 |
| --- | --- |
| tenant | A 候选 `local_tenant_customer_1b2913131e2c46deab66172228c4df0a`；最终 tenant 待经营负责人冻结 |
| account / 平台 | A 标签“宏昱智能光学照明”，`local-tiktok-<tenant>` 未找到真实账号实体；最终 account/native identity/platform 未确定 |
| product | A `GUIANFA-RS-001` 与 B `GUIANFA-RS-014` 不同；不得拼接 |
| task / run | A：`workflow_tasks_4d563d4969114a51b1cb31aa1a93a953` / `workflow_runs_4f7c1a1b054146b3925ad0aac87b308b`，与业务项目记录相符；B taskId=null，未证明同 scope |
| project | A `studio_projects_b251759707fa43a499a5dc48f070843f`；B `studio_projects_1f987e702c8e4e4e8b40e6432b80ae32` 未在当前六条业务项目记录中找到 |
| version / 内容 | 最终 version、成片 SHA256、标题/文案/封面、权利证据及 C 最终人工可发布验收均未交付；不能使用历史不可发布 MP4 |
| 可见性 | 未授权；由主会话收束具体范围，不能默认 public/private |
| 数量/期限 | 拟仅一次自然发布；执行期限须纳入有效发布范围授权。扩大数量或期限属例外 |
| 预计支出 | 本轮实支 0；发布费用尚未取得平台/管理员可核验依据，不能假定 0。A ¥5 仅数字人口播上限，不属于 D 或 B |
| 推广预算 | 拟不推广、执行计划推广支出 0；没有已授予推广权限，不创建广告或加热 |
| 发布授权 | 未找到此统一 scope 的有效授权；制作授权、编导批准、humanConfirmed 标记不能替代。已有有效范围不再重复询问，执行前重读其撤销/期限/账号/数量 |
| attempt | 真实 attempt 未创建。批准后现有入口创建一次，绑定统一六项身份与 frozen source hash、授权来源、平台、可见性、费用计划；未知结果仅恢复该原 attempt |

证据来源：`mvp-session-a-input-freeze.json`（blocked_before_paid_submission、zeroFoundationVerified=false）、`mvp-b-aigc-shot-inputs-2026-10-10.json`（blocked_before_paid_call）、本地 `studio_projects` / `social_accounts` 记录。该目标 tenant 无匹配真实社媒账号，`youtube_accounts` 未找到。唯一 Facebook Ads Integration Test Lab 属另一 Messenger tenant，明确排除，不列为这次发布候选。配置、token 存在不等于发布能力；未读取/导出密钥或向平台提交。

## 授权、恢复和指标计划

制作授权与公开发布授权分别记录；发布授权也不授予部署权限（生产操作继续受 AGENTS.md 管理员批准规则约束）。专业 Agent 自主选择内部方案，不能自行创建客户授权。发布前核验同 scope、平台权限、冻结媒体、C 人工验收、有效范围及预算；不满足时只阻塞外部发布，不把内部技术选择再交客户。

发布只提交一次。持久化初始化、provider receipt、原生内容 ID 与脱敏原始回执；超时/unknown 保留原 attempt/provider，通过 query/reconcile 恢复，不能重置或新建 attempt 规避。撤销禁止新外部提交，但不妨碍已有 attempt 对账。缺 final media ID 不能以容器 ID 伪造回执；其他平台手工查询能力不足时保持 unknown。

确认回执后立刻采集真实累计 baseline，并计划 +24h、+72h、+7d 读取同 tenant/account/native content ID 的播放、赞、评、转。每次独立保存脱敏响应、capturedAt、scope、来源和缺失原因；未返回的指标展示暂无数据，供应商明确返回的 0 保留。最终平台未选定，因此不假定转发可读；Facebook 当前视频 adapter 仅播放/赞/评，YouTube 单视频 statistics 无 shares，任何账号级 shares 不可归属本条视频。

现有 store 按 UTC snapshot_date upsert，同 UTC 日会覆盖此前采集。即刻 baseline 需独立证据留存；当前复盘只能以实际保留的跨 UTC 日快照定义窗口，不能宣称完整覆盖发布起算窗口。首累计值不当增量，缺基线不造零，单条默认 minimumOwnedContent=2 仍 insufficient；只输出观察结论及下一轮验证候选，不据此扩量。账号级 analytics 补零、脱敏原始响应持久化与追加式快照仍未关闭。

## 本地测试与实现限制

- 主 Agent：授权、managed effect、冻结来源、weekly runtime 四文件 4/4 通过；新增边界后授权/effect 两文件 2/2 复跑通过。
- 新增测试：有效 scope 连续检查复用已有授权但重读 authority；制作/编导/部署提示不能代替 publishing consent；撤销、跨账号、跨租户拒绝；pending approval 即使 humanConfirmed/directorApproved=true 仍拒绝；审批 tenant/run/hash 漂移均不触发 provider effect。
- 子 Agent：授权/恢复/制作预算九文件 11/11 通过；指标/复盘五文件 5/5 通过。均为本地 fixture，未执行真实外部动作。
- 执行器：`/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx --test ...`；现有入口分别为 assertManagedPublishingAuthorization、withManagedSocialPublication、scheduleManagedSocialArtifact、weeklyPublicationRuntime。

这些测试没有证明第 12.3 节全部实现。ManagedPublishingGrant 尚缺明确可见性、用途、品牌限制和推广预算字段；A/B 同条预算隔离与换版本累加尚未由统一 MVP 合同证明；运行时发布 grant→生产变更的统一边界未实现，当前依据 AGENTS.md 禁止部署。本次只补现有真实入口的测试，不编造新预检器已接入发布链。

## 决策、负责人和例外

Agent 自主完成：只读账号匹配、排除跨租户 Facebook、选择本地测试、补攻击场景、确定原 attempt 恢复与保守指标计划，无需客户逐项审批。

内部依赖：经营/编导负责人统一 tenant/account/product/task/run/version；C 提供冻结成片及真实人工可发布验收；管理员核验同 scope 账号 OAuth、资产归属、发布 capability 与费用依据。上述内部传递和技术故障不要求客户协调。

需由主会话一次收束的人类例外：最终同范围缺账号使用/发布授权、可见性/期限或新增支出时，提供完成的具体包给有权限责任人决定。A ¥5 不重复询问、不挪作 D 预算。尚无统一包，因此本轮不提出空泛发布批准，不要求客户选供应商或提示词。

## 八项口径

| 口径 | 本轮结果 |
| --- | --- |
| 本地受控合同 | 上述精准测试通过；完整人机边界仍有已列缺口 |
| 真实媒体文件 | 本轮未生成，C 冻结成片未交付 |
| 真实付费供应商 | 本轮未调用，实支 0 |
| 创意质量 | 未取得最终人工可发布验收 |
| 真实发布 | 未执行；身份/账号/授权门禁未齐 |
| 真实平台回执 | 未取得 |
| 真实指标 | 未回收，保持暂无数据 |
| ready:true | 未证明，本轮未测生产或部署；既有 false 不改写 |
