# 小程序功能合入本地统一基线（2026-10-26）

## 来源、目标与结果

- 目标分支：`baseline/unified-20261026`；权威工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`；合并前 HEAD `353879221169176cb26d97391ad6f4dc7367a9f3`。
- 来源：`feature/miniapp-fixes-20261026` / `64ba79a49de8a09ff3647d475c5cab515ba20869`，工作树 `/Users/julia1/Documents/ChatGPT/1026小程序`；来源起点 `ee2654459435a83bfb1ae845a4cf2a118eabe469`。
- Git 确认用户提及的 `86d855e110821fb309b2493a7d69d5afb6fc2c47` 是合并前目标的祖先，其后包含 15 个提交，故保留较新首页/日历/场景/V4 等功能，不回退到旧检查点。
- 隔离候选：`integration/miniapp-baseline-20261026`，工作树 `/Users/julia1/.codex/worktrees/miniapp-baseline-integration/1026小程序`；已验证源码合并 `5f6e09f4fda1db8306cc07f3d3c4dd909c88ee03`，双亲为上述目标与来源。治理记录另行提交；随后只允许权威基线安全快进至此候选。
- 来源 50 个文件已在功能分支提交，包含三 Tab、独立助手/历史未读、素材与客户交互、按钮链路修复及测试/验收记录。保留较新产品规范的已有条目，只合入两条原生小程序规范。无合并冲突；候选修正新测试辅助文件末尾多余空行。

## 实际验证

全部在隔离候选源码 `5f6e09f4fda1db8306cc07f3d3c4dd909c88ee03` 运行，使用 bundled Node，详细 stdout/stderr 位于 `/Users/julia1/.codex/integration-evidence/20261026-miniapp-baseline/`。

| 检查 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 小程序及共享包 | `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`，miniapp.log | 164/164 |
| 后端及内容集成 | `node --import tsx --test`，范围为 mobileAssistantSessions、mobileWorkbenchAssistant、mobileWorkbenchActions、shootingTasks、shootingReferencePreview、quoteSkill、customerChannelSendRequests、socialContentAssistantDelivery.integration、socialContentWorkflow 的测试文件；backend.log | 40/40 |
| 预览原生契约与网络隔离 | `node scripts/run-customer-isolated-tests.mjs server/customerService/localPreviewReplyCompatibility.test.ts server/customerService/localPreviewAiIsolation.test.ts`，preview.log | 2/2 |
| 工作台 | `node --import tsx --test`，范围为 mobileWorkbenchOverview、mobileWorkbenchQueue、mobileWorkbenchMatters、mobileWorkbenchProductAdapter、mobileWorkbenchAgentSchedule 的测试文件；workbench.log | 12/12 |
| 类型 / lint | `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`，lint.log | 通过 |
| 架构 / ratchet | `ARCHITECTURE_BASE_REF=353879221169176cb26d97391ad6f4dc7367a9f3 node scripts/check-architecture.mjs`，architecture.log | 2954 个生产 TS 文件通过 |
| 迁移文件只读清单 | `node --import tsx scripts/check-digital-employee-migrations.ts`，migrations.log | 204 项，blockers=[] |
| 迁移 checksum guard | `node --import tsx server/digitalEmployees/migrationReleasePreflight.test.ts`，migration-guard.log | 通过；隔离 Git fixture，未升级数据库 |
| 共享生成检查 | `node scripts/sync-mobile-shared.mjs --check`，shared.log | 通过，无源码差异 |
| 主站构建 | `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build`；`node scripts/check-studio-chunk.mjs`，build.log/chunk.log | 通过；Studio 371869/485000 bytes |
| 账号中心构建 | `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config apps/account-hub/vite.config.ts`，account-build.log | 通过 |
| 差异检查 | `git diff --cached --check`、合并区间 `git diff --check` | 通过 |

候选仅软链复用已有依赖，无安装/更新依赖；64 个声明依赖的实际安装版本与权威基线一致。Vite 普通 chunk 大小提示未导致构建失败，Studio 专项预算通过。没有运行全仓 quality/verify；原基线记录的周任务 M1 外网禁止遗留失败未在本轮重新复测或消除，不用本轮定向结果宣称全仓通过。

## 数据、保全和验收边界

- 权威工作树原有 `server/videos/videoVisibilityMaintenance.ts` 未提交修改不纳入本次合并。快进前后检查原完整补丁和文件 SHA256，须一致；权威树因此不是干净状态。
- 来源源码提交后保持干净，来源分支及其本地服务保留；不同步、删除或覆盖任何现有预览运行库、账号、凭据、图片或媒体。前轮修复补齐的 40 张产品图仍只位于来源忽略目录，不作为源码提交迁入基线。
- 小程序 `config.js` 仍为本地回环联调配置，包含既有白名单 Origin；这不是发布配置。未关闭身份、来源或网络隔离限制。
- 本轮只进行源码集成、静态/隔离测试及构建；没有启动真实供应商/相机/渠道验收，没有付费、客户发送、OAuth、生产迁移或部署，无外部 run/task 标识。
- 来源本地预览的 503/degraded、无真实客户/待验收对象及真机/供应商未验收等边界继续保留；此合并不代表运行环境或发布 Ready。

## 恢复与后续

恢复参照分支：`backup/pre-miniapp-integration-20261026-35387922`。原目标 `353879221169176cb26d97391ad6f4dc7367a9f3`、来源 `64ba79a49de8a09ff3647d475c5cab515ba20869`、候选源码 `5f6e09f4fda1db8306cc07f3d3c4dd909c88ee03` 均保留。私有证据包含 source-before.patch、source-files.json、target-before.patch、target-before.json 和 target-after.json；恢复应逐项审阅提交，禁止 reset/clean 覆盖原有脏改动。治理提交不改变已验证生产源码。
