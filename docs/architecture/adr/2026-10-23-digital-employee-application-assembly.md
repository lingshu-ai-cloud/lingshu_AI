# 数字员工主文件的应用服务与路由完整拆分

日期：2026-10-23。状态：已实施。源码提交：`3076f875a3126812a3424078fa9a0f549bf97423`。

## 问题与决定

前几批已迁出纠偏、复盘、资源准备和证据观察，但主文件仍有 4,113 行，同时持有运行状态机、任务审批、周计划启动、事实重建、经营包、初始化、浏览器与多个 HTTP 工作区。继续只迁移小函数不能完成原五文件治理目标。

本批按完整职责迁移剩余实现。`server/routes/digitalEmployees.ts` 现在为 538 行，负责统一鉴权、支持会话只读门禁、单实例装配、原顺序挂载与旧公开入口委托；不再实现运行状态机、计划开工或领域 HTTP 回调。移除其历史超限预算；规模是边界划分结果，不以 800 行作为模块设计依据。

## 责任与依赖

| 责任 | 持有模块 | 约束 |
| --- | --- | --- |
| 记录读取与配置 | `workflowRepository.ts`、`runtimeConfiguration.ts`、`records.ts` | 租户限定读取、分页、必需写入、审计及运行冻结配置；记录合同从路由层迁入领域，旧 `digitalEmployeeRecords.ts` 转发兼容 |
| 运行协调 | `runCoordinator.ts` | 唯一运行推进、即时续接队列、旧账号绑定迁移、依赖失效、任务执行与等待/完成聚合；继续使用原运行锁和准备/观察端口 |
| 审批准备 | `taskApprovalPreparation.ts` | 依赖就绪、审批前检、不可变审批包、经营包授权应用及仅执行失效的授权恢复；真正审批决定仍由原 `approvalDecision.ts` 执行 |
| 周目标开工 | `goalActivationApplication.ts` | 结构与素材准入、冻结事实、计划 CAS、冲突检查、任务初始化及部分写入恢复；HTTP 创建/批准在 `digitalEmployeeGoalRoutes.ts` |
| 事实替换 | `goalFactRebuildReadModel.ts`、`digitalEmployeeFactRebuildRoutes.ts` | 完成态筛选、恢复令牌与幂等审计；HTTP 重建继续使用原持久 fence、租约及原子替换服务，不自动开工 |
| 经营包 | `weeklyPackagePreparation.ts`、`digitalEmployeePackageRoutes.ts` | 租户证据推荐与参考绑定；详情生成、保存、预算方案和发布排期均使用原队列、版本与 CAS 门禁 |
| 初始化 | `initialPreparationRuntime.ts`、`digitalEmployeeOnboardingRoutes.ts` | 准备恢复、唯一后台计时器与初始化接口；坚持持久来源范围、原租约、原批准开工入口 |
| 事件与浏览器 | `workflowEvents.ts`、`digitalEmployeeBrowserRoutes.ts` | 每运行串行持久事件、再广播、跟进 Worker 事件接入；浏览器工作区、可信遥测、抓图与 SSE 复用原会话与重放服务 |
| 领域工作区 | `digitalEmployeeAssistantDecisionRoutes.ts`、`digitalEmployeeContentProjectRoutes.ts`、`digitalEmployeeCustomerWorkflowRoutes.ts`、`digitalEmployeeRunControlRoutes.ts`、`digitalEmployeeOverviewRoutes.ts` | 分别承载决策中心、内容修订/项目关联、分层与跟进、接管/暂停/恢复/取消、只读总览；租户身份继续只取认证上下文 |

`applicationPorts.ts` 只提供内部装配类型，使用 type-only 导入，不初始化实现模块。每个领域只接收所需的 `Pick`，保留原外部适配器与存储实例。主文件通过延迟读取端口连接已有的相互调用，领域内的薄转发保留原函数正文与泛型合同；装配阶段不执行数据库用例或供应商任务。

共享启动队列仍在主装配处创建，并传给开工、经营包、事实替换、初始化和既有复盘服务。运行推进队列、初始化计时器、事件追加队列与客户编辑队列各由对应单一应用实例持有。原运行锁仍由原模块提供，未产生第二套锁或工作队列。跟进 Worker 事件在原位置显式注册；浏览器遥测与所有 HTTP 注册也保留原相对顺序。

## 调用方兼容

原后台协调器、后台初始化、助手周动作、移动工作台/外部回复重试和跟进模板继续引用旧主文件。13 个实际导出入口保持一致；`browserTaskWorkspace`、`approveGoalForReview`、初始化 Worker、复盘/续接/待办分配、重试和跟进模板配置均委托同一已装配实例。旧摘要与记录导出保持兼容，新增领域模块直接依赖领域记录与复盘投影。

本批没有新增供应商路径、审批范围、重试策略或数据字段。租户、任务版本、冻结事实、部分写入恢复、真实发布/发送回执和未知结果禁重提保持原语义。后续视频与 Studio 拆分仍须保护数字员工生产/分析的旧公开端口，不能据此移除它们。

## 验证

- 分别实际加载改动前的 `7f90b99d` 源码与新模块，比较得到完全相同的 **59 项路由/中间件栈及 13 个导出入口**，包括原挂载顺序。没有启动后台 Worker 或真实供应商。
- 使用 TypeScript AST 规范化打印比较，**52 个原函数正文、46 个直接路由/中间件表达式**全部一致；只改变职责位置、装配和外层缩进。
- 新增 **9 项行为测试**并纳入 `test:digital-employees`：先查租户归属；暂停/取消/失败运行不启动工作；未拥有目标、未提交事实替换和社媒血缘目标不进入开工；并发事件先持久后按序广播；追加失败释放队列。新测试的泛型返回与可选 CAS 夹具类型经完整 TypeScript 检查修正。
- 跨领域旧源码合同读取实际组成模块；路由和应用函数断言改用 AST 选择，避免源码切片意外包含相邻用例。四专家断言检查实际公共投影，账号断言检查当前端点的租户与企业名称参数，没有放宽原业务门禁。
- 实际通过：`pnpm run lint`、`ARCHITECTURE_BASE_REF=7f90b99d pnpm run check:architecture`（2,453 个生产 TypeScript 文件）、`pnpm run test:architecture-ratchet`、`pnpm run check:digital-employee-migrations`（193 项仓库只读完整性）、完整 `test:digital-employees`、`test:review-todos`、`test:social-managed`、`test:production-workflows`、`test:execution-gaps`、`test:tenant-isolation`、支持会话只读测试、生产构建，以及源码暂存后的空白检查。

构建无大 chunk 警告；Studio chunk 为 480,957/485,000 字节，预算仍紧。测试仅支持离线代码/合同结论，不代表登录后浏览器、真实供应商或部署验收。没有真实付费调用、目标库迁移、发布或部署。

## 剩余治理

原五个大文件已完成灵感页和数字员工主文件两项。仍待完整拆分：`videos.ts`（7,823 行）、`studio.ts`（7,221 行）、`AiCreateStudio.tsx`（12,000 行）。继续先处理视频执行边界，再处理 Studio 共享执行能力和创作工作台，不把三项历史预算通过视为整体完成。
