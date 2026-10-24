# 客服功能分支合入前评审清单

初版评审日期：2026-10-24（Asia/Shanghai）。初版仅核对源码差异、历史验收文件、日志与证据哈希，整理评审材料；未重新调用 AI、真实客户渠道或外部供应商，未提交、推送、合并、部署或迁移。原有未提交修改全部保留。

2026-10-24 后续更新：普通回复区草稿/翻译兼容问题已在当前功能分支修复并完成普通页面真实 AI 验收，见[专项报告](customer-composer-isolation-acceptance-2026-10-24.md)与[新证据索引](evidence/customer-composer-isolation-20261024.json)。下表 72 项及 41 项哈希匹配是初版整理时点；后续增量源码以新索引为准，历史清单不重新覆盖。

**当前结论：已有可供评审的实现和本地验收证据；最终合入门禁尚未完成。** 以下已完成项只在列明范围内成立。剩余项需在冻结候选版本后处理，不能用当前清单替代合入批准。

## 1. 候选范围与基线事实

| 项目 | 本轮核对结果 |
| --- | --- |
| 工作目录 | `/Users/julia1/Documents/ChatGPT/1024客服` |
| 当前分支 | `feature/customer-service-20261024` |
| HEAD | `89b175109149d4551aeb3ce590fe9c42c46bf23c` |
| 本地基线引用 | `refs/heads/xixi投流客服整合补齐基线v1` 当前也指向上述 HEAD；本轮未访问远端确认其状态 |
| 待评审内容 | 工作区差异；尚无包含这些改动的候选提交 |
| 整理前工作区 | 33 个已跟踪修改、39 个未跟踪文件，共 72 项；已跟踪差异为 +381/-282 行，未跟踪内容不计入此行数 |
| 本轮新增 | 本清单及脱敏证据索引 JSON；不改生产代码、原验收记录或基线文档 |

[基线治理记录](../governance/BASELINE.md)与[工作树规则](../governance/WORKTREE-INVENTORY.md)继续作为治理依据。本地引用、文档历史检查点和远端状态需分开核对；本清单不推进任何基线。相同 HEAD 不代表工作区源码相同，历史测试也不能单凭 HEAD 相同就视作最终候选验证。

完整 72 项路径、状态和整理前 SHA-256，以及两份证据清单的原始哈希，见[脱敏证据索引](evidence/customer-premerge-review-20261024.json)。同目录已有多轮修改，以下按功能归组，不推断作者或擅自选择提交归属。

## 2. 变更地图与复用边界

| 范围 | 主要文件 | 复用与评审重点 |
| --- | --- | --- |
| 本地模拟整链 | `server/customerService/localPreviewSimulation.ts`、`server/routes/localCustomerSimulation.ts`、`src/components/customers/LocalCustomerSimulation.tsx`、`src/lib/localCustomerSimulation.ts` | 调用原入站、草稿请求、接管、模板/审批及发送账本；`customer_preview_*` 集合隔离，按租户/用户/模拟客户限定；明确 QA 查询参数才显示工具 |
| 原服务可注入与共享适配 | `server/messenger/conversations.ts`、`server/digitalEmployees/customerWorkflow.ts`、`server/routes/draftReply.ts`、`server/customerService/translation.ts`、`server/routes/plugins.ts` | 默认仓库/存储仍服务原流程；模拟注入独立存储，导出原草稿适配、抽取原翻译实现，避免平行规则；需重点复核默认路径无回归 |
| 默认隔离与 AI 授权 | `scripts/customer-isolated-*.mjs`、`customer-isolation*.mjs`、`customer-preview-ai-scope.mjs`、`run-customer-isolated-tests.mjs`、fixtures、`server/runtime/localCustomerPreviewIsolation.ts`、`server/lib/networkEnvironment.ts`、`server/index.ts`、`vite.config.ts`、`package.json` | 启动顺序、后代进程/worker 继承、底层网络、canary、编译器精确例外、Qwen 作用域、浏览器 CSP；不能仅审 fetch 包装 |
| 草稿、发送及恢复展示 | `src/lib/customerReplyRequest.ts`、`CustomerReplyRecovery.tsx`、`customerConversationDelivery.ts`、`ConversionPage.tsx`、`useConversionDraftEffects.ts` | 读取原 requestId、有界超时、不重新生成；模拟发送走原账本；草稿不冒充 AI；已批准正文约束 |
| 精简资料与报价弹窗 | `ConversionChatThread.tsx`、`ConversionCustomerRail.tsx`、`CustomerQuoteLauncher.tsx`、`QuoteSkillCard.tsx`、widgets、相关合同测试 | 遵循 PRD 16.10/16.11，复用原报价 API、确认与版本；普通页面移除旧工作区入口，保留会话接管/恢复提示 |
| 标签纠正和画像投影 | `shared/contracts/customerTags.ts`、`CustomerProfileTags.tsx`、`customerTagPresentation.ts`、`src/lib/customerTagCorrection.ts`、`useCustomers.ts`、`src/types/customer.ts`、`src/mocks/quoteCustomerProfiles.ts` | 状态与标签分离、证据来源明确、人工纠正保留；真实资料走原 PATCH，模拟资料走隔离存储 |
| 标签服务端及回归 | `server/routes/customerSuggestions.ts`、`server/customerService/businessProfile.ts`、`server/messenger/conversations.ts`、`server/instagram/conversations.ts`、`server/whatsapp/historyImport.ts`、相关测试 | 鉴权/支持只读、过期纠正拒绝、联系限制不可解除、重新分析不覆盖人工纠正；涉及三个渠道共享行为 |
| 历史新增但未挂载组件 | `CustomerWorkspaceTools.tsx`、`customerWorkspaceTasks.ts`、`CustomerWorkspaceTools.test.tsx` | 搜索确认普通会话入口未挂载；保留原文件，是否随候选带入须明确，不能登记为用户可达功能 |
| 文档与测试合同 | 产品 PRD、10 份本日 QA 记录、`customerReplyUiContract.test.ts`、`externalCustomerServiceDemo.test.ts` 等 | 历史记录按时间和范围解释；旧界面方案、固定样例及早期隔离声明不能代替后续证据 |

## 3. 已完成项及直接证据

- [x] **新隔离会话入站 → 原真实 AI 草稿。** Emma `mock-quote-debug-3` 在本次开始前没有后端模拟会话；原 Messenger 入站新建会话 `80cc9a44ddecb4ac11aa3ac2`，仅使用新输入。原草稿请求 `3a826e63-6126-415d-8a82-2e99cff249bc`：6 次真实 qwen-plus HTTP 200，`provider_generated`、校验 verified，生成次数 1。
- [x] **保留原人工闸门并真实翻译。** 原结果为 `waiting_human / human_required`，没有改成 succeeded；接管后人工编辑，原稿和编辑稿分别真实翻译。共 8 次模型响应、7050 tokens；企业事实为本地虚构美妆 Mock，不能视为真实企业承诺。
- [x] **原模板冻结、人工批准、模拟发送与回执。** 本次译文进入原批次 v2，批准版本/hash 与账本正文一致；发送请求 `preview-8cb77297-024d-4000-946d-abfac73392ef`，传输为本地替身，providerMessageId 为模拟身份。模板目录 APPROVED 不等于 Meta 真实审批。
- [x] **故障恢复不重发。** 注入会话写入失败，原账本 accepted + historyWritebackPending；调用原 repairHistory 后清除待写入，再投影模拟送达回执。刷新后消息数 2、生成次数 1、传输次数 1、delivered。11 项最终持久断言全部为 true。
- [x] **草稿恢复展示修正。** 同一原请求恢复中文编辑稿；provider_generated 且 waiting_human 显示需要接管审批，不误报降级。上述整链和截图见[加固后完整链路验收](customer-hardened-preview-full-chain-2026-10-24.md)。
- [x] **测试入口及本地预览默认隔离。** 四个客服相关默认测试脚本使用隔离启动器；预览入口同步安装 guard，后台 worker/PocketBase 自动启动关闭；真实渠道默认不 Ready。固定运行探针 8/8 阻断，浏览器 fetch/XHR/WebSocket/EventSource 4/4 被 CSP 阻断；负例使用保留域名及下层 canary。见[误触复核与隔离加固](customer-channel-isolation-audit-2026-10-24.md)。
- [x] **原智能报价操作链。** Alex 整理需求、人工补价、保存、确认 V1、卡片预览和完整报价插入回复框已浏览器验收；未发送真实 WhatsApp。首次发现的“报价误当 AI + 气泡截断”已后续修复，652 字符全文和刷新恢复已核对。见[报价弹窗历史验收](quote-modal-walkthrough-2026-10-24.md)及[后续修复验收](quote-draft-and-profile-tags-2026-10-24.md)。
- [x] **画像标签可纠正且隔离持久。** 五种客户阶段已展示核对；Piotr/Rina/Alex 纠正后切换、刷新不串用。证据详情保留原文、消息、理由和时间；无来源的旧标签不冒充 AI。原分析写入多轮受控结果及磁盘重读仍保留人工纠正。见[多阶段画像验收](customer-profile-stage-acceptance-2026-10-24.md)。
- [x] **普通页面按已确认方案收拢。** 右侧保留紧凑画像和 AI 回复，询价时在回复区打开原报价弹窗；正常页不显示旧工作区和本地模拟入口。见[前端收拢验收](customer-compact-frontend-2026-10-24.md)。本地整链工具仍可通过明确 QA 参数访问。

- [x] **普通回复区隔离兼容。** 普通页面点击生成建议得到真实 AI 草稿，人工编辑后真实英译保留 75 ml/B7；刷新恢复及同译文缓存重读通过，生成 1、传输 0。新增回归进入默认 pipeline；[专项验收与边界](customer-composer-isolation-acceptance-2026-10-24.md)。

## 4. 验证矩阵：历史执行与本轮复核分开

| 证据组 | 已保存结果 | 本轮确认及限制 |
| --- | --- | --- |
| `composer-compat-*`（后续修复） | 定向 8、隔离 10、pipeline 93、完整客服 67；最终类型/架构/构建通过；普通页面真实模型 6 次/4895 tokens，传输 0 | 本次确实运行；新证据索引冻结改动源码和产物。仍不代替最终候选及全仓/真实渠道门禁 |
| `hardened-full-chain-*` | 隔离启动 1 + 隔离 9；pipeline 91/91；lint、architecture、build 通过，0 跳过；Studio 368838/485000 字节 | 日志与证据清单 13/13 哈希匹配，11 项持久断言 true；清单仅包含 1 个源码文件及文档/产物，不覆盖全部 72 项源码状态 |
| `isolation-audit-*` | 隔离 10、pipeline 91、customer-service 67、whatsapp-onboarding 12 通过，无跳过；类型/架构/构建通过 | 清单 28/28 哈希匹配；完整客服与 WhatsApp 结果属于隔离加固时点，没有将其说成最后所有修改后的重跑 |
| `quote-tags-*-final.log` | 32 项定向、pipeline 83；类型/架构/构建通过 | 来源为报价/标签报告的当次证据；83 与后续 91 是不同时点，不累计成独立用例数 |
| `profile-acceptance-tests-final.log` | 14/14，0 失败、0 跳过；类型/架构通过 | 本轮核对日志；为受控分析回归，预编译后在 guard 内执行；初次打包/启动失败和未纳入的路由测试仍见原报告 |
| 浏览器/原接口整链 | 本地真实 AI + 模拟渠道、故障补写、刷新，报价/标签交互 | 没有真实渠道或真实企业 E2E；截图与原始 JSON 在忽略目录，需做持久脱敏交接 |
| 本轮整理 | Git 分支/HEAD/引用、差异、源码引用搜索、原文档/日志、41 项清单文件哈希、11 项证据断言；`git diff --check` | 本轮未重跑应用测试/构建/模型；未运行全仓 quality/verify、远端 CI、迁移门禁或目标库操作 |

原始证据目录：`../../tmp/customer-service-preview/`。清单及运行文件索引见[脱敏 JSON](evidence/customer-premerge-review-20261024.json)；其中保留来源清单哈希，未复制账号凭据、Authorization 或完整运行库。哈希匹配证明列出的文件未变化，不证明未列入的其他文件也相同，也不能证明所有历史网络请求均被拦截。

## 5. 剩余缺口、风险与关闭条件

| 优先级/性质 | 缺口或风险 | 关闭条件 |
| --- | --- | --- |
| 合入门禁 | 72 项混合未提交改动，还没有明确候选提交和逐文件归属；新服务/脚本/类型/测试大多未跟踪，单看 git diff 会遗漏 | 对照 JSON 路径逐项选择候选，保留其他修改；形成可重现补丁/提交及完整文件清单。当前不执行提交或拆分 |
| 合入门禁 | 历史门禁来自不同工作区时点，两个 manifest 都不是完整候选源码快照 | 冻结候选后统一执行隔离、客服链、完整客服、WhatsApp、报价/标签/画像定向，以及类型、架构 ratchet、构建、差异检查与适用迁移只读门禁；记录 SHA、脏状态及源码哈希。不得默认运行真实供应商测试 |
| 已关闭（本地范围） | 普通草稿/翻译原接口缺少受限 AI 作用域 | 已接入原模拟组合服务、草稿账本与共享翻译；普通页面真实 AI 草稿/翻译、刷新和重复查看通过。定向 8、隔离 10、pipeline 93、完整客服 67 及类型/架构/构建通过；真实渠道保持阻断，详见专项报告 |
| 回归风险 | Messenger 仓库注入、followup store 参数、草稿适配导出、共享翻译及三渠道标签投影影响原路径 | 复核默认参数与原行为、鉴权/只读、租户边界、过期审批/正文变更、人工接管/未知发送结果；确保定向测试纳入候选门禁。真实账号未验收应保持明确边界 |
| 评审重点 | 隔离涉及模块装载、ESM/CJS、worker、Node 后代及原生编译器精确例外；只覆盖受信应用进程，不是 OS 防火墙 | 审查启动顺序、Node >=22.19 运行条件、完整性检查、AI 作用域生命周期与例外 realpath/版本/参数；负例继续使用 `.invalid` + canary，绝不重访真实渠道 |
| 历史证据缺口 | 旧 tsx 测试子进程曾逃过 guard，直接向真实渠道地址做无凭据/收件人/正文 POST；没有保存提供方响应/抓包 | 保留事故记录与当前修复/回归证据；该历史响应无法追补，不得改写为“从未访问真实地址”或“历史全部阻断” |
| 可观测性限制 | 预览仍有被拒绝后台轮询；guard 日志只记录传输类型/时间，不能逐条识别业务目的 | 评审确认原功能受影响范围；后续如加目标分类须脱敏。不能据此断言是渠道成功出网，也不能据此断言正常辅助功能无影响 |
| 产品/验收边界 | Emma 为未用过的既有模拟人物身份，新建的是后端会话；前端旧 CNC/报价画像与新美妆咨询不一致 | 验收材料持续标注；若需“新建客户及画像自动更新”结论，另走原创建/分析流程验证，不能用本次证据代替 |
| 覆盖不足 | 多阶段标签浏览器验证与真实 AI 整链是两套场景；浏览器未跑真实模型重新分析标签，IG/WA 真实资料写入亦未做 | 保留受控分析回归结论；三渠道资料纠正与权限用隔离测试覆盖，真实渠道 E2E 留作明确授权后的独立验收，不阻碍当前仅模拟目标的事实成立 |
| 范围待定 | `CustomerWorkspaceTools`/tasks 留在工作区，普通页面已不挂载，仍有旧方案文档 | 确定候选包含范围或另案处理；本轮不删文件、不恢复入口，后续文档不得再把旧页面入口列为已开放 |
| 交接风险 | 完整截图、日志及原接口 JSON 位于被忽略 tmp，当前新 QA 文档同样未提交 | 合入前将必要证据脱敏归档至可交接位置，补齐哈希/相对链接；不直接纳入运行库、密钥、账号或编译产物。本轮新增 JSON 可保留证据索引但不能替代原始文件 |
| 非当前授权范围 | 真实渠道全为不 Ready，模板目录/发送/回执为模拟；未做 Meta 审批、OAuth、真实送达、生产库原子能力/部署验收 | 不将这些写作已实现上线能力；真实验收需独立明确授权与账号准备。当前继续关闭真实渠道，无需为本清单补做真实调用 |

## 6. 合入前逐项签核

- [ ] 确认目标基线引用及其 SHA，重新核对本地/远端差异；如与治理记录冲突，先停止合入判断。
- [ ] 冻结本次候选文件与源码哈希，确认全部必要未跟踪文件已纳入候选；其他未提交修改留在原处。
- [ ] 明确旧未挂载工作区文件归属，以及共享标签/翻译/存储默认路径的评审负责人和结论。
- [x] 关闭普通回复区 AI/翻译入口的隔离兼容性缺口；未扩大真实渠道许可。原接口、隔离数据/AI 审计及普通页面验收见专项报告。
- [ ] 按验证矩阵对最终候选补齐统一门禁，保留首次失败、修复与复测记录；确认新标签及报价测试没有遗漏。
- [ ] 保留历史误触的证据边界，确认隔离 canary、无 preload 启动及空 env 子进程/worker 回归持续有效。
- [ ] 完成必要原始证据脱敏归档，检查链接和哈希；标注 Mock 企业、模板及回执，避免误认真实 E2E。
- [ ] 核对 PRD 16.10/16.11、草稿全文/来源、接管/审批/账本恢复与刷新交互；真实模型标签再分析等未验项目继续登记。
- [ ] 给出明确的代码评审结论与剩余风险接受意见，再另行决定是否合入；本清单不构成合入授权。

当前安全恢复点是 HEAD 加整理前完整工作区哈希清单，不是可直接 reset 的回滚点；工作区未提交内容与本地运行数据应分别保留。清理、重置、归档、迁移、真实渠道联调和基线合入均未在本轮执行。

## 7. 后续并行落地更新（18:13 后）

上述第 5、6 节为整理时点记录；后续用户授权多个子 agent 并行执行，结果以[并行修复与统一验证报告](customer-parallel-fixes-2026-10-24.md)为最新本地证据：

- 新模拟入站与旧画像错配、旧轮询覆盖人工纠正、新消息保留旧 AI 建议三项已修复，预览已更新。
- 客服模拟预览停止无关标签/周任务恢复，增加固定脱敏诊断；其他环境原逻辑经交叉复核。
- 已统一运行功能矩阵（隔离、pipeline 93、完整客服 67、WA 12、专项 73）及类型、架构/ratchet、197 迁移只读检查、构建和差异检查；5258 路径执行前后哈希一致。不是累加独立用例数，不是全仓 quality/verify。
- 完整最终日志、压缩原始结果、候选源文件哈希、运行摘要及截图已归档到 docs/qa/evidence，关闭仅 tmp 可交接的缺口。
- 未挂载工作区文件保留，明确不属于当前可见 UI，未重新开放。候选仍未提交，未作删除或基线合入判断。
- 真实模型标签再分析浏览器整链、真实渠道 E2E 与历史响应缺证仍保留，未因本轮测试通过而声称关闭。
