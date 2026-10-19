# 同事交接分支测试问题台账（2026-10-19）

分支：`codex/colleague-handoff-20261019`

本文件只记录真实复现的失败。不得通过跳过测试、删除断言、扩大架构预算或放宽安全边界关闭条目。

## OPEN-001 独立周规划只生成一条外部分析

- 命令：`pnpm exec tsx --test server/socialPrograms/weeklyIndependentPlanning.test.ts`
- 用例：`actual established program keeps owned gaps while external slots get explicit immutable partial dispatch`
- 期望：`analyzed.directorAnalyses.length === 3`
- 实际：`1`
- 阶段：Director 分析，尚未进入执行图物化。
- 初步归因：规划权威层对三个 external slot 的分析结果发生折叠或只选择了一个 slot；与 `weeklyExecutionGraph` 拆分无直接调用关系。
- 状态：待修复。

## OPEN-002 社媒工作流候选集合出现空场景

- 命令：`pnpm exec tsx --test server/starter198/socialContentAgentWorkflow.test.ts`
- 断言：所有执行场景都应有 `1..20` 个候选。
- 实际：至少一个场景的 `candidates.length === 0`。
- 初步归因：素材候选准入/产品兼容过滤与旧工作流 fixture 的契约不一致；需要先确定 fixture 是否缺少新 V2 权利或产品身份证据。
- 状态：待修复。

## OPEN-003 完整本地产品素材被错误降级

- 命令：`pnpm exec tsx --test server/starter198/socialContentTypeAwareAdmission.test.ts`
- 用例：`normal unaltered product_value baseline admits complete local semantic evidence`
- 期望：准入成功。
- 实际：多个产品场景被标记为 `goal_degraded`，审核 `approved === false`，理由为“用户明确锁定的产品暂无对应参考素材”。
- 现有证据：候选本身带有 `productRef: SKU-1`、本地视频区间和产品角色，但 `productId` 为空。
- 初步归因：locked 产品匹配可能只接受稳定 `productId`，没有正确接受同一冻结 `productRef`；也可能是 fixture 应补充稳定产品 ID。必须依据当前产品身份契约判断，不能直接放宽匹配。
- 状态：待修复。

## OPEN-004 工作流错误码优先级变化

- 命令：`pnpm exec tsx --test server/starter198/socialContentWorkflow.test.ts`
- 位置：约第 485 行。
- 期望错误码：`social_content_execution_goal_degraded`
- 实际错误码：`social_content_execution_director_review_required`
- 初步归因：Director review 阻断现在早于 goal-degraded 语义错误返回；需核对当前 API 契约应该暴露哪个更具体的错误。
- 状态：待修复。

## OPEN-005 Outbox 恢复用例被相同准入回归阻断

- 命令：`pnpm exec tsx --test --test-name-pattern="real outbox recovery" server/starter198/socialContentTypeAwareAdmission.test.ts`
- 用例：`real outbox recovery reuses original queue/run after crash and never resubmits unknown supplier work`
- 期望：先通过生产准入，再验证原 queue/run 被复用。
- 实际：尚未进入恢复断言，即被 OPEN-003 的 `goal_degraded` 审核失败阻断。
- 初步归因：当前是 OPEN-003 的下游失败，不应单独修改 Outbox 恢复逻辑。
- 状态：被 OPEN-003 阻塞。

## RESOLVED-006 工作流测试归档替身缺少参数类型

- 命令：`pnpm exec tsc --noEmit`
- 位置：`server/starter198/socialContentWorkflow.test.ts`，生成媒体归档测试替身。
- 实际：`TS7006: Parameter 'input' implicitly has an 'any' type`。
- 归因：既有本地测试改动新增了归档替身，但没有从生产运行时端口继承参数类型；不是生成素材归档模块拆分造成的生产类型回归。
- 修复：使用 `SocialContentAutoProductionRuntime['archiveGeneratedMedia']` 的首个参数类型，未使用宽泛 `any` 放过输入契约。
- 状态：已修复，待完整质量门禁复核。

## OPEN-007 CTA 证据门禁被供应适配器错误抢先阻断

- 命令：`pnpm exec tsx --test server/starter198/socialContentAssetSupplyExecution.test.ts`
- 位置：约第 244 行的拒绝断言。
- 期望错误：`weekly_production_cta_evidence_required`。
- 实际错误：`asset_supply_provider_exhausted:scene-person:motion_graphics:adapter_not_registered`。
- 初步归因：测试场景在到达 CTA 周生产证据门禁前，先进入了未注册的 `motion_graphics` 供应路由；需判断是执行检查顺序回归，还是 fixture 未随供应路由契约更新。
- 关联性：生成素材归档候选与持久化测试均已通过；当前失败发生在供应适配器选择阶段，与本次归档模块搬移无直接调用关系。
- 状态：待修复。

## RESOLVED-008 仪表盘源码契约测试未跟随模块拆分

- 命令：`pnpm exec tsx --test src/components/SmartBusinessDashboard.preproduction.contract.test.ts src/components/SmartBusinessWeeklyCommandCenter.contract.test.ts`
- 实际：5 个源码契约断言只读取 `SmartBusinessDashboard.tsx`，预生产预览和精确灵感引用移动到 `smartBusiness/TaskPreviewCards.tsx` 后误报缺失。
- 归因：测试定位方式过期，业务判断、嵌套引用协议与保守素材阻断仍完整保留在新模块。
- 修复：测试同时读取职责模块；保留原断言语义，仅兼容项目既有的单双引号格式。
- 状态：已修复，待复跑确认。

## RESOLVED-009 展示模型 VM 缺少 showcase 运行时依赖

- 命令：`pnpm exec tsx --test src/components/SmartBusinessDisplayModel.test.ts`
- 实际：`ReferenceError: isSmartBusinessShowcaseEnabled is not defined`。
- 归因：测试直接截取并在 VM 执行展示模型函数，但没有注入函数当前已依赖的 showcase 开关和周汇总常量。
- 修复：VM 明确注入“showcase 关闭”的生产等价上下文，不改变展示模型断言。
- 状态：已修复，待复跑确认。

## RESOLVED-010 媒体探测模块边界误收窄可选 URL

- 命令：`pnpm exec tsc --noEmit`
- 实际：`Clip` 不能传给新模块的画幅探测函数，因为真实 `Clip.url` 可选，而抽取后的结构类型误声明为必填。
- 归因：本次辅助模块拆分的类型边界回归；原实现已对空 URL 返回零尺寸。
- 修复：将探测端口的 `url` 保持为可选，继续由既有空源分支安全返回，不使用非空断言。
- 状态：已修复，待复跑确认。

## RESOLVED-011 Studio 标题续接源码断言落后于实现

- 命令：`pnpm exec tsx --test src/components/AiCreateStudio.workflowContract.test.ts`
- 实际：测试要求出现一行式 `setProjectTitle(loadedStudioProjectTitle(...))`，实现已先计算 `restoredTitle`，再将其同时写入 autosave 指纹和界面标题。
- 归因：源码形态断言过期；现有两步数据流仍正确保留用户最新续接标题，且比旧写法多覆盖 autosave 一致性。
- 修复：断言 `loadedStudioProjectTitle` 的结果最终传入 `setProjectTitle`，不再绑定无业务意义的一行式代码形态。
- 状态：已修复，待复跑确认。

## RESOLVED-012 客户页暴露 fixture 身份标签

- 命令：`pnpm exec tsx --test src/components/AiCreateStudio.workflowContract.test.ts`
- 实际：`ConversionPage` 仍按 `customer.isMock` 向产品界面展示“模拟客户/真实客户”。
- 归因：内部 fixture 状态泄漏到用户界面；客户名称虽已去除“模拟”字样，但旁边标签重新暴露了该实现细节。
- 修复：移除列表和会话头部的 fixture 身份标签；非 fixture 客户的通道连接/未连接状态仍由独立标签如实展示。
- 状态：已修复，待复跑确认。

## 已验证通过的相关范围

## RESOLVED-019 数字员工路由契约未跟随生产预算恢复路由拆分

- 命令：`pnpm exec tsx --test server/digitalEmployees/route.contract.test.ts`
- 实际：生产预算恢复路由迁入独立模块后，契约仍只在主路由源文件中定位完整 handler，误报 endpoint 缺失。
- 归因：路由仍由主路由显式注册，运行锁、分镜成本证据、冻结重试策略和审计逻辑全部保留；过期的是源码文件定位。
- 修复：契约读取职责模块并继续执行原有全部安全断言，不放宽路由行为要求。
- 状态：已修复，待复跑确认。

## RESOLVED-018 视频 scoped-download 测试缺少项目本地 yt-dlp

- 命令：`pnpm exec tsx --test server/routes/videos*.test.ts`
- 用例：`scoped public download disables paid actors and cookie fallback even when ambient settings enable them`
- 实际：下载器解析先报 `video_downloader_not_installed`，因此测试替身记录的执行次数为 0，未到达所验证的安全回退行为。
- 归因：本机尚未运行仓库指定的 `scripts/prepare-video-downloader.mjs`；不是规范化模块拆分导致的生产逻辑回归。
- 处理：按仓库脚本准备项目本地 Python 下载器后原样复跑，不跳过断言。
- 状态：本地隔离下载器已按仓库脚本准备，待复跑确认；未发起媒体请求、供应商调用或服务重载。

## RESOLVED-017 视频爬取规范化模块遗漏共享缩略图辅助导入

- 命令：`pnpm exec tsc --noEmit`
- 实际：规范化工具搬移后，原路由仍在多个采集与回填路径调用 `hasRealThumbnail` 和 `PLATFORM_LABEL`，首轮类型检查报未定义。
- 归因：本次拆分遗漏显式导入；缩略图真实性判定和平台标签实现未改变。
- 修复：从 `videoCrawlerNormalization.ts` 显式导入这两个共享符号，未用本地重复实现绕过。
- 状态：已修复，待复跑确认。

## RESOLVED-016 队列准入校验搬移后主模块缺少显式导入

- 命令：`pnpm exec tsc --noEmit`
- 实际：`durableQueue.ts` 在 staging 路径继续调用 `hasCompleteFootageRevisionProductionAdmission`，辅助模块拆分后首轮类型检查报 `TS2304`。
- 归因：本次模块边界调整遗漏导入；并非准入逻辑或安全边界变化。
- 修复：从 `durableQueueRecords.ts` 显式导入并继续从原公共入口重导出该校验函数。
- 状态：已修复，待复跑确认。

## RESOLVED-015 灵小枢源码契约未跟随运行时辅助模块拆分

- 命令：`pnpm exec tsx src/components/GlobalAssistant.contract.test.ts`
- 实际：主线程常量、内部页面路由、冲突合并规则、气泡顺序样式、请求错误本地化和实时接入事实读取迁入 `assistant/globalAssistantRuntime.ts` 后，契约仍只扫描 `GlobalAssistant.tsx`，先后误报上述规则缺失。
- 归因：持久化、路由和事实核验行为未改变，测试对旧单文件位置形成了无业务意义的耦合。
- 修复：契约显式读取运行时职责模块，并继续验证主线程固定、错误提示优先级和实时事实边界。
- 状态：已修复，待复跑确认。

## RESOLVED-014 应用外壳契约未跟随企业页签头结构

- 命令：`pnpm exec tsx src/components/AppShell.contract.test.ts`
- 实际：契约强制要求 `EnterprisePage.tsx` 使用 `LsPageHeader`，但当前页签式企业工作区已在页签头中使用 `<h1 className="sr-only">企业知识库</h1>`，因此误报共享页头缺失。
- 归因：实现仍提供唯一、可访问的一级标题；过期的是对具体组件形态的要求，而不是可访问性行为。
- 修复：企业页断言改为验证页签工作区的隐藏 H1；定时任务页仍继续强制使用共享页头。
- 状态：已修复，待复跑确认。

## RESOLVED-013 数字员工总契约仍只扫描旧仪表盘文件

- 命令：`pnpm exec tsx src/components/DigitalEmployeePage.contract.test.ts`
- 实际：内容任务卡预览文案和灵感引用构造已归属 `smartBusiness/TaskPreviewCards.tsx`，角色/工作流策略已归属 `digitalEmployeePresentationPolicy.ts`；总契约仍只读取旧入口文件，先后误报预览、可追踪灵感引用和角色卡缺失。
- 归因：与 RESOLVED-008 相同的源码定位契约过期；任务卡的真实引用、素材组合、效果置信度和阻断提示仍在职责模块中。
- 修复：总契约组合读取仪表盘入口与任务预览模块；数字员工展示策略断言也显式读取新策略模块，不删除或放宽业务断言。
- 状态：已修复，待复跑确认。

- 周执行图核心：24 个用例通过。
- 内容订单准入、投影、产品选择：17 个用例通过。
- TypeScript：`pnpm exec tsc --noEmit` 通过（截至提交 `79f26bf6`）。
- 架构棘轮：通过；完整架构检查仍有历史大文件超限，另行持续拆分。
