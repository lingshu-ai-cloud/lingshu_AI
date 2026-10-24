# 客服候选统一隔离门禁

日期：2026-10-24（Asia/Shanghai）。目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。候选仍是未提交工作区，不推进基线、不提交或推送。

## 可重复入口

- `pnpm run test:customer-candidate`：先测矩阵契约，再按 isolation-bootstrap、isolation、pipeline、service、whatsapp、features 顺序执行。保留现有三组测试文件清单并要求它们继续使用隔离启动器；若被改为普通 tsx 或加入 shell 语法，则直接拒绝。
- `pnpm run test:customer-candidate:features`：报价入口、编辑/确认/卡片/服务端报价、标签维度/纠正/多轮分析与磁盘重读、普通草稿/翻译兼容、模拟路由、后台恢复策略及脱敏诊断。
- `pnpm run check:customer-candidate`：TypeScript、架构、架构 ratchet、迁移清单只读检查、迁移 guard 临时仓库测试、构建、`git diff --check`。迁移检查不连接数据库、不执行迁移；guard 的 Git 提交仅存在于自身创建的临时 fixture 仓库。
- `node scripts/customer-candidate-matrix.mjs --list`：打印实际文件清单而不执行。

功能测试启动器安装默认拒绝出网 guard 和下层 canary，后代 Node/worker 继承；仅对 tsx 实际依赖的 esbuild realpath、已安装版本及两个精确参数 `--service=<version> --ping` 给予编译器例外，未放行任意原生进程。静态 `--checks` 直接运行已审查的本地检查/构建命令，因迁移 guard fixture 需要 Git，不使用相同的进程网络 guard；没有导入应用或执行渠道验收，不宣称该组具备同等级出网拦截。矩阵将继承的 `CUSTOMER_SIMULATION_REAL_AI` 设为 0；能力范围测试使用受控 provider，不进行真实模型或渠道请求。

每次执行前后计算全部受版本控制及未忽略新文件的 SHA256：`src/`、`server/`、`shared/`、`scripts/`、`pb_migrations/`、产品 PRD 和关键配置。前后快照之间发现源码增加、删除或内容变化，或 HEAD 改变，都使该轮结果失败并列出路径；不能将测试用例全过但源码变化的一轮说成最终候选通过。哈希相同证明开始与结束内容一致，不证明执行中曾改变又恢复的文件从未变化。结果 JSON 位于 `tmp/customer-service-preview/candidate-<suite>-result.json` 与 `candidate-checks-result.json`；最终交接另做脱敏持久归档，JSON 本身不包含运行库、凭据或账号。

## 未挂载旧组件归属

`CustomerWorkspaceTools.tsx` 只在自身文件和测试中出现；`ConversionPage.compactConversation.contract.test.ts` 明确禁止重新挂载。`customerWorkspaceTasks.ts` 的调用方只有此组件及其测试。它们是此前本地功能实现遗留，当前普通客服页面不开放其中“客户资料与订单”“批量跟进与模板审批”“微信客服”“本地模拟链路”入口。

本轮保留源文件和投影测试，不执行删除、不恢复入口，也不将其列为当前用户可达功能。候选交接将三文件归为“历史未挂载工具”；后续若决定清理，应单独检查其唯一依赖及旧文档链接后删除，避免将可复用的 CustomerWorkflowPanel、资料 widgets 或模拟后端一并删除。

## 准备阶段实际结果

- 矩阵契约 2/2 通过，拒绝普通 tsx 及注入 shell 的负例通过。
- 新入口隔离准备回归：bootstrap 1/1、隔离 9/9，0 跳过。
- features 准备回归：59/59、0 跳过。运行期间其他代理写入 `server/index.ts` 和新增恢复策略两文件，源码变更栅栏正确判为该轮整体失败，未登记成最终统一门禁。
- 完整候选结果以源码稳定后的统一执行日志与脱敏归档为准；本准备记录不代表真实 E2E、供应商验收或发布就绪。

## 冻结后最终执行

北京时间 2026-10-24 18:10 起执行两入口，HEAD 始终为上列 SHA；功能与静态各自开始/结束的 5258 项源码文件 SHA256 均一致，`stable=true`、`changed=[]`。

| 组 | 实际结果 |
| --- | --- |
| 矩阵契约 | 2/2 |
| 无 preload 启动 | 1/1 |
| 出网隔离与能力范围 | 9/9 |
| 客服 pipeline | 93/93 |
| 完整客服 service | 67/67 |
| WhatsApp onboarding | 12/12 |
| 报价/标签/画像/普通回复/诊断 features | 73/73 |
| TypeScript | `tsc --noEmit` 通过 |
| 架构与 ratchet | 2702 个生产 TS；相对 `89b17510` 通过，ratchet 自测通过 |
| 迁移 | 197 项文件只读校验通过；临时 Git fixture guard 通过 |
| 构建 | 通过；Studio 368838/485000 字节，保留既有 >500 kB chunk 提示 |
| 差异检查 | `git diff --check` 通过 |

测试均为 0 失败、0 跳过；不同组有重复覆盖，不能相加视作独立用例数。日志为 `candidate-final-tests.log`、`candidate-final-checks.log`；机器可读 `candidate-all-result.json`、`candidate-checks-result.json` 含精确开始/结束时间、完整文件哈希和各组退出码。由主任务统一脱敏持久归档。曾因并行修复被主动中断的 `candidate-interrupted-prerun-*` 不计最终结果。

本轮没有真实模型标签分析、真实渠道 E2E、数据库迁移、提交、合并、推送或部署；已通过本地候选回归不代表供应商或发布就绪。安全恢复点仍为 HEAD 加未提交工作区与前后哈希快照，不能用 reset 替代保留当前工作区。

## 后续静默画像分析：原生渠道只读边界

2026-10-24 后续收到新要求，在本地客服预览新消息后静默进行画像分析。本节为实施前源码核查，不代表运行真实渠道。

- Messenger `handleMessengerWebhook` 在非 echo 买家消息持久化后后台调用 `analyzeMessengerCustomerTags`；Instagram 同理调用 `analyzeInstagramCustomerTags`。分析均复用 `classifyContextTags`，结果提交前重读会话，最多三轮避免旧消息快照写回，并应用最新人工纠正。失败记录退避；recover 按买家指纹及分析版本补漏。原生可见投影在新指纹下仍可能显示 pending，不能据此宣称已满足本轮“保留上次画像直到新分析完成”的本地展示契约。
- WhatsApp 签名入站走 `handleVerifiedWhatsAppInbound` → `handleInboundMessage(skipAutonomy:true)`，只做消息持久化和本地 qualification，没有直接触发 `classifyContextTags`。其授权读取通过 `projectCustomerBusinessProfile` 校验分类指纹，新消息使旧分类失效为 pending；模型标签分类由既有 `customerBatchService.classify` 显式工作流触发，不是每条入站自动运行。
- 本轮实施和验收限定本地预览组合服务，不扩展 WhatsApp 原生权限或账户链路，不将模拟改动表述为全渠道自动画像已经完成。真实渠道、真实模型标签重新分析继续不调用、不验收。
- 已有路由/普通回复兼容测试会将真实 AI 环境标志临时设为 1，因此显式注入 `profilePorts.enabled:()=>false`；新后台分析专项使用受控分类 provider，防止旧 fixture 意外进入新默认模型路径。

## 静默画像增量最终复验

新增自动画像及页面恢复后，旧路由/普通草稿兼容测试显式禁用默认画像模型端口；新增后台异步分析、买家指纹去重、过期结果拒绝、人工纠正、失败退避/原结果保留、审计合并及前端快照恢复测试进入 `features`。模型 provider 均受控注入，没有实际模型或渠道调用。

首次静态检查因新画像返回字段缺少明确 TypeScript 契约，以及来源标签未作数组收窄，停在 `tsc`，后续架构/构建当时未执行；日志 `silent-profile-checks-first-failure.log` 保留。补齐显式业务/状态返回类型和数组边界后，重新冻结并全量重跑本轮受影响三组，未用旧 scope 的通过结果替代新候选结果。

- `node scripts/customer-candidate-matrix.mjs features`：90/90，0 失败、0 跳过；UTC 10:34:45.193—10:35:02.700。
- `node scripts/customer-candidate-matrix.mjs pipeline`：93/93，0 失败、0 跳过；UTC 10:34:45.851—10:35:04.899。
- `ARCHITECTURE_BASE_REF=89b17510 NODE_OPTIONS=--max-old-space-size=4096 pnpm run check:customer-candidate`：TypeScript、2703 个生产 TS 架构预算/ratchet、ratchet 自测、197 项迁移文件只读、迁移临时 fixture guard、构建、diff 检查全部通过；UTC 10:34:47.461—10:36:01.444。Studio 仍为 368838/485000 字节，仅既有大 chunk 提示。

三组各自 `passed=true`、`stable=true`、`changed=[]`，5262 项源码开始/结束哈希一致，HEAD 未变。日志 `silent-profile-final-features.log`、`silent-profile-final-pipeline.log`、`silent-profile-final-checks.log` 与对应 `silent-profile-*-result.json` 均保存于原证据目录，并由主任务脱敏归档。此前完整 service/WhatsApp 的结果仍属于上一冻结时点，本次只重跑本轮受影响组，不宣称重新执行全仓 quality/verify。

后台分析恢复只提供显式 `profile.recover` 接口；本轮没有启用进程重启后自动扫描恢复。GET/列表恢复不执行模型。静默更新实现限定当前本地预览，原生 WhatsApp 仍有上一节列明的自动分类缺口。未真实模型/渠道验收、未合入基线、未提交或部署。
