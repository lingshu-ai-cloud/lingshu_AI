# 1026 灵小枢功能本地集成记录

日期：2026-10-26（Asia/Shanghai）。本轮仅本地源码集成。

## 目标与恢复点

- 用户明确指定的目标分支：`xixi投流+卡片前端`，原 SHA `8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d`。旧文档中的 `xixi联合功能模块后端改` 为历史基线，本轮不推进该分支。
- 来源：`/Users/julia1/Documents/ChatGPT/1026灵小枢对话卡片`，`feature/assistant-home-dialogue-20261026`，原 HEAD 同上。
- 原工作区 137 项未提交条目通过独立 index 固定为 `580913fe436286a1699684922a11c67d93eb0250`；不操作原 index，不清理原文件，不复制业务库或媒体缓存。
- 修复后验证源码：`99c20b5b9b1a7efe4ec6f52f92721dbc6bab46f8`；此记录的后续治理提交不改变生产代码。
- 基线工作树：`/Users/julia1/.codex/worktrees/home-cards-integration-20261026/1026灵小枢对话卡片`。
- 恢复分支：`backup/pre-home-cards-20261026-8c7cc7d3`；原始快照分支：`codex/home-cards-source-20261026`。安全恢复时从恢复分支另建工作树核验，不重置有未提交内容的目录。

## 合入内容与集成修复

- 首页场景卡片、对话和任务门户；保留输入卡片外框，仅消除内输入框边界，内部内容下移。
- 内容创作表单、任务列表/日历/详情、经营总览、导航及真实任务状态投影。
- 助手任务创建与原队列启动、复刻系统审查、产品/数字人绑定、参考分析与帧处理。
- 移除旧独立社媒预览入口。源码文件清单可用 `git diff --name-status 8c7cc7d3 99c20b5b9b1a7efe4ec6f52f92721dbc6bab46f8` 复核（144 个文件）。
- 集成检查发现新增排队回执在调度后递增版本并进入生产输入 hash，破坏原周任务冻结证明。回执现在仅补写输出元数据、保留调度版本；输入 hash 仅排除该回执字段，真实产品输入改变仍拒绝。启动及 outbox 恢复均覆盖。
- 更新与新表单、左下账号菜单、单任务详情和系统审查契约对应的旧断言；修复空白格式。未削弱身份/来源/生产输入校验。

## 实际验证

- `git diff --check 8c7cc7d3`：通过。
- 42 个文件的定向 `node --import tsx --test --test-concurrency=1 …`：最终 122/122，通过；命令完整保存在证据目录 `targeted-command.json`。
- 调度证明、原 outbox 恢复、账号菜单专项：5/5；证明字段类型修正后另跑对应单测通过。
- `pnpm run lint`：最终通过（4GB Node 堆）。新增测试夹具的首轮类型错误已修复。
- `ARCHITECTURE_BASE_REF=8c7cc7d3 pnpm run check:architecture`：2862 个生产 TypeScript 文件通过，预算 ratchet 通过，无新豁免。
- `pnpm run check:digital-employee-migrations`：203 项仓库文件只读校验通过；`pnpm run test:migration-guard` 通过。没有迁移文件/依赖清单变更，没有操作目标数据库。
- `pnpm run quality` 首跑在周任务用例停止。旧基线隔离副本同一用例通过，证明是本次引入的回归；修复后 `pnpm run test:weekly-golden-journey` 完整通过（42/42 + 本地媒体生产 1/1）。
- quality 后续 16 个阶段逐项续跑；starter 阶段的旧 UI 断言修正后重跑到最后一项，再单独通过 `pnpm run test:social-content-frontend`；lint 失败后修正并重跑通过。其余阶段均通过。**这是 quality 全部阶段分段验证通过，不声称单次 quality/verify 命令一次成功。**
- 其中投流 73 个测试文件通过，主站与账号中心构建通过；Studio chunk 371881/485000 字节。构建存在 chunk 大小提示，不阻止构建。
- 本地媒体流程使用受控测试供应商/临时数据；未使用真实供应商、未实际发布。测试生成缓存移入证据目录，未提交源码。
- 未另跑全仓 `pnpm test` / `pnpm run verify`，未新增浏览器视觉验收。现有功能预览数据、账号接入及真实生产 Ready 不由本轮源码验证证明。

## 保全与限制

- 快照后及推进前比对原工作区全部 6595 个受版本管理/非忽略文件哈希、Git status 与 index 哈希；原 HEAD/index/未提交修改完整保留。
- 不操作旧基线树中的 `server/index.ts` 脏改动，也不操作图片 AIGC 保留工作树。
- 证据：`/Users/julia1/.codex/integration-evidence/20261026-home-cards-3a88bjt_`，包含首轮失败、旧基线对照、最终通过日志和原始补丁。没有外部 run/task 标识；本轮仅测试夹具标识。
- 未推送、未创建 PR、未部署、未修改目标库。真实供应商回执/素材等运行时问题仍须在独立任务中验收。
