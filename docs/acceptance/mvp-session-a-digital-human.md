# 会话 A：真实数字人与口播准备及审计

日期：2026-10-10。权威工作区为 `local-integrated-flow`。本次完成三个子 Agent 的供应商、输入、幂等与恢复并行审计；未部署、未付费生成、未发布。

## 可审查的调用草案

供应商为 HeyGen v3，拟只生成一个 720p、9:16、带原声音轨的 MP4。只读真实预检返回 Zihan Look `fb24c5d371714724bcd105ec2c18e8d4` 为 completed、1080×1920；默认音色 `bc1ff447710f455586b15507bf49c062` 为 zihan、English。人物及音色预检见 `mvp-session-a-provider-preflight.json`。它证明资产 API 可读，不证明商用授权、音色试听或口型质量已通过。

待确认口播（原脚本第一段台词，21 个英文词）：

> How do you actually verify a skincare factory’s R&D, production, and QC capability—before committing to custom work?

预计 9–12 秒；原脚本第一段区间 0–11.33 秒。拟使用中性背景、人物正面讲述，不展示虚构工厂或产品操作。这是待编导确认的场景调整，不能当作原参考运动镜头的复刻验收。完整的历史脚本未获本次冻结批准。

历史候选 lineage：租户 `local_tenant_customer_1b2913131e2c46deab66172228c4df0a`，项目 `studio_projects_b251759707fa43a499a5dc48f070843f`，run `workflow_runs_4f7c1a1b054146b3925ad0aac87b308b`，task `workflow_tasks_4d563d4969114a51b1cb31aa1a93a953`。产品 GUIANFA-RS-001 为护肤品，账号标签为“宏昱智能光学照明”，归属不一致待业务核验；该快照没有零基础身份权威字段，不能默认满足本次样本要求。

参考 `trend_videos_192e76d4b21244c4a2922e60672c95f2` 的 MP4 在本权威目录实际存在，SHA-256 为 `501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9`。参考仅用于分析，不可直接进入生产成片。冻结包记录项目、参考、候选库文件哈希及准确文本；冻结仅指候选证据快照，不代表业务批准或当前可执行制作方案。

## 预算与授权门禁

按服务的 `server/loadEnvironment.ts` 加载路径，用户配置中 HeyGen key 存在、生成开关开启。初始 shell 未加载配置，不应据此声称密钥缺失。未披露密钥；真实资产 GET 成功。实际单镜预算参数缺失，不能提交付费生成。

当前正式账户单价、账单币种折算及供应商余额未知；预计费用保持 `null`，不能把历史定价写成有效报价。[官方开发索引](https://developers.heygen.com/llms.txt) 指向 API Dashboard 定价；[官方归档接口参考](https://github.com/heygen-com/heygen-stack/blob/main/references/api-reference.md) 历史值为 $0.10/秒，但已归档，不能作为本次费用依据。必须取得当前账号价格与余额，按本次预计秒数及计费取整计算保守预占，再形成明确金额的付费审批。

本地 `data/studio-paid-budget/ledger.json` 静态限额 ¥23.48、已有预占 ¥22.92、剩余 ¥0.56。它是本地准入账本，不是供应商实际扣费或账户余额。本轮未重置、删除或改写账本；已有 unknown/失败预占需先核账。配置须与现有账本一致，直接改总额会触发配置变更门禁。

生成前仍需：确认本次零基础任务/账号/产品身份；确认文本和场景；选择并保存带资产版本、供应商及用途范围证据的人物授权记录；确认精确音色；核验当前价格和余额；核账并显式配置预算；获得针对这一个请求的付费批准。用户请求明确要求付费前审查，本次不越过此边界。

## 调用及恢复步骤

1. 确认上述输入，保存到真实草稿，按当前镜头、人物版本计算 fingerprint，并保存可执行 production plan。最终 requestId 从批准的完整方案与人物版本派生；冻结包中的 requestId 仅为草案。
2. 固定 `server/routes/production.ts` 的 `/jobs` 入口；`confirmed=true` 仅在付费批准后填写。使用既有人物 Look，不在本轮新增人物训练、克隆音色或照片首帧生成。
3. 在同一持久 `data` 挂载下预占预算、保存本地作业与 execution，再 POST `/v3/videos` 一次。保存供应商 video_id、请求标识、原始响应与时间；不要在日志保存密钥。
4. 查询原 task。已知 ID 的超时/下载失败只刷新与下载，不再 POST；没有 ID 的 unknown 停止并核对供应商原请求，禁止新键重试。崩溃锁不自动删除。
5. 下载真实 MP4，留存 hash、时长、编码、画幅、音轨及供应商任务证据。实际费用引用账单/原始 usage，未知保持 awaiting_invoice，不把预占或手填费用当成账单。
6. 人工检查声音、发音、口型、脸部稳定性、姿态、背景和身份；保留逐项证据。通过后提供给会话 C；未通过只处理失败镜头，原已通过结果保持复用。

## 已验证的本地合同及已知缺口

使用 bundled Node 执行以下 8 个现有测试文件，共 33 项，全部通过：`heygenPhotoVideo.test.ts`、`photoTalkingBudget.test.ts`、`paidOperationLock.test.ts`、`studioPaidBudget.test.ts`、`presenterAssetTrust.test.ts`、`sentenceReplication.test.ts`、`production.test.ts`、`sentenceReplicationPipeline.test.ts`。覆盖同键复用、持久预算、跨进程锁、已知任务恢复、跨租户、明确拒绝和只返工失败 cue。均为受控测试，没有生成真实数字人。

源码风险（本次审计，未声称已修复）：

- `production.ts` 的 unknown 无 task ID 会阻止重提，但缺少管理核对绑定 ID 的接口，不能自动恢复；供应商返回 ID 后本地保存失败仍有 ID 丢失窗口，需要人工核账。
- 旧 `studio.ts` 的 `/studio/digital-human/jobs` 路径没有预算预占。提交超时可变为 failed，后续 `/retry` 新建 child 和新幂等键，可能重复付费；本次调用计划不得使用它。
- `reconcileHeyGenCost` 未在真实装配端注入，手动费用接口只校验格式，无法自行证明真实费用。
- production 照片分支在作业和预算预占前上传图片；本次计划选择既有人物 Look，照片流程需单独审计。

## 第 9 节八项汇报

| 口径 | 本次结论 |
| --- | --- |
| 本地受控合同是否通过 | 33/33 通过，仅上述数字人范围 |
| 是否生成真实媒体文件 | 本次未生成；历史 MP4 不充当本次数字人产物 |
| 是否调用真实付费供应商 | 未付费；仅真实 HeyGen 资产只读 GET 预检 |
| 创意质量是否通过 | 未验收，人物/音色试听及口型均未通过人工验收 |
| 是否真实发布 | 否 |
| 是否取得真实平台回执 | 否 |
| 是否回收真实指标 | 否 |
| production readiness 是否 ready:true | 未证实，本次未探测生产；不得写 true |

可复现离线冻结：在权威仓库运行 `node scripts/mvp-session-a-preflight.mjs`。该脚本不加载凭据、不联网、不上传、不提交生成，只读取现有候选与账本并生成 `mvp-session-a-input-freeze.json`。输入变化后应重新审查，而非沿用旧批准。
