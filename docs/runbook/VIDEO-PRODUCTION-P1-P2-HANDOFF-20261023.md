# 视频生产 P1/P2 来源冻结与集成交接（2026-10-23）

> 集成更新（2026-10-23）：下文保留来源冻结/建树时的历史状态。当前增量已在独立 `xixi功能大合并20261023` 集成并通过所列离线门禁；小程序两项短镜头缺陷已本地修复，真实原视频/模拟器与供应商尚未复验。当前状态以 `docs/governance/FEATURE-INTEGRATION-20261023.md` 为准。
状态：来源负责人已确认范围；源码、测试和离线脚本独立冻结，文档另行提交。未合并治理/新集成树，未部署或调用真实付费供应商。

## 冻结身份与交付方式

- 来源会话：`01a167e3-bc44-71a1-9317-deffc1f3d659`（定位灵枢AI基线代码）。
- 来源工作树：`/Users/julia1/Documents/ChatGPT/1023视频生成管线/lingshu-video-p1`。
- 来源分支：`codex/video-production-p1-20261023`。
- 来源开发起点：`ddeb731026eb515e2e482cc5470b89a043acb5e5`。
- 冻结源码提交：`8a4bfb67084239923ab476f35e24ebfcb31468e5`；包含下列 94 个源码/测试/离线脚本及包脚本文件。
- 文档交付：本文件及两份 P1/P2 ADR，单独的后续文档提交；其 SHA 由本会话最终交接提供，避免自引用。
- 请求方：用户授权的大合并会话 `01a168af-3368-71e2-978a-25b470ffffa0`，新集成目标以其现场核验为准，交接时起点 `641d0b9ec944730c387ef185012fcf2d44cf8939`。
- 来源推送：未执行。已核验的用户指令要求来源负责人形成可审计提交，普通提交推送明确指向新集成分支；未把“按原授权推送”转述当作本来源分支已有推送授权。同一 Git 仓库的集成任务可直接按本地提交 SHA 挑取，不需先推来源分支。

本次源码与测试均属于本会话先前 P1、预算 P2 请求：P1 曾从共享集成树隔离到本来源树，P2 始终在本树完成。没有替其他会话提交草稿。不能因为来源起点已经是治理基线祖先，就把下列新增修改视作已集成。

## 完整功能范围

1. 自动成片统一硬质量门禁：全部 `social-content.auto-production.v3` 检查技术/创意硬失败、已测媒体缺陷及预算。人工验收不能覆盖确定失败；精准复刻继续增加身份、权利、参考与时间线检查。Studio 的来源校验不能替代自动生产门禁。
2. 人物路线规范：真实口播素材、经验证的无口型动作与生成式人物口播分开。缺独立检测和商业授权证据的生成式口播在首帧、TTS、人物视频付费准备前停止；不自动改写批准路线。读模型提供明确替代决策，旧供应商/首帧/人物授权仍必需。
3. 缓存终态恢复：工件创建前封存逐镜真实供给、旁路备份、输入和哈希。失败后继续同一 task/run/job/artifact 补齐缓存；原临时目录删除后可从封存字节恢复，不重跑供应商、渲染或创建第二个工件。缺快照、缺媒体、哈希改变或工件不匹配保持受阻，已有候选不能掩盖收尾错误。
4. 唯一生产预算：按批准时长 0.5 元/秒，默认 30 秒 15 元；不向上按整段计费。新任务、v1/v2、规划/报价/正式准入、账本、提交许可、G5、修订及交付使用同一规则，移除生产路径的 10/15 元矛盾和内部租户金额绕过。
5. 采集分账：只对完整验证过 `preproductionBinding` 的原采集结转费用排除生产占用；源授权、收据、escrow 和原费用保留。配音、生产分析、质检、失败尝试、重试、子修订、未知扣费都累计到原始 `budgetTaskId`。
6. 逐镜返工先占原片账本，再经过现有 Starter 用量授权与适配器；确认返工报价不等于新开一份整片预算。已受理/未知回执可以恢复对账，不能重复付费或把未知费用改成零。
7. 超预算采用稳定错误和金额证据，持久任务进入 `attention / waiting_external`，生产阶段 `budget_decision_required`，canonical 读模型 `blocked`。显示已占用、新增、累计和额度，保留 `confirm_budget` 用户决策入口，隐藏自动生成/重试/切换/验收。确认入口不是自动扩额或自动恢复接口。
8. 周模板新默认 v4 为 30 秒单片 15 元、5 条容量默认 75 元；不足已批准周总额时停止。v3 与已有较低账本/授权按原哈希读取，不自动扩额。新旧模板的规划、容量、G5 和结算证据必须保持版本绑定。

未增加真实供应商调用，不开放生成式口播能力，不迁移历史支出，不修改小程序的剪辑或分析实现，不扩大其他会话功能范围。

## 与小程序后端的合同交叉

本交接对小程序树只读审计：`/Users/julia1/Documents/ChatGPT/1023灵枢小程序`，现场 HEAD `f9cff15fcc4552747697b722ba0d418bdf659e72`。其源码仍有未提交修改，后续以小程序负责人冻结提交为准；本来源不包含那些草稿。

| 交叉面 | 已核验合同与集成要求 |
| --- | --- |
| 直接文件冲突 | 两份当前草稿交集仅 `package.json`。保留小程序测试/生成脚本，同时保留本来源 `test:video-production-p1`、`test:video-production-budget` 及 `test:production-workflows` 的增量；不要整文件覆盖。 |
| 物理参考片段 | 小程序草稿新增 `ShootingReferenceClip`、`referenceClip` 及预览端点。返回 `physicalClip:true` 时 `start:0/end:片段时长`，`sourceStart/sourceEnd` 才是原片时间；P1 的供给、manifest 与缓存不能再对该物理片段重复使用原片偏移。 |
| 身份和字节证据 | 保留 tenant、task/project/slot/shot、referenceShotId、源视频 SHA、analysisRunId、分析 hash、clip SHA、首帧 SHA 及原始半开时间区间。P1 校验原始分镜供给和冻结基线，不按顺序猜镜头、不使用最终 MP4 伪造原分镜。 |
| 版本/重物化 | 小程序 `referenceExactShotMaterialization` 草稿增加 `extractionVersion` 校验和新物理裁剪版本。旧来源证据重新物化后，必须重新读回真实字节与新版本；不得在旧已冻结缓存中悄悄替换字节、时长、hash 或路径。 |
| 缓存恢复 | `sourceFiles` 只允许服务端封存字节映射，保持原始来源身份；不得作为客户端可提交路径、URL 或任意备份参数暴露。恢复沿用原工件和收据，无新供应商请求。 |
| 短镜头 | 本预算规则支持合法正时长，并不赋予小程序裁剪/切点正确性证明。小程序负责人已报告 0.167 秒开场漏切和无关 0.183 秒镜头阻断正常预览；本来源没有修复或验收这两项缺陷。 |
| 人物与待拍 | 小程序上传真实授权口播素材可供重新规划；不能把缺失口型检测能力的生成式路线显示为已可执行。修改素材或路线后需重新批准当前计划/版本，不继续旧快照。 |
| 预算展示 | 数据库任务 `attention` 和执行 `waiting_external`，以及读模型 `blocked` 是不同层；小程序不能以“已有候选/已完成某一镜”覆盖整片预算或缓存收尾阻塞。用户选择不构成直接付费许可。 |
| Qwen 分镜隔离 | 小程序的 `qwen.ts`、`videoSplitShotDescriptions`、裁剪时间窗属于其来源提交。本来源仅验证冻结供给及收费边界，不改变 Qwen→Gemini 路线，不把模型自行报告准确当作人工/媒体验收。 |
| 采集分类 | 不按 Qwen/模型名一律排除费用。只有原采集授权及完整结转绑定的费用单列；生产过程中新发起的分析、TTS、QA 等必须占生产预算。 |

上述为静态接口交叉审计和集成约束，不是两份草稿已合并后的合同/产品验收。小程序验收不通过项以其 `MINIAPP-PRODUCT-ACCEPTANCE-20261023.md` 及最终交付报告为准。

## 迁移顺序、依赖和部署前提

- 本来源没有新增/修改 PocketBase 迁移、迁移校验清单、表、字段或索引；新增状态、预算证据和快照引用存入现有 JSON 合同/检查点，账本 `schemaVersion:1` 增加可选批准时长，历史记录继续校验。
- 仓库 193 项迁移清单只读校验通过。这只证明仓库文件完整性，不证明目标数据库已执行这些迁移；本次未连接数据库或远程主机。
- 建议顺序：来源源码提交 → 来源文档提交 → 小程序负责人完整冻结提交 → 在新集成树处理 package 脚本并重跑交叉回归。继承基线中的现有迁移顺序按集成树真实 manifest 保持，不新插入本来源迁移。
- 运行依赖仍为现有任务仓库、durable job/checkpoint、原始成本血缘、任务预算账本和既有付费许可；人物授权/首帧/质量门禁不变。
- 缓存恢复依赖私有 `data/social-content-cache-finalization`、既有逐镜媒体缓存和任务预算目录（`SOCIAL_CONTENT_TASK_BUDGET_DIR`）；运行进程须保有同一持久数据根、稳定路径及现有锁/写入权。不能把私有快照、原片、授权账本或本地媒体提交进 Git。
- 不运行数据库迁移、恢复、部署、OAuth、发消息、投流或真实付费请求；不得把 source commit 当作 runtime Ready 或发布批准。

## 真实验证与未交付项

本次冻结额外复验：预算 90/90、P1 33/33、TypeScript、架构与 ratchet、193 项迁移清单只读、`git diff --check`。源码文件 SHA256 在提交前逐项锁定，未检出私钥/云访问密钥/GitHub token/OpenAI key 形态的材料，未包含运行数据、凭据或锁文件更新。

同一来源内容先前已实际通过：周模板/容量/G5/escrow/结算 86/86；生产适配、返工、G5、权限 106/106；助理生产 34/34；完整 `test:social-managed`；前端 sync-check、Vite build、Studio chunk/import boundary。完整命令及限制另见预算 ADR。各组有交叉，不合计为唯一用例数。

本树没有 `.bin/tsx` 命令入口，现有包脚本中的 `tsx` 使用 `node --import tsx` 等价运行；预算脚本本身已使用 Node。没有因此安装依赖或修改锁文件。

未交付：真实供应商 E2E、真实 OAuth/投流/消息、生产/黄金环境验收、目标数据库迁移、小程序两项短镜头缺陷修复、独立真实视频描述准确性全面验收、全库 `quality`。大合并会话另报告治理基线 `test:production` 存在 2 项既有人物 UI 断言失败，本来源未重跑该完整门禁，不将其写成已通过。

剩余业务限制：缺独立商业口型检测的生成式人物口播仍受阻；旧低额度、缺完整财务证据或缺真实缓存快照的任务仍可能要求用户决策/对账，不自动扩额、不重提未知供应商工作。

## 安全挑取和冻结清单

接收方应逐项核对提交内容、补丁覆盖、文件/合同与当前基线差异，不能只检查祖先关系。源码提交和本源码起点 SHA 可用于审计本次精确增量；不能整文件恢复成旧治理结构。所有下列文件由本会话确认归属，其他来源草稿、`node_modules`、`data`、`tmp`、`.env`、部署配置及凭据均不在清单。

源码工作树冻结后不再追加功能。若集成发现问题，先记录与精确冻结提交的差异和最小复现，再在明确范围内修复；不要清理来源树以“恢复干净”。安全恢复点为源码提交、文档提交及其本地共享 Git 对象。

| 源码/测试/脚本文件 | 冻结 SHA256 |
| --- | --- |
| [package.json](../../package.json) | `f9b6a21f1324079fd5f2babc599c638aed36d6f06076cfad9609da8bbb3b8d3a` |
| [scripts/production-budget-offline-guard.mjs](../../scripts/production-budget-offline-guard.mjs) | `e7d4a4f2b7ea39373f112a3ba09e5b4bedf07afbeeaf83678944d90e803dbf18` |
| [server/contentExecution/retryPolicy.ts](../../server/contentExecution/retryPolicy.ts) | `7bb527ee8017932004472c538dddb86a79db9384313d5ccc833e789e19842d19` |
| [server/lib/socialContentPaidOperationPermit.test.ts](../../server/lib/socialContentPaidOperationPermit.test.ts) | `da33b016a4adf4676ee9e18a1d60e0939b67ea0c691b4f7edb385077b2cfbef7` |
| [server/lib/socialContentPaidOperationPermit.ts](../../server/lib/socialContentPaidOperationPermit.ts) | `7a947ee654259b975a742913b40819e1806511b09a3d484ed33cebec74175a6c` |
| [server/lib/socialContentProductionBudgetPolicy.test.ts](../../server/lib/socialContentProductionBudgetPolicy.test.ts) | `fa852f6619247c1d9a778e1556d6e696217ccd780cdda1761abf960ab7f49825` |
| [server/lib/socialContentTaskBudget.test.ts](../../server/lib/socialContentTaskBudget.test.ts) | `44985a2ea34adbe3af917e5d23f030dafbcd917800f22e6ee219e8c0b4b9d3d0` |
| [server/lib/socialContentTaskBudget.ts](../../server/lib/socialContentTaskBudget.ts) | `afae1adda02f75aa3d45e9b555b0d5b7fba3a3eec76f8d4625486542170bf902` |
| [server/lib/socialContentTaskBudgetAuthority.test.ts](../../server/lib/socialContentTaskBudgetAuthority.test.ts) | `769eb416deb0d5462f2e48dc8f2af9392a0e9953ac92449788db3dfd613c1f89` |
| [server/lib/socialContentTaskBudgetAuthority.ts](../../server/lib/socialContentTaskBudgetAuthority.ts) | `da6db6e242df5171e8ec5a3ff2790f0232e2eace8cc0ba5d8bf16766d03268fc` |
| [server/runtime/socialWeeklyProductionAdapter.test.ts](../../server/runtime/socialWeeklyProductionAdapter.test.ts) | `e7a8a03dbaf8215798d1d19161d54b4891f6f8fcfdb8e426f3256abedcec045d` |
| [server/runtime/socialWeeklyProductionAdapter.ts](../../server/runtime/socialWeeklyProductionAdapter.ts) | `9f96f03de85ad4c389eaa1ed6df746131a939d5d1abc3fd99d6f9a0d9470b93a` |
| [server/runtime/weeklyCandidateExactProductionEscrow.ts](../../server/runtime/weeklyCandidateExactProductionEscrow.ts) | `7df57f1d54dfd22e045203578fa8ab9c3e2422bd3cba46c8e0abe9dfcc5c16a9` |
| [server/runtime/weeklyCandidateExactProductionEscrowPorts.test.ts](../../server/runtime/weeklyCandidateExactProductionEscrowPorts.test.ts) | `a55b99577bfe4db31fb17472834cb7fa5d3bb920fe54d721d2ce8107455c8b7c` |
| [server/runtime/weeklyG5AutomaticAuthority.ts](../../server/runtime/weeklyG5AutomaticAuthority.ts) | `9dc94723dc10c42f7844b20601ef50d766a7921b55027b36113453239baf9b63` |
| [server/runtime/weeklyOriginalRunSettlementProof.test.ts](../../server/runtime/weeklyOriginalRunSettlementProof.test.ts) | `a55df79a288644f7a9de8965dd0595f839819fcab72dc5fc76ca577f461828fc` |
| [server/runtime/weeklyOriginalRunSettlementProof.ts](../../server/runtime/weeklyOriginalRunSettlementProof.ts) | `bee1af8b855c603774524e6466f722f619afd821483ee4a8dce6094456ebb79b` |
| [server/socialPrograms/planningAuthority.ts](../../server/socialPrograms/planningAuthority.ts) | `dc0d96520b73a5ef60fb93275ee32f6eb65fc271d885cf1b589e13f2b40ac614` |
| [server/socialPrograms/weeklyAutomaticProductionPlanning.ts](../../server/socialPrograms/weeklyAutomaticProductionPlanning.ts) | `b475b5483aa33384ed14803cade29d795a7266619db39eea55c523e9b81c57a3` |
| [server/socialPrograms/weeklyAutomaticSchedule.test.ts](../../server/socialPrograms/weeklyAutomaticSchedule.test.ts) | `6cfbeddfb16b62d5463d6097b6bc5d0ef6976bde21dd06ebb8ab8a9ed9159263` |
| [server/socialPrograms/weeklyAutomaticSchedule.ts](../../server/socialPrograms/weeklyAutomaticSchedule.ts) | `2191ddef3ad2932964f96f44b31f546f6c9b1accf22267461878852db9bfc807` |
| [server/socialPrograms/weeklyAutomationTemplate.test.ts](../../server/socialPrograms/weeklyAutomationTemplate.test.ts) | `895752e310fe7af7d9fd8dabd81bd411098cbc35f32b78d7894198b8c041804b` |
| [server/socialPrograms/weeklyAutomationTemplate.ts](../../server/socialPrograms/weeklyAutomationTemplate.ts) | `d78de952d26ac7b99c941b98de37cd8978dae0e9ed1edde9645488cffb7c517a` |
| [server/socialPrograms/weeklyBudgetPolicyMigration.ts](../../server/socialPrograms/weeklyBudgetPolicyMigration.ts) | `215fc87b7cabc1a809b9287fff07ebec07a2fb1b5292d388f0030591c01955d9` |
| [server/socialPrograms/weeklyPlanningTemplateAdoption.ts](../../server/socialPrograms/weeklyPlanningTemplateAdoption.ts) | `bd7cf669d4196564ebd6b464439ee6cc4612a5eb8dc19d65c4371d478fe60497` |
| [server/socialPrograms/weeklyProductionPlanningAuthority.ts](../../server/socialPrograms/weeklyProductionPlanningAuthority.ts) | `dd065e4d4625ab3b1fc352e01b87c5b8330941192e20d9f27c2551ff455818b9` |
| [server/socialPrograms/weeklyProductionScopeCapacity.test.ts](../../server/socialPrograms/weeklyProductionScopeCapacity.test.ts) | `7b6ae2e8495682ef0d5044f00f893ec6c8d751f188de89ffce791165e540a0e0` |
| [server/socialPrograms/weeklyProductionScopeCapacity.ts](../../server/socialPrograms/weeklyProductionScopeCapacity.ts) | `ab871a39bb18d3fcb7ab4ee9d08a0379a9e7af70cc78fc4192a57b8935043c28` |
| [server/starter198/socialContentAgentWorkflow.ts](../../server/starter198/socialContentAgentWorkflow.ts) | `36217a6cdcb46bdc844c937816415c925b81cbc56f2fafb0ae39a9450840ad74` |
| [server/starter198/socialContentAiVisualAdapter.ts](../../server/starter198/socialContentAiVisualAdapter.ts) | `95e48fbddc7bcbedfb853f91cb3b3e392da42cd5cdbe4d81b624cf3ec8263de9` |
| [server/starter198/socialContentAssetRevisionBudgetReserve.ts](../../server/starter198/socialContentAssetRevisionBudgetReserve.ts) | `4e52d5ee58228c24957821a25dbdbe53f2911f3ef84aedf8b1f34e7e092660b9` |
| [server/starter198/socialContentAssetRevisionPaidGuard.test.ts](../../server/starter198/socialContentAssetRevisionPaidGuard.test.ts) | `80f0e5d9e69d443546864862b71cc0ec51e44e524e7334800c86a5a3fdad7652` |
| [server/starter198/socialContentAssetRevisionPaidGuard.ts](../../server/starter198/socialContentAssetRevisionPaidGuard.ts) | `3c8ebe3620f0591626f5ef0ae57ab0fe5a7851259b5f30967ce7794c6909c79d` |
| [server/starter198/socialContentAssetRevisionPaidPermit.ts](../../server/starter198/socialContentAssetRevisionPaidPermit.ts) | `0945a3c3103e09436dfffb68db9bb70924c75078d006d26ac9079bc8a9dc6f59` |
| [server/starter198/socialContentBudgetDegradation.ts](../../server/starter198/socialContentBudgetDegradation.ts) | `b605d5c00a84085bc83a35c51955c3e821dd54e4c38b11732fae00e316b34619` |
| [server/starter198/socialContentBudgetRouting.ts](../../server/starter198/socialContentBudgetRouting.ts) | `2ef638dd3f10fa32d8cdb196c792ba703fc6bdcca159fba92696eeac82f294c5` |
| [server/starter198/socialContentCacheFinalization.test.ts](../../server/starter198/socialContentCacheFinalization.test.ts) | `e164ea8414ace8803c495d0d490c5094de0906312654747fe2a84282e0106d4a` |
| [server/starter198/socialContentCacheFinalization.ts](../../server/starter198/socialContentCacheFinalization.ts) | `9835ffc0db201351e56c2c440734b028d1bdc15211a22a7ad67c60faf0b62d40` |
| [server/starter198/socialContentCostLineage.ts](../../server/starter198/socialContentCostLineage.ts) | `ddcca552adf81fab95bb2a56a18818dc9ea70f967086f70692f5a0b04a1a5d2e` |
| [server/starter198/socialContentExecutionBudget.ts](../../server/starter198/socialContentExecutionBudget.ts) | `159b14d5bbd4430954306ca7f9f1f5019db59f7ebede5d86c0cdcc7f841ee568` |
| [server/starter198/socialContentGraphQualityGate.ts](../../server/starter198/socialContentGraphQualityGate.ts) | `a87bbaddb4838d3fbef954b160239159805e8c1f94802b73a27a42660c506b8e` |
| [server/starter198/socialContentHeyGenBridge.test.ts](../../server/starter198/socialContentHeyGenBridge.test.ts) | `870d756184173841173dd17a8420b2903b84024a4f80b45497e2a5cec58f36c3` |
| [server/starter198/socialContentHeyGenBridge.ts](../../server/starter198/socialContentHeyGenBridge.ts) | `2f7e8dc537f2d312d93610c7072eca878533f5cd32943b6c46aacc1636c6c0b6` |
| [server/starter198/socialContentInitialSceneCache.ts](../../server/starter198/socialContentInitialSceneCache.ts) | `ca8aa181462d484af8c39b9284be92102763813b44161d07c6a137ce344fe640` |
| [server/starter198/socialContentInternalBudgetExemption.test.ts](../../server/starter198/socialContentInternalBudgetExemption.test.ts) | `c47818ac0bb67e14a34f3319866db6c0a6a8c25611dda6a9bd4ff053bfb142f2` |
| [server/starter198/socialContentManagedReview.test.ts](../../server/starter198/socialContentManagedReview.test.ts) | `e39074205905d48507164ce9a346171956ee6b97ba2aa07febf2ae011f175a30` |
| [server/starter198/socialContentPaidOperationPlan.test.ts](../../server/starter198/socialContentPaidOperationPlan.test.ts) | `8d21a3e899dd33706270c620781c150741fb17a206e4da286723db19fff11f1f` |
| [server/starter198/socialContentPaidOperationPlan.ts](../../server/starter198/socialContentPaidOperationPlan.ts) | `8da01a01998c7d12952f51c7837c91648262978486dd42b8f14ddb0e21ead3e1` |
| [server/starter198/socialContentPresenterRouteAdmission.ts](../../server/starter198/socialContentPresenterRouteAdmission.ts) | `9f78ea89e6bb98a477cfe484beb882b3333e26f9682e4b2e3d3b478dafe5349f` |
| [server/starter198/socialContentProductFootageRevisionDurableRead.ts](../../server/starter198/socialContentProductFootageRevisionDurableRead.ts) | `678aa9691efe860effc5c0345f3654583f13280ad30cae2c8f2e138d5635424b` |
| [server/starter198/socialContentProductFootageRevisionHandoff.ts](../../server/starter198/socialContentProductFootageRevisionHandoff.ts) | `245d4163d96e40acd27dcf0e50e55901f0703263e69e7e233f076de01b8c46f4` |
| [server/starter198/socialContentProductFootageRevisionPaidPreflight.ts](../../server/starter198/socialContentProductFootageRevisionPaidPreflight.ts) | `7144888956f37e1edbb4f953d9037b0129b2c20f8ea9188e03e4ac55afacfeca` |
| [server/starter198/socialContentProductFootageRevisionSchedule.test.ts](../../server/starter198/socialContentProductFootageRevisionSchedule.test.ts) | `a09eb9dc3699e42f62950cf5843c08c2bff760a0b3269b4bfee99ad7634c1136` |
| [server/starter198/socialContentProductFootageRevisionSchedule.ts](../../server/starter198/socialContentProductFootageRevisionSchedule.ts) | `629376cf24839bae64282e37bcf8013930a4deccf6bf57328d40655c54cb4986` |
| [server/starter198/socialContentProductFootageRevisionWorkerAdmission.ts](../../server/starter198/socialContentProductFootageRevisionWorkerAdmission.ts) | `cadbc72c46dac04928fdda0b3174b4c3ea41af509605f9f34899a212a3650765` |
| [server/starter198/socialContentProductReplacementEnvironment.test.ts](../../server/starter198/socialContentProductReplacementEnvironment.test.ts) | `3c393a6b138fe5f630d514bac49c904dfea8a98a2d089c7631c76dd38e817083` |
| [server/starter198/socialContentProductReplacementEnvironment.ts](../../server/starter198/socialContentProductReplacementEnvironment.ts) | `780a95b33d814d5bef13e61f64378377305f00d12f3f9641629d37252c9f7b0d` |
| [server/starter198/socialContentProductSceneAdapter.test.ts](../../server/starter198/socialContentProductSceneAdapter.test.ts) | `876bd052a1f1b0e062b6210a0d900f0c3f8407fea8890a06291d9f1d8d7c40c3` |
| [server/starter198/socialContentProductSceneAdapter.ts](../../server/starter198/socialContentProductSceneAdapter.ts) | `b1d76deb13a6ddbedde997c4d62f9d4e690eb5b11b560d8c3dc5fef296aedf9b` |
| [server/starter198/socialContentProductionAdmission.ts](../../server/starter198/socialContentProductionAdmission.ts) | `16ea46f9c8e2b2d51348512cc2c833199f34c3907097fdb2603896ff6315f054` |
| [server/starter198/socialContentProductionArtifact.ts](../../server/starter198/socialContentProductionArtifact.ts) | `abab56fc76cf5cae1857c75743e8a33bfc7d582b83220468439ced7b80488607` |
| [server/starter198/socialContentProductionBudgetEvidence.test.ts](../../server/starter198/socialContentProductionBudgetEvidence.test.ts) | `97d891621fe71c2c49de6985840a202e3200815b532d54a2a6b97bb2e141c4a6` |
| [server/starter198/socialContentProductionBudgetEvidence.ts](../../server/starter198/socialContentProductionBudgetEvidence.ts) | `4d6997630c0383f03da017be93a965cf71d5eed02039dc722c5cd679325a6347` |
| [server/starter198/socialContentProductionBudgetPreflight.test.ts](../../server/starter198/socialContentProductionBudgetPreflight.test.ts) | `076f5db5ff4198f5f7174379a14602880c2319989cfbafacba676f03abf37114` |
| [server/starter198/socialContentProductionBudgetPreflight.ts](../../server/starter198/socialContentProductionBudgetPreflight.ts) | `ecbde6fb9b07c3d726921e39924e6b3ba706799948952dc48184b9e0cc271b2e` |
| [server/starter198/socialContentProductionExecution.ts](../../server/starter198/socialContentProductionExecution.ts) | `1438c2ae6eae6604eca94747a453314f135c321671bb8775b732b52d9ade6677` |
| [server/starter198/socialContentProductionGraph.test.ts](../../server/starter198/socialContentProductionGraph.test.ts) | `2307b9771e7acb6e183b4ff93138e1ed760f2eef5d161f77b74f0a6e0db99639` |
| [server/starter198/socialContentProductionGraph.ts](../../server/starter198/socialContentProductionGraph.ts) | `aa256d92486314222c2fcbfd2dcba4169cb73faa1e9ef1cad960df5206fb68ce` |
| [server/starter198/socialContentProductionMaterialPreparation.test.ts](../../server/starter198/socialContentProductionMaterialPreparation.test.ts) | `4af58b02ae15e5c987a773a51f5f47bcfdb3cc19e716cf6e33f82040a8d32bf9` |
| [server/starter198/socialContentProductionMaterialPreparation.ts](../../server/starter198/socialContentProductionMaterialPreparation.ts) | `dd5f8131d8f3e2811931da4478caae1ded955cd2bb758f4813bc1765d5b9d102` |
| [server/starter198/socialContentProductionReadModel.test.ts](../../server/starter198/socialContentProductionReadModel.test.ts) | `85b4da29424ab7f83f7e2f7ff7759eec060cc7a0400b421583da1d3df80521f0` |
| [server/starter198/socialContentProductionReadModel.ts](../../server/starter198/socialContentProductionReadModel.ts) | `2bf8d427499fefeba428f32178cba55c0a7605a1a305624b17d2186e4ccc93ac` |
| [server/starter198/socialContentProductionRuntimeSupport.test.ts](../../server/starter198/socialContentProductionRuntimeSupport.test.ts) | `77a3f1023ea6bc3a6709d6485e7d2c99c71349ad37fd680c2c2b8a77942632bd` |
| [server/starter198/socialContentProductionRuntimeSupport.ts](../../server/starter198/socialContentProductionRuntimeSupport.ts) | `d2d8d6852bf4d3fdf4653bb2ca0f18ef6cbbebf796432e1331f4cf7acd397eff` |
| [server/starter198/socialContentRecords.ts](../../server/starter198/socialContentRecords.ts) | `1ebff82860d6cd90492f30fc800f063bb30b9d56cdf3dffe640336aff50823a3` |
| [server/starter198/socialContentReleaseQuality.test.ts](../../server/starter198/socialContentReleaseQuality.test.ts) | `58b71a80911a42ed9c62905e2fa76ef084fe379c50f1e7296b765da108f990cc` |
| [server/starter198/socialContentReleaseQuality.ts](../../server/starter198/socialContentReleaseQuality.ts) | `17f31415173cfe45bfcbf331600627faa1045db46c9ac1b86766a63c8c8f99ae` |
| [server/starter198/socialContentSceneReworkCostPolicy.ts](../../server/starter198/socialContentSceneReworkCostPolicy.ts) | `965a9cea6e8d6409b7baaf1eec471250d2a6e1a38de6661265788bfd611aa34b` |
| [server/starter198/socialContentSceneReworkFilmBudget.ts](../../server/starter198/socialContentSceneReworkFilmBudget.ts) | `b34624961d07646a35ea2b2dc3dc6706f5b1dea6beb7d1bb6f00b935e094de34` |
| [server/starter198/socialContentSceneReworkSupplyPorts.ts](../../server/starter198/socialContentSceneReworkSupplyPorts.ts) | `f9a7ad7b431a24a3c15e3f3a053218690f50b1b485384ea8334c160a37701949` |
| [server/starter198/socialContentTaskSupport.ts](../../server/starter198/socialContentTaskSupport.ts) | `c98a9f393171f54600bf656deed637367ae77e0918f1e13af866eb28fa0ef806` |
| [server/starter198/socialContentTypeAwareAdmission.test.ts](../../server/starter198/socialContentTypeAwareAdmission.test.ts) | `bfe25bb688f5d3ac4f65282a56df44a7554229f23fe05504ac7a0334403dcbe5` |
| [server/starter198/socialContentValidation.ts](../../server/starter198/socialContentValidation.ts) | `684db6f1414086d61bfca11070577f9f66513d2482ab9f70647c6c9fcda056a9` |
| [server/starter198/socialContentWholeTrackHeyGenBridge.ts](../../server/starter198/socialContentWholeTrackHeyGenBridge.ts) | `b9c6744c9e6efab62d16632fca57c1e5bd3c2faac3c6ba2e878101ac3576dc72` |
| [server/starter198/socialDirectorG5CanonicalBudget.test.ts](../../server/starter198/socialDirectorG5CanonicalBudget.test.ts) | `a7d7eb9314069d20e7391dc37b557c4dc6b982bad044d2702af5a45c6c1a4c92` |
| [server/starter198/socialDirectorG5CanonicalBudget.ts](../../server/starter198/socialDirectorG5CanonicalBudget.ts) | `e5aa81f987adbcc8feb8bd91a9bac06c25c86b3aec7bfc52f97a382323086e21` |
| [server/starter198/socialDirectorG5ReviewService.test.ts](../../server/starter198/socialDirectorG5ReviewService.test.ts) | `6597b35ba8e35c9268492642d7cca6dc8d4bbd4f0d02f60e85c3416219445309` |
| [server/starter198/socialDirectorG5ReviewService.ts](../../server/starter198/socialDirectorG5ReviewService.ts) | `acc762cd8c70f6d2598730a9ba45d9435c84b987a8d2a12eb456279e7389d0a5` |
| [shared/contracts/presenterProductionRoute.test.ts](../../shared/contracts/presenterProductionRoute.test.ts) | `4ea947239fa26236394a57e1df38c7c0d36ab309ad7ea0f4895b60d4e18c5c06` |
| [shared/contracts/presenterProductionRoute.ts](../../shared/contracts/presenterProductionRoute.ts) | `4e82fb0d41c7c9c1c95f0d1ec1d18f601c0e2ea666f2bc1a5cbaf478fa1da232` |
| [shared/contracts/productionBudgetPolicy.ts](../../shared/contracts/productionBudgetPolicy.ts) | `c30c60b1149e9faa9ec33b384f9ca0f826552e971051330660721f47a913aa99` |
| [shared/contracts/socialProgram.ts](../../shared/contracts/socialProgram.ts) | `6e51a9ee48ce6c61d77bf5a014e922c64b717962889830af12f5c0628af04bca` |
| [shared/weeklyAutomationTemplate.ts](../../shared/weeklyAutomationTemplate.ts) | `beedeb22cea4fbbcb6df8600a6e4d0fe61cb413fc47edf8da984f3747581bf9c` |
| [src/components/ProductionTaskScene.production.test.tsx](../../src/components/ProductionTaskScene.production.test.tsx) | `6a93ab395080f335761563d21d950b39960f7bf3a2ee8801459a147438ed014e` |
