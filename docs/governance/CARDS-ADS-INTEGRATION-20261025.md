# 灵小枢卡片与本地投流安全合并（2026-10-25）

## 来源与结果

- 本机权威基线：`/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，`xixi联合功能模块后端改`；原 HEAD `5f0b47a69cb029d3f7079cc18d8ba756d969972e`。
- 卡片来源：`origin/灵小枢交互卡片基础修改`，精确 SHA `f2ea282c1ec60aedfab46569d1323ad49bbf2e7d`，已从 GitHub 获取并核对；候选合并 `bc20ed431fd50c8f79a270918f2870c71e0bab98`。
- 投流来源：`/Users/julia1/Documents/ChatGPT/1025投流`，`feature/platform-ads-20261025`，原 HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。最新功能为未提交内容；使用独立临时 Git index 创建源码快照 `e130395e0ca45f3cc40f59b1bd2de9ddd8f90267`，恢复引用 `snapshot/platform-ads-20261025-for-baseline`。未提交、切换、暂存或清理原投流工作树；原 index 与工作区保留。
- 候选树：`/Users/julia1/.codex/worktrees/frontend-v2-safe-integration-20261025`，`integration/cards-ads-20261025`。合并源码提交 `9be85a78443ae5dc6043926b33bf8f02b2aa6ab1`；本文档及基线清单以独立治理提交记录。
- 卡片来源无冲突。投流合并 3 个冲突文件：`src/pageRegistry.ts`、对应测试及 UI 主规范。用户明确确认：主入口“智能投流”，二级“计划管理 / 素材投放表现”；测试同步，既有首页/客服/管理能力产品决定与新增投流规范一并保留。

## 本轮实际验证

| 检查 | 结果 |
| --- | --- |
| 新增获客目标、聊天目的地、人群、素材目录、错误状态与首页提示词/合同定向组 | 33/33 |
| `pnpm run test:platform-ads` | 73 个文件通过（隔离记录与供应商替身） |
| `pnpm run test:assistant-quality` | 87/87 |
| `pnpm run test:assistant` | 全脚本通过 |
| 页面注册与 GlobalAssistant 合同 | 2 个文件通过 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint` | 通过 |
| `ARCHITECTURE_BASE_REF=5f0b47a6 pnpm run check:architecture` | 2829 个生产 TS 文件通过，预算 ratchet 通过 |
| `pnpm run test:architecture-ratchet` | 通过 |
| `pnpm run check:digital-employee-migrations` / `test:migration-guard` | 203 项文件只读检查及 guard 通过；没有数据库迁移 |
| `pnpm run test:frontend-security` / `test:shared-contracts` | 通过 |
| `pnpm run build` / `build:account-hub` | 通过；Studio 371887/485000 字节 |
| `git diff --check 5f0b47a6 HEAD` | 通过 |
| 原树保全 | 投流完整源码 tree/status 与快照一致；基线原文件与原补丁逐字一致 |

首次定向命令因 shell PATH 没有 node 未启动测试；改用本机 bundled Node 后通过。首次架构命令使用 `BASE_REF`，未触发 ratchet；按实际脚本改用 `ARCHITECTURE_BASE_REF` 后通过。保留失败及初始日志，不将首次命令误记为通过。pnpm 包装器存在嵌套 bin ENOENT 告警，命令最终退出 0；生产构建保留既有大 chunk 提示，Studio 专项预算通过。

## 恢复与边界

- 基线恢复点：`backup/pre-cards-ads-20261025-5f0b47a6`。原 `server/index.ts` 资源 404 未提交修改逐字保留，不纳入本轮源码提交。
- 本机证据：`/Users/julia1/.codex/integration-evidence/20261025-cards-ads/`，含私有原补丁、原文件、投流状态及快照信息、各项原始日志。
- 仅本地源码集成；未推送、部署、执行目标库迁移、真实 OAuth/付费/投流/消息发送或供应商请求。之前正式服部署停留 GitHub 认证，未因本轮合并继续。
- 未运行全仓 `pnpm test` / `quality` / `verify`，未新增本轮浏览器人工验收或真实外部 E2E；来源分支历史验收不冒充本轮证据。源码基线、预览运行及真实平台 Ready 独立。
- 没有清理、同步、重启或归档其他功能/预览树。投流原功能树仍停在原 HEAD 并保留未提交开发现场。
