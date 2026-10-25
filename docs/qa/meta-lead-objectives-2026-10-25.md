# Meta 三种获客目标接入验证（2026-10-25）

位置：/Users/julia1/Documents/ChatGPT/1025投流
分支：feature/platform-ads-20261025
HEAD / 安全恢复参照：dfc9b0c8af85175485cf39370eed92c4be3daedd；本轮尚未提交。
前序账户选择布局修复的 3 个脏文件保留并未撤回；本轮没有更新集成基线。

## 完成范围

- 创编选项新增获取消息会话、获取Meta表单线索、获取独立站询盘。选择后解释 Meta 目标及准备条件。
- 保存计划后在既有真实平台执行区域配置目的地/号码/IG 资产、已有即时表单、网站 URL/Pixel。原人工、审批、托管、预算和暂停创建策略继续生效。
- 首次创建前只读核对关联消息资产、表单归属/ACTIVE/主页条款、账户 Pixel；不自动接受条款或创建这些资产。
- 参数通过旧 meta payload 保存到审批、托管与不可变创建快照；读回对照原始目标、目的地、promoted_object 与 CTA，异常保留 UNKNOWN，不重建。
- 新消息会话、即时表单线索和网站 Lead 指标分别映射；未返回保持空值，不以点击或总体 lead 替代。

## 实际验证

- 初轮 `test:platform-ads` 的实际脚本命令：`node scripts/test-platform-ads.mjs`，59 个测试文件通过；包含新增两份服务端测试。当时尚未把 MetaLeadFields UI 测试加入统一脚本清单，之后已加入，未冒称重新执行整个 60 文件清单。
- 最终定向复跑：`node --import tsx --test server/platformAds/metaLeadGoals.test.ts`，8/8；覆盖三个目标、三个消息目的地、资产不匹配、缺字段、HTTPS、四层暂停创建、参数读回漂移、分口径统计和未接受条款零写入。
- `node --import tsx server/platformAds/metaLeadExecution.test.ts` 通过；三个目标贯穿草稿→本地预检→模拟创建→快照→幂等→对账，另验证跨租户拒绝、审批/托管参数持久化。平台调用均模拟，本地数据隔离在系统临时目录。
- `node --import tsx server/platformAds/creativeLibrary.test.ts`、`node --import tsx src/components/MetaLeadFields.test.tsx`、`node --import tsx shared/platformAdCapabilities.test.ts` 后续定向通过。
- `lint` 对应 `node node_modules/typescript/bin/tsc --noEmit` 最终退出 0；`ARCHITECTURE_BASE_REF=dfc9b0c8 node scripts/check-architecture.mjs` 最终通过（2749 个生产 TS 文件，ratchet 通过）；`git diff --check` 通过。
- 执行 package.json 的完整 `build` 脚本，退出 0；Studio 367202/485000 字节，chunk 边界通过。保留构建工具原有大 chunk 提示。
- 浏览器确认三种新目标可选择及对应说明；输入表单 SSR 检查按目的地显示不同字段。没有保存测试草稿到业务数据库；本地计划数仍为原 5 条。
- 后端刷新为本分支源码，9037 健康检查 200；前端 5237；仍复用原本地 PB 8991。调试日志、测试原始输出和截图在忽略目录 tmp/ads-preview/。

## 未验收边界

未发起真实广告创建、上传、启用或付费请求；没有新 OAuth、数据库迁移、部署或推送。当前预览仍只允许本机与 Meta HTTPS GET，真实创建未开放。Meta 账户实际目标资格、表单条款/权限、消息号码关联、Pixel 事件回传及真实归因效果均需对应账户验收；不能将模拟成功当成平台 Ready。未扩展线索明细同步、CRM/CAPI 建设或表单编辑器。要真实验证，需准备对应资产并明确批准每个暂停创建请求；不自动启用投放。

## 改动文件

- `scripts/test-platform-ads.mjs`
- `server/platformAds/README.md`
- `server/platformAds/approvals.ts`
- `server/platformAds/creativeLibrary.ts`
- `server/platformAds/execution.ts`
- `server/platformAds/launch.ts`
- `server/platformAds/metaAdapter.ts`
- `server/platformAds/metaPlanAudit.ts`
- `server/platformAds/metaPlanReadback.ts`
- `server/platformAds/metrics.ts`
- `server/platformAds/preflight.ts`
- `server/platformAds/tasks.ts`
- `shared/metaPerformance.ts`
- `shared/platformAdCapabilities.test.ts`
- `shared/platformAdCapabilities.ts`
- `src/components/AdAccountConnections.tsx`
- `src/components/AdAccountDirectory.tsx`
- `src/components/PlatformAdsOperations.tsx`
- `src/components/PlatformAdsPage.tsx`
- `src/components/metaPerformance.css`
- `src/components/platformAds.css`
- `docs/architecture/adr/2026-10-25-meta-lead-objectives.md`
- `server/platformAds/metaLeadAssets.ts`
- `server/platformAds/metaLeadExecution.test.ts`
- `server/platformAds/metaLeadGoals.test.ts`
- `shared/metaAdObjectives.ts`
- `src/components/MetaLeadFields.test.tsx`
- `src/components/MetaLeadFields.tsx`

## 后续：创建页的真实表单示例与准备说明

用户要求在前端创建计划时查看真实平台表单。新增 `MetaInstantFormGuide.tsx` 及对应 CSS，只在即时表单目标出现。使用 Meta 官方 2023 年获客指南第 2 页原始嵌入截图（Im24，942×1730），未重绘字段；来源与年份在界面及 `public/references/meta-instant-form-official-2023.source.md` 标明。图片支持共享 Image 放大预览，浏览器确认加载原始截图且自然宽度 942，容器无横向溢出。

准备说明列出文案/语言、联系字段和采购问题、隐私说明、结束页、主页/版本/条款、线索接收安排；明确可先保存灵枢草稿，表单问题仍在 Meta 修改，未提供线索明细到客户会话的自动同步。

`PlatformAdsPage.contract.test.ts` 8/8、TypeScript、架构及 ratchet（2750 文件）、build 和 diff 检查通过；原始日志为 tmp/ads-preview/form-guide-*。浏览器完成截图加载与放大检查。未修改实际 Meta 表单、创建广告或提交测试线索。

## 2026 截图与创建窗口右栏（2026-10-25）

- 当前分支 `feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。本轮改动未提交，未推进集成基线；此前目标接入等脏改动保留。
- 改动文件：`src/components/PlatformAdsPage.tsx`、`AdGoalExamples.tsx`、`adGoalExamples.css`、`MetaInstantFormGuide.tsx`，以及 `public/references/*2026*` 和对应来源说明。创建流程为左侧输入、右侧 Meta 示例；800px 以下通过右侧 Drawer 查看，截图不移动到表单底部。表单准备清单改为可展开的纵向清单。
- 撤下创建流程中 2023 年截图，改用原作者 V.S.L Digital Marketing Hub 于 2026 年 3—7 月发布的实录截图。逐条在 YouTube 展开描述核对发布日期，来源、时间点和用途见 `public/references/meta-ad-goal-examples-2026.source.md`。全部五个 Meta 创建目标均有对应图片；图片可放大，带错误反馈和原始实录链接。
- 已知限制：视频观看教程中的视频还在处理，未得到最终广告预览，因此明确使用 Video views / Maximise ThruPlay views 设置截图，不冒充客户广告画面；网站询盘图为真实独立站承接页，消息图为 Messenger，不能称为 WhatsApp 对话图；即时表单预览右缘在原始实录中有少量裁切。截图不是当前账户广告，不保证各地区和后续平台版本外观完全一致。
- 浏览器实际检查：逐一切换网站访问、视频观看、消息、Meta 表单、独立站询盘，五张图片 naturalWidth 均大于 0、complete=true，来源链接与目标匹配；桌面右栏切换时回到顶部。图片放大后 Escape 保留创建窗口；720×800 窄屏右侧 Drawer 打开/关闭后保留创建窗口与目标。测试视口已恢复默认。预览证据 `tmp/ads-preview/goal-examples-right-sidebar.jpg`。
- 实际验证：`node --import tsx --test src/components/PlatformAdsPage.contract.test.ts` 8/8；`pnpm run lint` 退出 0；`ARCHITECTURE_BASE_REF=dfc9b0c8 node scripts/check-architecture.mjs` 2751 个生产文件通过、ratchet 通过；`pnpm run build` 退出 0，Studio 367202/485000 字节通过，存在既有大 chunk 提示。最后的图片高度调整已重新构建并在浏览器确认。没有重跑全仓 quality/verify 或真实投放 E2E。
- 外部操作：只读访问当前 Meta 广告预览与公开教程；没有创建/发布广告、接受条款、提交线索或部署。无新增外部 run/task ID。没有待用户审批的外部操作。
- 恢复点为当前 HEAD 及本工作区此前改动；若撤销此轮，按文件差异移除右栏入口和新截图引用，保留此前三类目标实现与其他脏改动，不执行整树 reset/restore。

## 获客承接信息与二次确认（历史验证，该方案现已撤回）

- HEAD 仍为 `dfc9b0c8af85175485cf39370eed92c4be3daedd`，分支不变，全部未提交；不推进基线，不部署。
- 改动：新增 `shared/adLeadHandoff.ts` 和 `src/components/AdLeadHandoffConfirmation.tsx`；更新 Meta 目标契约、`server/platformAds/metaAdapter.ts`、`execution.ts`、`PlatformAdsOperations.tsx`、`MetaInstantFormGuide.tsx`、共享投放 CSS、相关测试及本 ADR。负责人、接收入口、回访方式与企业账号成为三个获客目标真实创建前的必填信息；测试接收与再次确认未勾选时禁用提交，服务端也独立阻断。修正真实执行按钮仍只列出网站/视频两目标的旧判断，以共享目标集合及承接确认共同控制，其他发布/权限/版本/预算门禁保留。
- 确认会保存在审批载荷、托管创建配置及不可变创建快照；不写入 Meta 请求。修改资产或承接安排后清除勾选，切回原表单也不会恢复旧确认。草稿保存不要求完成测试。启用/恢复检查原始创建记录的承接确认，缺少的历史获客快照要求人工核对，不静默补齐。
- 界面明确：Meta 表单明细尚未自动同步到灵枢客户会话；测试结果是用户人工声明，不代表系统已验证送达，也不保证客户填写的联系方式真实有效。需要用户实际安排负责人并验证入口，程序没有代为提交测试线索。
- 验证：首次 `pnpm run lint` 发现新增快照调用参数类型过宽，已改为只要求实际使用的 `result/taskId`；首次领域回归发现 VM 组件测试替身未加载新导出的函数，修正替身后失败项复跑通过。最终 `node scripts/test-platform-ads.mjs` **61 个文件全部通过**，覆盖三目标不确认时预检、执行、审批、托管均阻断，确认载荷持久化且不会传给 Meta；`pnpm run lint` 退出 0；`ARCHITECTURE_BASE_REF=dfc9b0c8 node scripts/check-architecture.mjs` 2753 文件及 ratchet 通过；`pnpm run build` 退出 0，Studio 367202/485000；`git diff --check` 通过。未运行全仓 quality/verify 或真实供应商 E2E。
- 浏览器：通过独立本地交互预览检查实际新组件，填写示例资料并勾选后按钮可用；更换表单及切回时三个勾选均清空、提交禁用；截图 `tmp/ads-preview/lead-handoff-confirmation.jpg`。预览不会保存计划或调用平台。没有把示例勾选当成真实业务验收。
- 本地后端已重启加载新校验，仍使用原有本地数据库、web 角色及外部写入阻断；未改账号、表单、数据库结构或运行数据。无新增外部 run/task ID。真实客资送达、用户业务负责人及入口测试仍待用户实际确认。
- 恢复点：当前 HEAD 和保留的本会话工作区。撤销时仅按本段文件差异移除承接门禁，不能覆盖此前三类目标、截图右栏或其他脏改动；没有执行整树 reset/restore。

## 按用户决定撤回客资承接收集与门禁（2026-10-25，当前状态）

- 用户明确：获客后的联系由客户自行安排，产品无需收集或发送负责人、接收入口、回访方式和账号，也不应要求测试送达或二次确认作为必要门禁。上一节仅保留为历史验证，不再是当前产品规则。
- 删除上轮新增的 `shared/adLeadHandoff.ts`、`src/components/AdLeadHandoffConfirmation.tsx` 及其专用测试和临时预览。移除 `MetaLeadConfiguration` 承接字段、执行 UI 的收集/提交/禁用条件、服务端创建校验及启动/恢复承接门禁、对应 CSS 和测试替身。审批与托管继续复用原边界解析，不再保存这些新增字段；旧客户端额外传入的承接字段会被丢弃。未删除历史运行记录或其他用户数据。
- `MetaInstantFormGuide.tsx` 删除承接准备项，完成页提示改为按需填写，并明确“后续联系由企业自行安排”；`AdGoalExamples.tsx` 同步去掉负责人、接收安排的要求。Meta 必需的主页、发布表单、消息资产、Pixel/Lead、素材、权限、预算及其他原有校验保留；三个获客目标和 2026 截图右栏保留。
- 新增回归覆盖：三目标前端不因缺少承接信息禁用创建；消息/表单/网站解析在无承接信息时正常工作，忽略旧客户端承接字段；三目标预检、执行、审批和托管配置均不提供承接字段而通过。
- 实际验证：定向 27 项通过，新增前端回归所在文件 10 项通过；最终 `node scripts/test-platform-ads.mjs` **60 个测试文件全部通过**。`pnpm run lint` 退出 0；`ARCHITECTURE_BASE_REF=dfc9b0c8 node scripts/check-architecture.mjs` 2751 文件及 ratchet 通过；`pnpm run build` 退出 0，Studio 367202/485000，存在原有大 chunk 提示；`git diff --check` 通过。没有运行全仓 quality/verify 或真实供应商 E2E。
- 浏览器核对实际创建窗口的 Meta 表单右栏，准备清单不再要求跟进负责人或回访渠道，截图 `tmp/ads-preview/remove-handoff-preview.jpg`。本地后端已重启加载撤回后的校验，认证接口无凭证返回预期 HTTP 401；仍使用原本地数据库和外部写入限制。未创建或启用真实广告，没有外部 run/task ID。
- HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`、分支 `feature/platform-ads-20261025` 不变，未提交、推送、部署或迁移。恢复点仍为当前 HEAD 与保留的本会话差异；没有 reset/checkout/clean/stash 或覆盖其他脏改动。后续客资联系由客户自行处理，不再列为产品阻塞。

## 自动关联获客资产（2026-10-25）

- 正常人工创建取消 Meta 表单 ID、Instagram ID/用户名、Pixel ID、主页 ID、视频 ID 和封面 URL 的手工填写要求。获客目标按授权账户/主页自动读取资产，唯一候选自动关联，多个候选按业务名称确认；审批/托管旧素材输入保留在高级配置，尚未完成自动化改造。
- 当前版本已确认的 ready 素材绑定自动校验源指纹并复用视频、封面。首次未绑定/未上传的素材仍使用原有素材流程，本轮没有新增上传或表单发布旁路。
- 已认证只读资产目录新增 `/connections/:id/meta-destination-assets`，按账户可推广主页和用户授权主页交集校验，返回 DTO，不返回令牌。读取失败与空列表分开；没有表单/授权失败时创建按钮不可用，不以手填 ID 兜底。
- 本地走查任务 `9lgnvdjv4yvm5zy` v2，源码 HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd` 加未提交功能改动。Lucy 账户只读检查返回所选主页不在可推广授权交集中；页面正确显示授权异常。此前 Business Suite 的使用中表单目录为空，不能据此替代 API 授权校验。
- `pnpm run test:platform-ads`：61 个测试文件通过。其后针对界面可用状态和目录晚到响应补测 `pnpm exec tsx src/components/AdWorkflowRecovery.test.tsx`：12 项通过。
- `ARCHITECTURE_BASE_REF=dfc9b0c8af85175485cf39370eed92c4be3daedd pnpm run check:architecture`：2754 文件通过、基线 ratchet 通过。
- 截图：`tmp/ads-preview/automatic-assets-preview.jpg`；测试日志：`automatic-assets-tests.log`、`automatic-assets-ui-tests.log`、`automatic-assets-lint.log`、`automatic-assets-architecture.log`、`automatic-assets-build.log`（同目录）。
- 未做真实 Meta 写入、发布表单、接受条款或启用广告。没有真实表单创建回执、客户提交 lead ID 或线索回收证据，完整 E2E 仍未通过。
- 未决：首次无表单时的业务内容准备与平台表单创建、首次素材自动准备、审批/托管素材参数简化仍未实现；不应宣称用户只确认目标预算即可完成所有真实投放。
- 最终 `pnpm run lint`（TypeScript）退出 0；`pnpm run build` 退出 0（既有大 chunk 警告）；`git diff --check` 通过。未运行全量 quality/verify；这些结果不构成真实 Meta E2E 或发布就绪证明。
