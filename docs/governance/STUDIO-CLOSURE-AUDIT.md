# 原五个大文件结构治理收口审计

日期：2026-10-23。集成树 `/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`，分支 `xixi1021程永罗沟通前大整合`。审计起点为本地/远端一致的 `099e394e1244aa19fa395f38dd2a03d50fa44cce`，最终业务源码为 `2804dd7207cb23fa51f06cb25e4e6ae9158b3ba1`；本批测试定位修正为 `e46db16f5da4ffa85178338bac55e29990e0516c`，已单独推送。

> 后续状态（2026-10-23）：下文 209/211 与两条人物认证失败是这份结构治理审计时的历史快照。本机随后以 `641d0b9e` 为新起点，在独立源码提交 `a2b37ae6` 中修复分镜入口的已存照片/视频/授权传递，并覆盖 capability pending 与 ready 的离线状态；`test:production` 212/212、完整 `test:studio-release` 复跑通过。范围、首跑环境失败及未做的浏览器/供应商验收见 [工程基线](BASELINE.md)，不把此审计的旧结论改写成当时已通过。

## 结论和范围

[有限收口清单](STUDIO-CLOSURE-CHECKLIST.md) 的三批已完成，原五个文件的本轮结构治理收口。完成标准是完整职责归属、真实装配、兼容及所列验证，不是把所有文件压到 800 行以下，也不是清除所有历史耦合或宣称发布就绪。本批没有新增生产模块或扩展业务边界。

| 原文件 | 治理前→当前行数 | 当前保留及迁出职责 |
| --- | ---: | --- |
| `src/components/InspirationDashboard.tsx` | 2,014→654 | 页面装配；发现、分析、创建、素材库存及编辑删除分属实际 Hook/工作区 |
| `server/routes/digitalEmployees.ts` | 4,113→538 | 统一鉴权、单实例装配、路由顺序与兼容入口；运行协调、审批准备、周目标开工及各工作区归属领域模块 |
| `server/routes/videos.ts` | 7,823→281 | 鉴权、路由挂载与兼容入口；发现/采集、供应商、下载、分析和维护各保留完整生命周期 |
| `server/routes/studio.ts` | 7,221→187 | 鉴权/租户上下文、路由挂载与兼容入口；生成/渲染、素材、项目证据、数字人恢复及声音由领域模块装配 |
| `src/components/AiCreateStudio.tsx` | 12,000→7,031 | 保留共享项目/镜头状态、跨领域脚本协调、逐镜批/句级事务、共享候选投影、时间线和页面装配；合同/规则/视图、项目、声音、素材库存、渲染、图文、普通任务会话、成片验收和人工交付已有明确所有者 |

工作台大文件仍是受 ratchet 约束的历史例外。项目/声音 getter 桥仍是耦合成本，不因拆到别处就消失；没有继续提取大状态袋或为降行数新增包装层。保留部分及可选后续建议不再作为本轮未完项。

## 真实依赖、读取时机和状态所有权

- 对十二个源码批次的实际新增文件及当前 TypeScript AST 核对：共 **177 个生产模块**，按原文件批次分别为 **7/21/40/53/56**。其中 15 个只有类型合同、不形成运行时装配；其余 162 个均可从五个入口经实际相对导入/导出或字面量延迟导入到达。不是只添加文件而没有接入。全部 177 个当前文件在独立进程中加载成功，探针禁止 `fetch`、HTTP 和 HTTPS 请求。
- 各批新增模块到**所属主入口的反向静态初始化路径为零**。不能把这一结论扩大为“五个入口之间或全仓库没有依赖/循环”：数字员工生产与 Studio 素材分析仍通过既有兼容入口使用视频/Studio 能力；`socialContentLegacyPorts.ts` 仍转导出旧公开能力；`automatedReplicationBridge.ts` 等仍有延迟调用 Studio 的既有路径。本轮没有重建这些跨领域交易或新增平行请求链。静态初始化、延迟业务调用和类型边界分别核对，未把动态调用当作类型导入排除。
- 新模块及五个入口没有计算式 `import()` 需要猜测目标。工作台可选面板继续共享 `studioLazyPanels.ts` 的同一组 Lazy 实例；数字员工运行协调器保留原延迟助手调用。构建还检查视图 chunk 到主入口的直接、间接静态导入。
- 项目端口 **377/377**、声音端口 **122/122** 字段均在实际消费者的方法/Hook 中被读取，getter 仍返回页面同名绑定；消费者用相应 `Pick` 约束。工厂创建时不读取尚未声明的页面变量，动作调用时再采集所需字段；同步 Hook 读取与页面调用顺序核对，未发现构造时提前读取未来绑定。实际初始 SSR 及“工厂提前读取即失败”的代理测试也通过。
- getter 是对应 render 的词法连接，**不保证异步回调自动拿到最新 render**。项目身份用唯一 `currentProjectRef` 核对；排队自动保存读取执行时的 `autosaveSnapshotRef.current`。这些读取时机由真实保存/会话测试验证，不能只凭 getter 的名字推断安全。
- 项目/声音 Hook 在原位置注册同一组状态；素材、渲染、图文、任务和交付各复用自己的唯一记录、Ref 和动作。页面保留共享镜头/素材写回与原 CAS 保存入口，原公开函数委托已装配实例；没有第二套提交、轮询、取消或候选采用状态。具体迁移正文、初始化和调用位置的逐批证据见对应 ADR 及 [工程基线](BASELINE.md)。

## 关键行为及证据的实际边界

| 要求 | 当前证据 |
| --- | --- |
| 项目查询退出/切换后的迟到回包 | 项目入口、任务项目 reader 和交付 reader 的 live/dispose；保存、详情、采用与交付的项目范围测试 |
| 草稿采集、版本、冲突与自动保存 | 原 CAS 入口延迟采集；`studioProjectPersistence.test.tsx` 13 项，包括旧成功/冲突/失败反馈隔离、延迟计划同步及执行时最新排队快照 |
| 未知提交、显式重试和原回执 | `studioProductionSession.test.tsx` 19 项，保留请求 ID/去重、原任务刷新、取消、账单核对及候选采用；不把未知结果变成失败或自动重提 |
| 恢复与清理 | 会话真实恢复动作、焦点监听/项目 reader 清理、计时器注册/释放和请求 guard；本批媒体合同核对实际模块与页面挂载 |
| 验收、质检、人工交付 | `studioDeliveryWorkspace.test.tsx` 17 项及服务端合同；资格从工作区拥有的验收路径/有效质量记录推导，不靠传入的 ready 布尔值放行 |
| 原入口与顺序 | 三个服务端实际 router stack 的路径/方法/中间件及 exports 与各拆分基线一致：数字员工 **59/13**、视频 **47/58**、Studio **94/69**；不是仅数 AST 路由表达式 |
| 当前页面动作与初始化 | 普通任务 **21** 组、交付 **23** 组非切换实际旧/新动作轨迹一致；最新两批 Hook 展开后 **382** 项顺序、七组交付初始化及两条资格表达式一致；其余自定义 Hook 未展开 |
| 页面公开入口/初始展示 | **45** 个导出及普通/任务初始 SSR **24,562/25,765** 字符与该批基线一致；只证明这些初始状态和公开面，不证明登录后交互或供应商执行 |

前两批曾先复现并修复项目切换后的旧保存、采用、详情及交付反馈缺口，不能声称整个重构“所有行为都未变化”。本批重跑行为对照和工作台组通过；没有据 AST、SSR 或单测声明全链路零回归。

## 本次实际验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm run test:video-source-boundaries` | 通过，167 项，包括灵感工作区与视频来源边界 |
| `pnpm run test:production-workflows` | 通过，含生产质量、发布日历、下载/采集恢复、调度、页面工作流及发布队列 |
| `pnpm run test:digital-employees` | 通过 |
| `pnpm run test:tenant-isolation`、`test:security-boundaries` | 通过 |
| `pnpm run test:studio-workspace` | 131/131；另有构建导入检查 4/4；本批修正合同后再次通过 |
| `test:studio-workflow`、`test:shooting-workflow`、`test:storyboard-aigc` | 分别 13、11、66 项通过 |
| `pnpm run test:production` | **211 项，209 通过，2 条既有人物认证 UI 断言失败** |
| `pnpm run test:studio-release` | **失败**，在上述生产组退出；后续检查另行执行，不能据此把整个命令登记为通过 |
| `pnpm run test:studio-media` | 通过，语音/素材/字幕、下载、成片规则及桌面渲染等离线回归 |
| release 剩余安全组 | 单独执行：Qwen key/对齐、付费锁/预算、ASR、渲染媒体/安全、对象存储、人物媒体、旁白/时间线、字幕等 48 项通过；外部预检、修正后的 `studioMediaAccess.test.ts` 及桌面 screen-captions 1 项通过 |
| `pnpm run lint` | TypeScript 通过；修正合同后再次通过 |
| `ARCHITECTURE_BASE_REF=099e394e pnpm run check:architecture`、`test:architecture-ratchet` | 2,602 个生产 TS 通过；仅 1 个冻结历史超限文件，没有新增预算/豁免 |
| `pnpm run check:digital-employee-migrations` | 193 项仓库清单只读检查通过、零阻塞；没有访问或执行目标库迁移 |
| `pnpm run build` | 通过；主 chunk **368,957/485,000** 字节；视图 chunk 静态导入边界通过，不据此宣称性能改善 |
| `git diff --check` | 通过 |

补跑 release 剩余检查时首次在媒体安全合同的旧源码切片失败：它只截取 `refreshProductionJob` 至生成函数，已迁出的 `recoverJobs` 不在该区间。`e46db16f` 改为读取实际会话、核对页面实际 Hook、相同刷新动作、去重/失败释放及 timer cleanup。没有删除自动刷新要求，也未修改生产逻辑；通过后另行重跑全部剩余安全组。成功日志移到整份合同末尾，避免局部通过被误认为整个脚本通过。

## 两条失败的归属与未通过的业务验收

失败仍在 `src/components/ShotProductionPanel.test.tsx`：

1. `existing presenter can reuse its uploaded photo in the Ark enrollment flow`。
2. `new reenact presenter starts with one video, one photo and explicit Ark consent`。

两项用 SSR 渲染初始 reenact 面板，期望旧标题“人物替换认证（可选）”；当前 `studio/ArkPresenterEnrollmentPanel.tsx` 的 capability 未载入分支显示“方舟人物认证（可选增强）”及“正在检查方舟认证能力…”。SSR 不运行 capability 加载 Effect，尚未进入 ready 后的素材/同意控件分支。标题断言首先失败，不能据此证明后续上传、同意或认证流程已验收。

独立性证据：`ShotProductionPanel.tsx`、其测试、`studio/ArkPresenterEnrollmentPanel.tsx`、`shotProduction.ts`、`digitalHumanPlan.ts` 五个 Git blob 从治理基线 `630c4126` 到当前均未变化；React 版本相同。以未改基线完整 `src/shared` 和配置、同一依赖离线渲染两项实际输入，旧/新 HTML 逐字一致（11,920/11,616 字符），均落在相同 pending 分支。没有修改或放宽这两条断言。

因此登记为**独立的既有 SSR 合同与业务验收缺口**，不归为本次拆分新增回归；它们不阻止本轮结构治理收口，但继续阻止完整 production/release 门禁通过。后续应在独立修复中确认产品文案/状态要求，覆盖 capability 就绪、已有照片复用、新人物视频/照片及明确同意的真实交互，之后才可判定相应认证业务通过。不能仅改正则使门禁变绿。

## 最终交接与限制

- 本轮生产源码止于 `2804dd72`；收口只增加 `e46db16f` 的一份测试修正，再单独提交本审计及基线/清单/架构文档。最终文档提交及普通分支推送后，核验工作区无脏改动、本地 HEAD 与远端分支一致；不在文档中自引用待生成的提交 SHA。
- 安全恢复点为 `099e394e`（本批前完整源码/文档）及上述两个源码提交；交接不要求重置、清理或覆盖其他任务。视频生成任务的独立工作树与其未合并后端功能不属于本基线，未混入本轮。
- 没有部署、真实付费调用、OAuth/真实发布、目标库迁移或真实供应商 run/task；没有登录后的完整浏览器交互验收。未处置其他工作树，也未修改项目镜像 `sources/`。
- 后续可做独立业务缺口修复或经授权的浏览器/供应商验收；不以这些尚未获得的证据冒充当前已完成，也不继续寻找新拆分点延长本轮目标。
