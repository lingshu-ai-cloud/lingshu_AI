# 生产构建大 chunk 诊断（2026-10-22）

基线：`aa6c6b88d936efc28db81ce6cad08fbb059a253f`。使用 `vite build --sourcemap` 仅在忽略的本地 `dist/` 中生成诊断产物；未修改部署配置。常规生产构建通过，但三个 JavaScript chunk 仍超过 500 kB：`index` 约 824 kB、`AiCreateStudio` 约 881 kB、`DigitalEmployeePage` 约 920 kB。

| Chunk | source map 中的主要来源 | 判断 |
| --- | --- | --- |
| `index` | `App.tsx`、`Layout.tsx`、Motion/Framer Motion、Ant Design Table/Tree 等共享 UI 依赖 | 首屏入口混入跨页面 UI 依赖，应检查静态导入和实际首屏需求。 |
| `AiCreateStudio` | `AiCreateStudio.tsx` 源码约 1.15 MB，另有 `ShotProductionPanel.tsx` 约 79 kB 及预览、数字人规划模块 | 主工作台自身是最大来源；仅移动静态子组件文件不能有效降低该 chunk，需要按真实步骤/可选功能建立动态加载边界。 |
| `DigitalEmployeePage` | `DigitalEmployeePage.tsx` 约 263 kB、`SmartBusinessDashboard.tsx` 约 101 kB，另有日历、周包、交付和 Ant Design 日期组件 | 应按概览、生产、周任务等页面使用路径拆分静态子树，并核对共享命名导出是否阻止拆包。 |

试验过 Rolldown 的 Motion 与 Ant Design 依赖分组：`index` 降到约 225 kB，但产生三十多个细碎 UI chunk，`DigitalEmployeePage` 仍约 797 kB，`AiCreateStudio` 仍约 881 kB。试验配置已撤回，未以提高告警阈值或碎片化分组掩盖问题。后续以页面/步骤级动态加载为主，逐项对比产物、加载体验与回归测试；当前不得宣称大 chunk 告警已解决。
