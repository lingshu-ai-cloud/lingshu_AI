# 图文联调安全合入本地统一基线（2026-10-28）

## 已确认来源与合并

用户明确确认以本地统一基线 `0ca19acf4641826612a94471c7da70765d19d229` 为合并起点。

- 原基线分支：`baseline/unified-20261026`；原目录：`/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。
- 功能分支：`xixi改图文联调`；精确来源：`ac12a04187a5d0e9a8afcdf7645ae11dec2fd9f0`。合并前通过 `git ls-remote origin refs/heads/xixi改图文联调` 核对远端 SHA，本地来源工作树干净。
- 新本地基线分支：`baseline/unified-20261028`；干净源码目录：`/Users/julia1/Documents/ChatGPT/基线管理/image-text-baseline-20261028`。
- 双亲合并提交：`0bc495bdd75925437b86231188de3727a50b66ee`。父提交依次为已确认基线和精确功能来源。无文本冲突，无额外生产代码修补；基线独有的快捷卡片等两个提交完整保留。
- 相对旧基线为图文功能的 20 个文件，371 行新增、121 行删除；无依赖、锁文件、架构预算、迁移或迁移清单变化。

## 本次功能与边界

图文审核界面简化，增加已保存版本预览和自然语言修改指令。单图人工质量验收绑定候选版本、实际文件 SHA-256 和确认人，保留原机器检查结论；文件解码、尺寸及哈希仍须通过。人工采用不自动发布或触发付费生成。

## 原现场保全与恢复

原基线含 55 项未提交内容（35 项已跟踪、20 项未跟踪），没有纳入新版本。原分支、HEAD、已跟踪二进制补丁、状态清单和未跟踪文件 SHA-256 均保持一致；原功能分支不变。新目录只软链已有 node_modules，没有复制账号凭据、运行数据库或私有素材。旧基线分支保留在确认的 SHA，作为源码恢复点；需要恢复时新建检出，不重置原脏目录。

此版本通过新分支和新干净目录交付，不移动有未提交开发内容的旧基线分支。后续新开发以本文指定的新本地基线为起点。治理补记提交位于双亲合并提交之后，仅修改文档。

## 验证

以下检查在双亲源码合并提交 `0bc495bdd75925437b86231188de3727a50b66ee` 上执行；详细命令/退出码见证据目录的 `results.json`、`continuation-results.json` 和对应日志。

- `pnpm run test:social-image-pipeline`：主回归 102/102、HTTP 集成 1/1 及图文多输出、工作台与治理合同通过。
- 新增界面定向：`node --import tsx --test` 加 ImageReplicationRunSummary、SocialImageVersionPreview、socialImageGenerationPresentation、socialImageNaturalLanguageRepair 四个测试文件，5/5 通过。
- 快捷卡片保留回归：`node --import tsx --test --test-concurrency=1` 加 12 个测试文件，40/40 通过；文件清单见本次执行命令及 `quick-cards-regression.log`。
- `pnpm run lint`：TypeScript 通过。
- `ARCHITECTURE_BASE_REF=0ca19acf4641826612a94471c7da70765d19d229 pnpm run check:architecture`：3056 个生产 TypeScript 文件及预算棘轮通过，未放宽预算。
- `MIGRATION_BASE_REF=0ca19acf4641826612a94471c7da70765d19d229 pnpm run check:digital-employee-migrations`：207 项、零阻塞，只读检查。
- `pnpm run build`：通过。Studio 368657/485000 字节；仍有 Vite 大 chunk 提醒。
- `git diff --check 0ca19acf HEAD`、双来源祖先检查通过。

宽范围 `pnpm run quality` **没有整体通过**：

1. 首轮通过依赖归档、容器合同、生产运维、架构/棘轮、固定产出、迁移守卫、生产治理与编排；隔离 PocketBase 安装/升级/备份恢复、HTTP 隔离、worker 并发/恢复检查通过。
2. 首轮在 external-video-approval 因未设置 `PB_BIN` 停止。使用已有 `/Users/julia1/.local/share/lingshu/pocketbase/pocketbase` 从该子步骤续跑通过；四平台发布合同、共享契约、生产运行时合同与实际本地媒体生产检查、周任务旅程合同通过。
3. 随后 `test:weekly-golden-journey` 为 41/42；`server/runtime/weeklyM1ContinuousProduction.integration.test.ts:159` 在受控测试内拦截 `api.heygen.com` 后出现 `0 !== 1`。在旧基线干净副本 `/Users/julia1/Documents/ChatGPT/基线管理/quick-cards-safe-20261027`（HEAD `0ca19acf…`）单独运行相同 M1 测试，复现相同错误与断言。该测试及相关生产视频代码不在本次 20 文件差异内，属于继承问题；没有放松测试或开启外网绕过。
4. 两次 M1 测试在输出失败后残留打开句柄，仅结束本轮这两个失败测试子进程；没有结束业务服务。见 `M1-cleanup-note.txt`。合并后的其余周任务测试继续完成。
5. quality 在此失败后未执行剩余阶段，未运行 `pnpm run verify`；不能声称全仓/发布验收通过。另行执行 `pnpm run test:security-boundaries` 与 `pnpm run test:frontend-security`，两者均通过。

证据目录：`/Users/julia1/.codex/integration-evidence/20261028-image-text-baseline`，含运行命令、退出码、首轮失败与续跑日志、原现场补丁及保全核验。

未推送、部署、发布、执行生产迁移或付费供应商 E2E；源码验收不代表历史任务状态或已有预览实例已更新。
