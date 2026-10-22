# 生产构建大 chunk 诊断（2026-10-22）

基线：`aa6c6b88d936efc28db81ce6cad08fbb059a253f`。使用 `vite build --sourcemap` 仅在忽略的本地 `dist/` 中生成诊断产物；未修改部署配置。常规生产构建通过，但三个 JavaScript chunk 仍超过 500 kB：`index` 约 824 kB、`AiCreateStudio` 约 881 kB、`DigitalEmployeePage` 约 920 kB。

| Chunk | source map 中的主要来源 | 判断 |
| --- | --- | --- |
| `index` | `App.tsx`、`Layout.tsx`、Motion/Framer Motion、Ant Design Table/Tree 等共享 UI 依赖 | 首屏入口混入跨页面 UI 依赖，应检查静态导入和实际首屏需求。 |
| `AiCreateStudio` | `AiCreateStudio.tsx` 源码约 1.15 MB，另有 `ShotProductionPanel.tsx` 约 79 kB 及预览、数字人规划模块 | 主工作台自身是最大来源；仅移动静态子组件文件不能有效降低该 chunk，需要按真实步骤/可选功能建立动态加载边界。 |
| `DigitalEmployeePage` | `DigitalEmployeePage.tsx` 约 263 kB、`SmartBusinessDashboard.tsx` 约 101 kB，另有日历、周包、交付和 Ant Design 日期组件 | 应按概览、生产、周任务等页面使用路径拆分静态子树，并核对共享命名导出是否阻止拆包。 |

试验过 Rolldown 的 Motion 与 Ant Design 依赖分组：`index` 降到约 225 kB，但产生三十多个细碎 UI chunk，`DigitalEmployeePage` 仍约 797 kB，`AiCreateStudio` 仍约 881 kB。试验配置已撤回，未以提高告警阈值或碎片化分组掩盖问题。后续以页面/步骤级动态加载为主，逐项对比产物、加载体验与回归测试；当前不得宣称大 chunk 告警已解决。

## 页面边界拆包进展（2026-10-22）

`DigitalEmployeePage` 将经营看板的默认页及命名视图、周复盘改为按需加载，并在使用位置提供局部 Suspense 提示。常规构建后主页面从约 920 kB 降至约 487 kB；新看板 chunk 约 389 kB、周复盘约 36 kB；`index` 约 806 kB、`AiCreateStudio` 约 881 kB，故仍有两个大 chunk 告警。未采用提高阈值或手动 vendor 分组。

随后将登录页与已登录布局从首屏入口改为互斥的按需加载，并以 `PageLoading` 包住各自的 Suspense 边界。`index` 从约 806 kB 降至约 231 kB；`AuthScreen` 约 12 kB、`Layout` 约 57 kB，数字员工主 chunk 约 489 kB。生产预览的未登录页实际显示且没有浏览器错误；未输入账号。现只剩 `AiCreateStudio` 约 881 kB 的构建告警。

进一步按 sourcemap 映射的产物跨度归因，`AiCreateStudio.tsx` 自身约占 571 kB，`ShotProductionPanel.tsx` 约 62 kB。即使单独延后现有子面板，主模块仍可能超过 500 kB；下一步须拆分 `AiCreateStudio` 内部的状态/步骤工作流，并对图片与视频生成的付费调用边界做专项回归，不能靠依赖分组或提高阈值消除告警。

## 镜头编辑与项目浮层按需加载（2026-10-22）

- 将只在打开镜头编辑器时使用的 `ShotProductionPanel` 改为局部 Suspense 按需加载；其产物独立为约 105 kB chunk。将“我的创作”浮层移到 `StudioProjectsOverlay.tsx`，并仅在浮层打开时加载；成片库维持其内部按需边界。
- 常规生产构建中 `AiCreateStudio` 主 chunk 从约 881 kB 降至约 774 kB，未提高警告阈值。源码映射仍显示 `AiCreateStudio.tsx` 本身约 570 kB，因此告警**尚未消除**；下一步必须拆分主工作台内部的步骤 UI 与状态逻辑，而非继续只延迟小面板。
- 项目删除合同检查继续覆盖移出的浮层；这一轮没有触发镜头生成、付费供应商调用或部署。

## 不可达步骤分支清理（2026-10-22）

- 核对 `AiCreateStudio.tsx` 中 `renderStep` 的唯一调用点：调用条件仅允许 `mode`、`poster`，其余步骤均由当前工作台单独渲染。移除 `renderStep` 中从未执行的 `material`、`script`、`bgm`、`cover`、`preview` 分支，并新增可达性合同测试；主文件由 17,807 行降至 14,633 行，架构预算同步收紧。
- 旧源码合同曾检查不可达分支中的素材筛选、预览和配音文案。合同现改为核对实际挂载的工作台；在当前分镜素材库补回“我的生成”与生成类型筛选，按统一只读生成投影分类，并为筛选逻辑增加直接测试。没有变更供应商调用或收费流程。
- 常规构建的 `AiCreateStudio` 主 chunk 现约 603 kB（本轮前约 772 kB）。这是实测下降，但仍超过 500 kB，告警**未解决**。下一步仍需拆分可达的主工作台内部逻辑/视图，并做浏览器操作回归；不得调高阈值冒充收口。
