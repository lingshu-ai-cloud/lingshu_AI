# 创作工作台的合同、规则与完整视图区

日期：2026-10-23。状态：本批已实施；页面控制器的完整治理仍在进行。

## 范围与决定

起点 `a6d16f6a` 的 `AiCreateStudio.tsx` 为 12,000 行，既包含跨工作区状态/编排，也包含合同、目录、纯规则、媒体探针和完整视图。本批先建立这些稳定边界，页面降为 **9,289 行**；现有预算随实际源码收紧，没有新增豁免或放宽默认门禁。它仍是原五项中的最后一个未完成文件，不能以本批降行或构建预算通过宣称目标完成。

| 边界 | 主要模块 | 所有权与依赖 |
| --- | --- | --- |
| 前端合同与草稿形态 | `studioWorkspaceContracts.ts`、`studioDraftSnapshot.ts` | 前端工作台的明确类型；草稿形态来自原 `collectSpec` 返回合同，不新增持久字段或改变序列化。不是服务端共享权威或新的写入通道 |
| 目录与导航 | `studioWorkspaceCatalog.ts`、`studioWorkspaceConfig.ts`、`studioFontCatalog.ts`、`studioProjectNavigation.ts` | 原选项、字体、阶段和入口规则；字体解析只持有一份，原页面公开导出兼容 |
| 素材与分镜规则 | `studioManagedPresenter.ts`、`studioMediaProbes.ts`、`studioMaterialPresentation.ts`、`studioStoryboardParsing.ts`、`studioMaterialScriptEvidence.ts` | 原人物模式投影、浏览器媒体探针、素材/分镜解析及观察证据，不新增模型调用 |
| 脚本与语音规则 | `studioScriptAdmission.ts`、`studioScriptQualityPresentation.ts`、`studioProductSelection.ts`、`studioCloneReference.ts`、`studioScriptSanitization.ts`、`studioReferenceVoiceProfile.ts`、`studioVoiceTranslation.ts`、`studioAsyncSupport.ts` | 原事实准入、质量/失败展示、产品选择、参考结构与口播翻译/超时；浏览器提示和探针仍是明确的本地适配，不称为全无副作用 |
| 完整视图 | `StudioStepView.tsx`、`StudioLanguageSwitcherView.tsx`、`StudioProductionPanelView.tsx`、`StudioPropertyPanelView.tsx`、`StudioShotLibraryView.tsx`、`StudioProductionEditorView.tsx` | 分别持有原步骤、语言、配乐/交付面板、属性栏、镜头库/批审和制作编辑区；每个视图有自己的明确输入合同，复用原状态与动作，不另建库存、项目或生产状态 |
| 可选面板 | `studioLazyPanels.ts` | 原九个 React.lazy 定义集中持有，所有消费者复用同一实例；原 Suspense 边界与延迟加载时机保留 |

以上模块均位于 `src/components/studio/`。视图是无 Hook 的渲染函数，调用位置保留原 JSX 的计算时机，不新增 DOM 包装或 React 状态层。步骤渲染仍在原箭头函数里延迟读取当前模型；生产编辑区保留外层存在性门禁，并将该已收窄合同传入。其余状态、Ref、Effect、保存与生产动作本批仍在页面控制器中。

## 调用方与装配证据

`StudioMediaPreviews.tsx` 以前为使用 `fontCss` 而反向导入整个页面。现在直接使用字体模块，页面保留同一函数的公开转导出。另四处类型消费者直接引用既有 `Clip`、`StoryboardSlot`、`VideoKickoff` 合同；主应用、流量工作区的页面懒加载路径保持兼容。32 个新生产模块逐个独立进程加载成功，运行时导入图没有回到主页面的反向路径。

将六个新视图中的实际函数体还原到真实调用处后，原 **56 个完整函数正文**（包括整个页面控制器）及 **48 个常量/箭头函数初始化逻辑**经 TypeScript 转译、规范化对照保持一致。测试源码装配器只读取当前文件，并核对每个视图调用的全部简写绑定与声明输入精确一致，防止错接变量被源码组合掩盖；步骤调用还必须保留延迟箭头。

分别实际加载未修改起点与新源码，**45 个运行时导出相同**。在禁止网络请求的隔离浏览器全局夹具下，普通入口和任务入口的初始服务端渲染 HTML 分别为 24,562 与 25,765 字符，逐字相同。这不是登录后浏览器、效果执行或供应商验收。

## 构建边界

仅搬移视图会增加显式输入接线，第一次构建使主 chunk 超过原 485,000 字节预算。没有提高预算：将六个完整视图区作为静态缓存分组，并把两侧共用的规则、目录、Lazy 定义、表单组件及实际共享图标保留在支撑分组。

构建依赖审计还发现，打包器会把部分共享绑定放回页面 chunk，造成“视图→支撑→页面”的循环，即使源码依赖和文件行数检查已通过。调整共享分组后，实际生成的视图 chunk 不再直接或间接静态导入页面。`check-studio-chunk.mjs` 现在同时保留原字节上限、检查唯一视图 chunk 并执行该依赖门禁；新增 4 项测试覆盖直接导入、转导出、间接图标/支撑依赖、无关循环及动态/外部导入的正确处理。

最终页面 chunk 为 **306,364/485,000 字节**，视图 chunk 为 **134,024 字节**，另有缓存支撑 chunk。它们仍是静态依赖；不以主 chunk 变小宣称首屏总传输量或整体性能债务解决。`strictExecutionOrder` 和可选面板的真实懒加载保持原约束。

## 验证与下一批

新增 6 项视图行为测试：原文不可删除、翻译删除只调用原动作、语言切换同步两处已有状态、字幕/实测音频/处理中/时间未解不放行、就绪时只委托一次生成并保留一个折叠效果区、不相关工作区不挂载、字体兼容及回退。新构建依赖 4 项和完整页面/视图 25 项已纳入 `test:studio-workspace`，并接入 `test:studio-release`。

源码位置合同读取真实组成文件或 AST 分支。旧 Agent 演示入口合同在未修改基线上同样仍检查已迁出的 `DigitalEmployeePage` 内联导航；改查当前经营日历入口，并额外保留真实 `productionTaskId` 绑定断言。懒加载合同检查集中定义的实际路径；预览合同直接检查属性栏的真实分支，不依靠旧源码片段边界。

实际通过 TypeScript、架构（2,578 个生产 TS、仍 1 个历史预算）、ratchet、193 项仓库迁移清单只读完整性、页面/视图 25 项、构建依赖 4 项、完整 Studio 媒体/脚本/工作流、分镜 AIGC 66 项、社媒前端、视频来源 167 项、生产工作流、数字员工、租户隔离及支持会话/爬虫安全、生产构建与空白检查。

下一批继续按完整生命周期拆分页面中的项目恢复/版本保存、素材与生产状态、语音翻译和渲染编排，再完成主控制器装配审计；不能用本批合同或视图迁移代替这些工作。未执行真实付费调用、目标库迁移、发布或部署，其他工作树和项目 `sources/` 未动。
