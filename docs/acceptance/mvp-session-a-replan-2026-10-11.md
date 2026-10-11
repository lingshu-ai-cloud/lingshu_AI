# 会话 A 重规划：统一身份与 ¥5 数字人方案

按 `5bd6708` 第 11–12 节执行。协调业务输入、供应商计价、边界合同三个子 Agent，并由业务输入 Agent 完成编导条件式方案。未修改业务存储、企业行业、账号标签、预算账本或历史项目。

## 身份核查结果

**唯一可追溯的当前本地候选是 b251，但没有可执行的唯一 MVP。** 当前 local-authority 持久记录与历史验收快照分开核对；未读取生产数据库，不把本地记录当生产证据。证据及文件 SHA 见 `mvp-session-a-identity-audit-2026-10-11.json`；离线复现 `node scripts/mvp-session-a-identity-audit.mjs`。

| 项目 | 当前证据 |
| --- | --- |
| 画像 | tenant_profiles 的 contentStage=b2b_launch、weeklyTaskPackagePreset=b2b_starting；源码标签为 B2B 零基础，周计划 maturity=starting。这证明系统配置画像，不证明真实经营历史。 |
| 项目 | `studio_projects_b251759707fa43a499a5dc48f070843f` 在当前 studio_projects.json 存在，updated=2026-10-08T16:42:29.017Z；tenant=`local_tenant_customer_1b2913131e2c46deab66172228c4df0a`。 |
| 任务 | run=`workflow_runs_4f7c1a1b054146b3925ad0aac87b308b`，task=`workflow_tasks_4d563d4969114a51b1cb31aa1a93a953`；任务 failed、run waiting_human，不能沿用为运行成功。统一 MVP version 未冻结。 |
| 业务冲突 | 同一 tenant profile.company.name/description 仍为宏昱智能光学照明/室内照明；批发策略买家仍是越南灯具经销商等。products.items 同时包括 GUIANFA-RS-001 云朵泡沫卸妆蜜和护肤目录，不能认为只是过期显示标签。 |
| 导入来源 | `scripts/import-rongshang-local-preview.ts` 将 beauty-showcase 的 41 个产品导入该 tenant 并保留原 socialStrategy。这解释操作来源，没有提供跨行业经营或本次护肤品 MVP 归属授权。 |
| 账号 | 项目 accountId=`local-tiktok-local_tenant_customer_1b2913131e2c46deab66172228c4df0a`；当前 social_accounts 无此账号，仅另一租户 Facebook 测试账号。规划账号不能充当真实账号。 |
| B 历史候选 | 当前 studio_projects.json 共 6 条，没有 `studio_projects_1f987e702c8e4e4e8b40e6432b80ae32`；该 ID 只有历史验收/预算引用。不能从引用重造正式项目，也不能直接与 b251 拼接。 |

内部核查已解释数据混合原因，但没有权威证据决定该企业是否获授权经营护肤品。主会话应交业务负责人一次确定：本 tenant 是否用于已授权护肤品测试，还是应选照明业务/独立护肤 tenant。此例外是业务归属决定，不是要求客户协调 A–E；在取得依据前 `uniqueExecutableCandidate=null`。

## 编导与数字人唯一条件式方案

身份确认后，候选 A 使用 **HeyGen Avatar IV Photo、Zihan、默认英语音色、720p、9:16**，仅一次视频生成，无新增克隆、人物训练或首帧生成，不付费重试。

- Look ID：`fb24c5d371714724bcd105ec2c18e8d4`；Voice ID：`bc1ff447710f455586b15507bf49c062`。
- 正式本地 production_defaults 存在同租户同人物/声音，机器记录有 authorized=true、adult=true、HeyGen 的 digital_presenter/voice_synthesis 用途及 document/consent 引用。引用格式和机器字段不等于底层授权文件内容已经独立核验。
- 口播：**How do you actually verify a skincare factory’s R&D, production, and QC capability—before committing to custom work?**
- 21 个英文词，预计 9–12 秒，中性背景、无产品接触，不声称本企业有特定工厂能力。来源为当前 b251.spec.script 第一段台词。

该纯口播只用于数字人人物、声音和口型验证，改变了历史镜头的实验室、行走、张臂和跟拍要求，不能冒充开场动作复刻。编导需在统一业务身份下明确确认改编及其创意验收标准；B 须在同 scope 生成关键 AIGC 镜头，不能冒充真实工厂证据。当前草案未写入业务项目、未冻结 executable。

## 当前价格与硬预算限制

[当前官方 API 价目表](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained)：Avatar IV Photo $2.31/分钟，按实际生成秒计；独立 TTS $0.12/分钟。[Create Video 官方说明](https://developers.heygen.com/reference/create-video) 声明默认 Avatar IV；现有 adapter 省略 engine，正式方案应考虑显式固定引擎。

假设实际输出 9–12 秒，视频为 $0.3465–0.462；保守另计 12 秒 TTS=$0.024，按**预算换算系数 ¥8/USD（非声称真实汇率）**及 20% 余量，12 秒条件估算 ¥4.6656。真实账户只读查询余额 $25.85，auto_reload=false；安全摘要见 `mvp-session-a-price-preflight-2026-10-11.json`。查询精确采集时刻未捕获，明确保留 null，记录保存时间而不冒充请求时刻。

**¥4.67 不能保证 ¥5 硬预算。** 当前客户端和官方 avatar 请求字段未发现 max_duration 或单任务费用上限；实际输出时长可能超过预计，关闭自动充值也不能限制现有余额被扣。身份确认后仍须由数字人/预算负责人核验可控计费路径和附加费用，不能凭估算直接提交。现有本地总账仅剩 ¥0.56 预占空间，运行预算配置缺失，需管理员核对原预占并显式配置；不重置旧账本、不要求客户再次确认已给的 ¥5。

## 提交与恢复约束

待身份、授权、计费控制及预算配置具备后，由主会话收束一次具体执行审批：批准同 scope 的上述供应商、人物、音色、台词及一次请求，A 总额不超过 ¥5。金额上限已记录；当前没有生成授权，不能把编导意见当客户授权。必要权限未齐时不请求空泛审批、不付费。

执行须固定 production `/jobs`、保存当前计划/人物版本与最终 fingerprint/requestId、持久预占和任务记录；供应商返回 video_id 后及时留档。已知 ID 只刷新原任务/重新下载；unknown 无 ID 交管理员核账，不换键重提；通过片段按 hash 复用。实际费用来自原始账单/usage，未取得时保持 awaiting_invoice。旧 studio retry 风险和供应商 ID 保存失败窗口见会话 A 原报告，未在本轮修复。

## 人机边界合同验证

新增 `server/lib/mvpDecisionBoundary.ts` 与测试，9/9 通过：六字段 scope 一致、human 授权来源及有效期、生成/发布/生产权限分离、A ¥5 专用、跨版本累计支出、unknown 恢复不再预占、无 ID 管理员核账、已通过结果不再生成，以及授权预算内供应商/模型变化不重复客户审批。

这是独立纯函数验收合同，**尚未接入生产路由或账单系统**；调用输入须从可信存储取得，不接受请求体自称 human。测试不证明线上门禁已经实现，也不弥补供应商无法硬控费用。运行：`node --import tsx --test server/lib/mvpDecisionBoundary.test.ts`。

## 八项口径及自主决策

| 口径 | 本轮状态 |
| --- | --- |
| 本地受控合同 | 新增边界合同 9/9 通过；历史 33/33 本轮未重跑，不扩大为全链通过 |
| 真实媒体文件 | 未生成 |
| 真实付费供应商 | 未调用；仅真实资产/账户只读预检 |
| 创意质量 | 未通过；条件式纯口播不等于完整动作复刻 |
| 真实发布 | 未执行 |
| 平台回执 | 未取得 |
| 真实指标 | 未回收 |
| production ready:true | 未证实，本轮未探测生产 |

Agent 自主完成：当前/历史身份分辨、零基础字段核对、冲突溯源、供应商及人物音色选择、官方计价查询、条件估算、内部编导审查和边界合同验证。升级例外：业务归属由业务负责人确定；授权文件、硬预算控制与旧账本由相关内部负责人核验；具体执行授权由主会话统一收束。未向客户重复询问金额或让客户协调子会话。
