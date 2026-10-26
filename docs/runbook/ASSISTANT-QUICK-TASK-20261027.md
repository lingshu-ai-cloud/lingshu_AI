# 快捷任务修复交接 · 2026-10-27

工作目录 `/Users/jiejie/Documents/lingshu-AI`；分支 `节节1025服务器上传`；HEAD `0c4fda229bf564dbde2120e446aec5e9f6ba8397`。本次未提交、推送、部署或推进基线。开始时已有未提交改动，全部保留；不能通过整文件回退或重置来撤销本次修改。

## 批注处理

1. 首页每组只渲染最左侧四张快捷卡片。
2. 内部回答不再以“总体结论”标题为成功条件；服务端可预期错误保留公开原因；真实网络/供应商中断仍如实报错，不做假成功。SSE 心跳覆盖企业范围读取阶段。长客户记录使用带覆盖说明的短摘录，完整计数与排名保持独立。
3. 本地缺少半年报时展示企业名称、代码、业务类别，并提供公开信息、刷新官方目录入口；不伪造财务数字。
4–5. 资讯按钮直接发起，行业/市场/平台依次复用企业资料、Agent 配置、内容目标与计划快照；不发送客户、价格或凭据给公开来源。关闭 AI 资料访问仍受尊重。
6. 固定 BASF、FDA、Meta 官方采集栏目，实际保存 6 篇原文元数据。FDA 被站点拦截，未绕过。详见 `ASSISTANT-AUTHORITATIVE-NEWS.md`。
7. 默认近七个北京时间自然日，取消只读查询日期弹窗。
8. 本地 `.env.local` 精确配置美妆测试用户及所属租户的 Token 豁免；其他账号、调用次数、素材生成/付费额度及供应商限制不变。该配置未进入 Git。
9. 客户优先级直接分析授权集合，测试/归档/退订客户不进入真实跟进排名。
10. 具体客户改为对话内选择，后续提示继续查看上一位或更换；对象与选择提示经前后端校验并保存，对话消息合并不能丢弃它们。
11. 投放数据在对话内选择计划，不再弹日期/计划确认框。
12. 创建新投流计划按目标、企业市场/渠道、已有素材、预算逐步确认，复用原草稿 API；最后确认才保存，不启动投放。保存结果未知时禁止重复提交并提供列表核对入口。

## 主要改动文件

- `src/components/ContentCreationHome.tsx`、`src/lib/assistantHomeQuickPrompts.ts`：四卡片与直接查询入口。
- `src/components/assistant/AssistantBusinessSceneChoice.tsx`、`AssistantAdPlanConversation.tsx`、`useAssistantSend.ts`、`AssistantConversationBubbles.tsx`、`globalAssistantRuntime.ts`：对话内选择和新计划引导。
- `shared/contracts/assistantBusinessScene.ts`、`src/lib/assistantThreadJournal.ts`、`server/routes/assistantThreadMessageInput.ts`：日期默认与对象持久化。
- `server/routes/strategy.ts`、`server/agents/llm.ts`、`src/lib/assistantStreamCompletion.ts`：回复格式及中断原因。
- `server/assistantContext/externalNewsScope.ts`、`newsEnterpriseDefaults.ts`、`businessScenes/customerEvidence.ts`：企业默认范围及有界客户证据。
- `server/externalInformation/authoritativeNews.ts`、`scripts/collect-authoritative-news.ts`：固定来源与本地采集。
- `src/components/assistant/CompanyReportScene.tsx`、`server/lib/demo.ts`、`src/lib/auth.ts`、`src/components/Layout.tsx`：无财报回退入口及账号 Token 豁免状态。
- 对应定向测试与唯一 UI 规范中的 2026-10-27 修订；此前已有文件改动不视为本次独有。

## 实际验证与限制

- `git diff --check` 通过。
- `node scripts/check-architecture.mjs`：3002 个生产 TypeScript 文件通过；未设置 `ARCHITECTURE_BASE_REF`，预算 ratchet 未执行。
- `node --import tsx --test --test-concurrency=1 …` 定向合集：56 项，54 通过、1 项既有布局断言失败、1 项接口测试超时。布局断言要求旧的 `animate={{ width, minWidth, maxWidth }}` 字面写法；已读取原始 HEAD 确认该断言在修改前也不匹配。
- 客户证据和精确账号限额单独复跑 8 项全部通过；Qwen 流终态、简短无标题回复、取消后的不续调、快捷提示、日期、缓存、对话选择/保存均有通过记录。最终对话消息合并保护另有定向回归。
- 对话接口集成测试较早一轮通过；在内存竞争下合集及最后单独复跑超过现有 30 秒截止，最新完整接口回归不能记为通过。
- `pnpm run lint`：默认 2 GB 堆耗尽；4 GB、3 GB 复跑在长时间内存交换下停止，没有取得 TypeScript 全量成功结果。其他工作树仍有类型检查在运行，未终止它们。
- 真实本地 HTTP 验证：美妆账号行业资讯和社交媒体资讯均 200，收到 `[DONE]` 和对应 BASF/Meta 原文；社媒查询不再追问平台。未调用付费模型来验证语言质量。
- 浏览器已确认四张卡片、对话内客户下拉框、新投流计划目标步骤；未提交测试广告草稿、未启动投放。后续浏览器截图请求受本机负载影响超时，保存的客户选择截图位于 `/tmp/lingshu-inline-customer-choice.png`。

源码、运行缓存和真实供应商 Ready 是独立状态。本次不是发布验收；剩余检查是内存资源可用后复跑 TypeScript 与对话接口集成测试。安全恢复锚点为上述 HEAD，但既有脏改动必须保留；资讯历史快照位于 `data/local-store/authoritative-news/`，无生产 run/task 标识。

## 2026-10-27 续跑：内存竞争下的检查记录

- 分支和 HEAD 不变，未提交、推送或部署；既有工作区修改保留。
- 机器物理内存 8 GiB，检查期间 `memory_pressure -Q` 最低空闲 5%，交换空间最高观察到约 18 GiB。其他工作树同时运行多项 TypeScript，本会话没有终止或暂停它们；本会话未完成的类型检查已终止释放资源，仍不能声明全量 TypeScript 通过。
- 修复 `src/components/Layout.tsx`：侧栏 `width/minWidth/maxWidth` 同步采用已有空间过渡，避免静态最小/最大宽度使折叠跳变。`LayoutStability.contract.test.ts` 3/3 通过，没有删减既有断言。
- 增补 `server/routes/assistantThreads.actions.test.ts`：对话内选择与已选客户可经 HTTP 保存和读回；无效场景、缺失客户、伪造租户字段和用户消息伪造选择被拒绝。该文件 12/12 通过（总耗时约 141 秒，测试断言执行约 4 秒，其余主要为模块加载）。
- `ARCHITECTURE_BASE_REF=HEAD pnpm run check:architecture` 通过：3002 个生产 TypeScript 文件，包含相对 HEAD 的预算 ratchet；`git diff --check` 通过。
- `strategy.grounding.integration.test.ts` 分开记录启动准备和接口断言；启动预算 180 秒，接口仍保留原 30 秒总截止和单请求 8 秒截止。最新一轮启动准备 47,263 ms，随后发生 `TimeoutError`；该组尚未通过，不能把环境压力推断为已排除所有业务问题。
- 本地 `GET http://127.0.0.1:8891/api/overseas/health` 返回 200 / `status: ok` / SHA `0c4fda22`。这是服务存活证据，不是付费供应商或 worker Ready 验收。浏览器控制出现 transport closed，打开新预览请求未取得确认。
- 继续检查需其他编译进程结束，或用户授权暂时暂停它们后再恢复；不擅自影响其他会话。最新预览入口仍为 `http://127.0.0.1:5181/?page=strategy&view=inspiration&previewRevision=0c4fda22-checkfix`，查询参数仅用于区别预览入口，不代表新增提交。

## 2026-10-27 最终续跑结果（覆盖上节未完成状态）

用户要求避免复杂、非必要检查，本轮只完成既定类型检查及直接相关接口回归，没有运行全仓 quality / verify、构建、付费请求或部署。

- 资源恢复、没有其他 TypeScript 进程后，`NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint --pretty false` 完整退出 0，没有类型诊断。
- `node --import tsx --test server/routes/strategy.grounding.integration.test.ts` 通过：2/2（父测试与 HTTP 子测试）。启动准备 2,221 ms，HTTP 合同断言 268 ms，总进程约 2.86 秒；原 30 秒断言/8 秒请求限时均保留。模型、公开搜索和数据供应商传输使用隔离夹具，不是付费模型 E2E。
- 加上本轮此前的会话保存接口 12/12、布局合同 3/3，以及相对 HEAD 的架构预算检查，待收尾项目已有通过证据；最终 `git diff --check` 通过。
- 最后内存读数：8 GiB 物理内存，系统报告空闲 54%；交换空间使用 3,634.50 MiB。未暂停或终止其他会话的进程。
- 恢复当前工作树 Vite 预览 `127.0.0.1:5181` 与后端 `127.0.0.1:8891`；后端保持 `role=web`、`backgroundJobs=false`，不启动生产/投放 worker。前端 HTTP 200；本地预览登录和 `/auth/me` 均 200，身份为 `local_user_customer_aurelia_beauty` / `local_tenant_customer_aurelia_beauty`。
- 打开预览请求已由应用接受并排入本会话，用户后续提供的浏览器上下文已指向 `previewRevision=0c4fda22-checkfix`。后续自动页面观察被浏览器权限策略拒绝，未绕过、未声明本轮截图/视觉验收通过。
- 当前 SHA 仍为 `0c4fda229bf564dbde2120e446aec5e9f6ba8397`。本轮必要修改为 `src/components/Layout.tsx`、`server/routes/assistantThreads.actions.test.ts`、`server/routes/strategy.grounding.integration.test.ts` 及本记录；此前全部未提交现场保留。无新增迁移、真实外部 run/task、提交、推送或部署。
