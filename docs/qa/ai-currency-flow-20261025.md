# AI 方案币种链路修复验收（2026-10-25）

工作树：`/Users/julia1/Documents/ChatGPT/1025投流`。分支 `feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。本次修改未提交；既有脏改动保留，不代表集成基线推进。

## 本次修改

- `server/platformAds/planning.ts`：模型仅生成策略。模型文本涉及金额、换汇、币种限制的句子移除，并明确记录；财务说明由已校验输入生成。有效方案不再因模型汇率判断而整单拒绝。原始预算、币种及执行检查保持不变；JSON/必填字段错误仍报错。
- `server/platformAds/planning.test.ts`：CNY/USD、五个方案字段、错误换汇与最低金额等回归。
- `server/platformAds/metaLeadExecution.test.ts`：五种目标经 AI 生成、持久化、执行预检、模拟 Meta 暂停创建、回执及重复请求验证；断言执行金额使用原预算。

## 实际验证

- `node --import tsx --test server/platformAds/planning.test.ts server/platformAds/metaLeadExecution.test.ts src/components/AdPlanWorkspace.test.tsx`：13/13 通过。
- `node scripts/test-platform-ads.mjs`：68 个测试文件通过。
- `pnpm run lint`：通过。
- `pnpm run check:architecture`：通过，2769 个生产 TypeScript 文件，预算 ratchet 通过。
- `git diff --check`：通过。
- 一次真实 AI 请求成功保存本地任务 `uvr78lzf813om4a`（AI币种链路验收·20261025·仅草稿），读回 CNY 10、日预算 5、ai_assisted、draft，方案存在，执行记录为零。原始模型财务文本触发归一化且成功保存。
- 浏览器打开任务详情，显示“方案已保存”、CNY 10 和 AI 辅助创建。点击检查当前配置，账户与预算币种通过、企业事实版本通过；准确指出素材未绑定。

## 边界与恢复

真实模型生成和本地持久化已验证；Meta 创建、启动与回执由隔离测试模拟，未创建真实广告、未启用或花费。此草稿使用占位视频，且详情显示账户最低计划预算 500、最低日预算 6.72；其 CNY 10/5 不能用于证明真实投放成功。模型其他策略仍是建议，不能视为平台规则证据。

当前预览仍为 paused_only；本地网络策略允许配置的 AI POST 和 Meta GET，不允许真实 Meta 写入。真实投放验收需已确认素材、符合平台要求且经用户确认的预算、适用的执行开放范围及真实回执；不得自动提高预算或绕过限制。

运行证据位于 `tmp/ads-preview/ai-currency-flow-*.log` 和 `ai-currency-flow-live-save.json`。预览后端 PID 文件为 `tmp/ads-preview/backend.pid`；旧 loopback 入口保留可供恢复。恢复本次代码时只针对上述三文件的本次差异，勿覆盖共享工作树其他修改。未迁移数据库、未提交、未部署。

## 后续用户授权调整（2026-10-25）

用户明确要求使用自己企业旧库中的睡衣女性视频，并取消仅暂停创建限制。已比对两条视频首帧，选定较晚的 `GUIANFA RS001 · 38秒单一参考真实联调-成品.mp4`，SHA `42f2acfc9a78831ad388ed28f97493ac4ebe63c96870c9e69b17f0868c4832f1`（13,146,336 字节）。原库保持只读，当前企业新增两条素材/文件记录及文件副本；记录用户归属确认与原企业、原文件、SHA。绑定到任务 `uvr78lzf813om4a`，版本 2，binding `33f8965b972ad92`，待上传。换素材按现有流程清除旧方案建议，不冒用原占位素材的 AI 建议。

仅本地 `.env.local` 的 release mode 改为 full；预览 fetch 仅增加 full 模式下精确 HTTPS graph.facebook.com 的 POST，其他外部主机/DELETE/跳转仍禁止。重启后 connections API 返回 full/create/activate/pause/resume/adjust_budget；浏览器仅暂停提示已消失。网络策略 4/4 测试及 diff check 通过。未改生产配置、未创建或启动真实广告、未自动提高预算。

导入证据与可审阅脚本：`tmp/ads-preview/owned-material-import-evidence.json`、`import-owned-material.mjs`；新增记录 ID `ownrs001file001`、`ownrs001art0001`。旧库不变。恢复开放模式可将本地 release mode 改回 paused_only 后重启；不要删除已关联素材或覆盖其他任务数据。待用户确认满足平台要求的总预算及日预算，当前仍是 CNY 10/5。

用户回复“可以”确认最低预算后，原任务已更新为 CNY 总上限500、日预算6.72，重绑后版本4。一次真实 Meta 视频上传请求 `owned_rs001_upload_20261025_01`，平台视频编号 `2396699921071399`，上传状态 processing；未重复上传。素材 binding `33f8965b972ad92`。视频处理完成前不提交广告创建。

视频已转为 ready。用户确认预算后，真实创建执行 `b9uqh31loehzghb` VERIFIED；启动执行 `8hxq76imofufrv9` VERIFIED。广告系列 `120249401009470142`，广告组 `120249401009800142`，创意 `993612206370473`，广告 `120249401010630142`。实际账户 `1368550458638225`（灵枢联调验收账户），美国、Messenger、主页 `1323567870837055`。2026-10-25 17:25:06（Asia/Shanghai）Meta 读回 Campaign/Ad Set/Ad 三层均 ACTIVE，有效状态 IN_PROCESS；预算500/6.72一致。未声称审核通过、产生曝光或收到消息。完整结果保存在 `owned-material-create-result.json`、`owned-material-activate-result.json`、`owned-material-live-audit.json`。

已知展示限制：meta-audit 仍按创建时暂停状态检查，启动后把“暂停状态”显示 mismatch；三层实际 ACTIVE 和执行回执正确，不能把该展示理解为启动失败。计划保留原测试名称“仅草稿”，当前状态以“已核验启用”及真实回执为准。未部署源码。

## 已创建广告操作与状态核对修复

本轮源代码修改：新增 `shared/adReceiptState.ts`，按账户+资源最近 VERIFIED 的 create/activate/pause/resume 推导期望开关，忽略预算动作/失败/其他资源，未确定动作标为待核对。`server/platformAds/metaPlanAudit.ts` 不再要求所有广告恒为暂停；`src/components/PlatformAdsOperations.tsx` 已创建广告默认管理、隐藏新建选项与素材新建面板，自动关联原系列，明确区分当前状态与下一次操作。未调用广告写入接口。

定向测试 `node --import tsx --test shared/adReceiptState.test.ts src/components/AdWorkflowRecovery.test.tsx src/components/AdPlanOperations.test.tsx`：24/24 通过。`pnpm run lint` 与 `pnpm run check:architecture` 通过（本轮架构检查未设置 ratchet base；2770 生产文件）。`git diff --check` 通过。共享 helper 测试已加入领域测试清单。

真实只读采集 2026-10-25 17:32:45：三层 ACTIVE，有效状态 ACTIVE；投放开关检查 pass。浏览器确认“投放开关状态：一致”，操作默认暂停广告、自动关联原系列、新建选项不存在；默认选择无外部操作。截图 `tmp/ads-preview/state-fix-audit.png`、`state-fix-controls.png`，接口证据 `state-fix-live-audit.json`。本轮不证明实际消耗/曝光/消息回流。
