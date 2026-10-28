# 外观合并 V2：周计划与素材匹配集成

日期：2026-10-29（Asia/Shanghai）

## 范围与提交

- 目标：`/Users/julia1/Documents/ChatGPT/基线管理/image-text-baseline-20261028`，`xixi外观合并V2`，初始 HEAD `28a9bfaf707839170b8350676958a649fca868dd`。
- 来源：`origin/周任务完成，止步素材匹配`，fetch 核对为 `6d022a617d8b8d544196a759ecd70429e585f587`。
- 来源末次提交 66 文件；完整分支需接入 4 个独有提交：`029c6b87`、`836e9949`、`4bccb3f0`、`6d022a61`。双亲合并为 `4520e796`，相对原目标的最终任务差异为 158 文件（含兼容修复与回归，不含本治理记录）。
- 集成期间目标由其他会话前进到 `cbc8d51bd484d65772f820052a6fc719d497c014`（另含 `f4506055`）。初始 6 个未提交文件由该会话提交，未覆盖或恢复旧补丁；隔离树兼容合入上述新提交，源码检查点 `bcc7e69559473a5838efa087d4f24e94be087792`。
- 隔离工作树：`/Users/julia1/Documents/ChatGPT/基线管理/appearance-v2-weekly-20261029`，`integration/appearance-v2-weekly-20261029`。安全恢复分支：`backup/appearance-v2-before-weekly-20261029` → `28a9bfaf`。并发提交之后、应用本轮改动之前的恢复点为 `cbc8d51b`。

## 冲突解决

9 个冲突文件按现有 V2 结构兼容：

- 保留共享 `AssistantHomeScenes`，将来源首页的生产/待处理状态、状态读取与补录引导接入共享组件，首页和侧栏复用；异步回复检查会话身份，避免污染已切换的会话。
- 保留现有侧栏可展开周任务包、统一队列入口和相关组件。来源周计划确认、参考绑定、成本拆分、对话内补录与逐镜素材卡均接入；周操作继续在同一快捷入口行启动。
- 合并报告展示、表格/结构化报告保护和周计划缺素材的简短回复保护。周计划卡跟随对应对话位置，不在消息末尾重复挂载；保留 V2 流式等待展示和可访问状态。
- 保留移除发布授权开关的界面，保存时沿用原有 `publishingConfigured && form.allowRealPublishing` 契约，不新增发布许可。原目标的“默认向所有账号发布”测试在合并前已失败，更新为实际的所选账号范围/已有授权文案；周计划和队列测试随核验流程与共享组件位置更新。
- 修复面板原有重复 `useState` 导入；增加共享首页/侧栏状态与唯一快捷入口行的实际渲染回归。

## 实际验证

- `git diff --check`、`git diff --cached --check`：通过，无未解决冲突。
- 在隔离树软链现有依赖；终端初始缺少 Node，使用桌面附带 Node v24.22.1 的 bin 路径继续。
- `ARCHITECTURE_BASE_REF=28a9bfaf pnpm run check:architecture`：3149 个生产 TypeScript 文件通过，相对合并前提交的架构预算棘轮通过。
- `node --import tsx scripts/check-digital-employee-migrations.ts`：208 项通过，只读检查；来源无迁移或迁移清单变化。
- 将暂存差异中全部 50 个改动测试文件，加共享场景实际渲染、报告展示、周任务包预设 3 个测试文件，执行 `node --import ./scripts/production-budget-offline-guard.mjs --import tsx --test --test-concurrency=1 <53 个文件>`：235 项通过。包含周计划、真实队列身份/幂等、参考绑定、单图采集、产品抠图、素材匹配、预算和界面合同。
- 合入并发提交后，对 `companyBusinessClaimQuality`、`industrySourceQuality`、`socialInsightEvidenceFilter`、`companyReportBrandMediaCatalog`、`reportPresentation`、`AgentReply.readable`、`AssistantHomeScenes.weekly` 执行同一离线测试入口：37 项通过（与前组有部分重叠，不累加为独立用例总数）。
- 146 个改动 TypeScript 文件语法与重复导入检查通过；该检查不等于类型检查。
- `pnpm run build`：最终源码通过移动共享文件校验、Vite 构建、工作台 chunk 预算与导入边界检查。构建仍有大于 500 kB 的 chunk 提醒，Ant Design SSR 测试有已有 API 弃用提示。

## 边界

- 未运行全量 TypeScript 检查；未执行真实供应商、付费请求、OAuth、生产数据写入、迁移、部署或推送；未切换已有预览。
- 来源 Dockerfile 中的本地抠图 Python 环境与模型准备脚本按来源接入，但未构建容器、安装 Python 模型或验证真实抠图环境。
- 本次证明本地源码合并及上述专项验证通过，不代表整周任务已生产、素材均已匹配、已发布或真实供应商验收完成。
- 治理记录与源码提交分开，目标分支最终 HEAD 以交接时 Git 输出为准。
