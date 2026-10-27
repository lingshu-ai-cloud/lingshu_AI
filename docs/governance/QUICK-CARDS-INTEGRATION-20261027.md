# 首页快捷卡片合入记录（2026-10-27）

用户要求将当前功能版本合入统一基线，并推送远端分支 `xixi快捷卡片`，未要求部署。

## 来源与安全合入

- 权威工作树：`/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`，分支 `baseline/unified-20261026`。
- 原基线：`8cecbd02dfa7e655f229a4bddb14ffa4d00d2a93`。原治理记录中的 `0a9ba67c` 是该提交的直接父提交，治理提交连续。
- 当前功能开发现场与基线共用工作树。通过独立 index 仅固定本任务 54 个文件，源码提交 `0e9872a05fa3f4f5959f65269f3429e844db4095`，保留来源分支 `codex/quick-cards-source-20261027`。
- 隔离候选：`/Users/julia1/Documents/ChatGPT/基线管理/quick-cards-safe-20261027`，分支 `integration/quick-cards-20261027`。仅软链已有依赖，未复制运行数据库、账号凭据或私有素材。
- 候选验证通过后，核对来源 HEAD、原 index、本任务文件与提交字节一致，并逐项校验任务外 43 个脏文件 SHA-256。祖先检查后以 compare-and-swap 快进基线并安装匹配提交的独立 index，不覆盖工作文件；43 个任务外文件全部保持原字节。未使用 reset、checkout、clean 或 stash。
- 安全恢复点：`backup/pre-quick-cards-20261027-8cecbd02`。治理补记单独提交，随后继续快进基线。

## 本次行为

- 快捷问答展开对应场景卡片；移除指定卡片。重点客户以表格每批展示五位，进入客户会话时回填可编辑回复，收到真实发送回执后再移出当天名单。
- 分析展示执行过程与证据摘要，报告支持导出；移除用户指定的冗余说明、人工确认横幅和回填提示。行动按钮靠右并使用蓝色。
- 确认页面导航后展示智能投流门户卡片；创建计划在当前对话依次确认必要字段，明确点击创建后复用已有创建端点，成功返回计划记录与门户卡片。原高级投放流程继续复用既有队列和授权检查。
- 经营总览可视区域按用户红框裁切。产品规范和 QA 说明随源码保存。

## 实际验证

所有检查均在干净候选源码 `0e9872a0` 上执行：

- `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit`：通过。
- `node --import tsx --test --test-concurrency=1` 加 18 个相关测试文件：67/67 通过，覆盖每日跟进、草稿、会话恢复、门户、快捷场景与计划创建。
- `node scripts/test-platform-ads.mjs`：76 个投流测试文件通过。
- `node scripts/sync-mobile-shared.mjs --check`、`node node_modules/vite/bin/vite.js build`、`node scripts/check-studio-chunk.mjs`：通过；Vite 保留既有大 chunk 提醒，Studio 预算通过。
- `ARCHITECTURE_BASE_REF=8cecbd02dfa7e655f229a4bddb14ffa4d00d2a93 node scripts/check-architecture.mjs`：3052 个生产 TypeScript 文件通过，相对原基线预算棘轮通过。
- `node --import tsx scripts/check-digital-employee-migrations.ts`：207 项迁移清单只读检查通过；无新增迁移。
- 独立 index `git diff --cached --check`：通过。治理补记再次执行 diff 检查。

本地详细证据保存在 `/Users/julia1/.codex/integration-evidence/20261027-quick-cards`，包含精确文件清单、原 index、补丁、任务外 SHA-256 与各检查日志。

## 推送与限制

- 目标远端：`https://github.com/lingshu-ai-cloud/lingshu_AI.git`，目标分支 `xixi快捷卡片`；推送前查询该远端分支不存在，使用普通非强制推送，完成后复核远端 SHA。
- 已检查仓库工作流：部署工作流仅手动触发，构建推送触发仅 `v*` 标签，本次分支推送不触发现有自动部署。
- 本轮未运行全仓 quality/verify、付费供应商或真实广告投放 E2E，未进行生产写入、数据库迁移、部署或发布；局部回归和构建不代表生产就绪。预览运行数据不随 Git 推送。
