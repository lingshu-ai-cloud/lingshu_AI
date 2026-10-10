# 1791072008 迁移 checksum 权威历史调查

调查日期：2026-10-10。HEAD：`55a489f2da3b46cee0e7eb2313ac2bc0d6f53a74`。未修改 migration 本体、现有 manifest 或门禁主功能；未执行 PocketBase、迁移、数据库连接、部署或外发。

## 结论

该文件不存在可达 Git 历史上的字节漂移。最初 checksum mismatch 是引入迁移的同一提交内，manifest entry 与 migration blob 已经不一致；不是工作区改写迁移引起。仓库已有修复提交 `fd03ac17a395adcb792eb7f8c854f0e9302faf5e`，其只改 checksum entry 并增加强 Git 历史证明门禁，未改迁移文件。

本次没有重新审定或 bless 任何值；仅证明已有审定修复与不可变 Git blob 对应。因此根代理不需要新增主功能修复。

| 对象 | 权威历史/指纹 |
| --- | --- |
| 文件 | `pb_migrations/1791072008_create_content_execution_queue.js` |
| 唯一可达文件引入提交 | `1f36cf356d5c2f95a2f3494f81a3d35b263bd48d` |
| 引入提交父级 | `0537f0ea47df2c04edbe40b83820c1cce8c2f6e5`：无此文件且 manifest 无此 entry |
| 原始 manifest entry | `17082ecdb5a6228182507d1d2a01f55c6aac48922cd376c489fecce8c8fb2f07` |
| 引入文件 SHA256 | `2aed450a4c83a5f6133817f47eef9c1f08ecde5e65f22427aa7480c2c96f67f8` |
| 修复提交 | `fd03ac17a395adcb792eb7f8c854f0e9302faf5e`：manifest 改为上述文件 SHA256，文件 diff 为空 |
| 引入/HEAD/索引 Git blob ID | 均为 `d0f205632854ffb2ffd10ae4c135d8b0a52f19d1` |
| HEAD 与工作区文件 SHA256 | 均为 `2aed450a4c83a5f6133817f47eef9c1f08ecde5e65f22427aa7480c2c96f67f8` |
| HEAD 与工作区 manifest 对应 entry | 均为上述文件 SHA256 |

`git log --all -- <migration>` 仅返回引入提交。此结论只覆盖本地可达 Git 历史，不能证明远端不可达对象或实际已部署数据库状态。当前 manifest 脏 diff 是新增 `1791586800_create_assistant_decision_memories.js` entry，未改变本次调查的 entry；本次保留该脏文件。

## 已存在的门禁修复是否会一般性绕过审定值

现有 `REVIEWED_MANIFEST_DEFECT_CORRECTIONS` 只接受该文件、原 entry、修正 entry 和固定引入提交的组合。必须证明引入提交为 baseline 祖先、该提交实际文件 SHA 等于固定值、同提交 manifest 为固定错误值、其父提交同时无文件和 entry；缺历史/blob 或非此组合拒绝。这不是任意修改迁移并更新清单的通用豁免。

既有 migrationReleasePreflight 测试覆盖一般性 paired rewrite 拒绝和固定 manifest-defect 历史证明。本次新增测试固定原历史证据，并验证文件工作区字节不得变化。

## 修复路径与旧 schema 兼容

- 若其它 checkout 的 migration 本体被改写：恢复已有审定的不可变 blob `1f36cf...:pb_migrations/1791072008_create_content_execution_queue.js`；不要改 checksum 去适配新的文件。当前 checkout 已是该 blob，无需恢复。
- 若 checkout 保留原错误 entry：应取得已有修复提交及其完整历史证明；不要自行重算、更新、扩大白名单。原错误 SHA 的 migration bytes 在本地可达历史不存在，不能据它虚构“已审旧文件”。
- 若业务需要变更 schema：保留 1791072008 文件及审定 entry，用独立新的 forward-only migration。仓库已有 `1791072050_allow_initial_content_queue_zero_state.js`，将 attempt/reconciliation_attempt/provider_receipts、max_running、visual_control 的 required 改为 false，允许合法初始零值/空证据；它不改原迁移。该文件 rollback 明确拒绝恢复 required，避免已有合法零值/空值受到重新验证影响。
- 1791072008 定义 jobs/limits/presenter ledger 的字段与唯一/容量索引。manifest 修复本身不改变这些 schema bytes，也不会再次应用已记录 migration。旧数据库是否已执行、是否存在预先创建的 presenter collection、迁移版本及数据是否兼容，仓库哈希无法确定。正式运行前必须针对目标真实 PocketBase 版本，用准确目标 schema 的备份分别演练升级与新安装；本次没有进行此演练，也没有授权迁移。

## 只读命令及结果

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node --test scripts/production-gate-migration-history.test.mjs
MIGRATION_BASE_REF=HEAD node node_modules/tsx/dist/cli.mjs scripts/check-digital-employee-migrations.ts
MIGRATION_BASE_REF=1f36cf356d5c2f95a2f3494f81a3d35b263bd48d node node_modules/tsx/dist/cli.mjs scripts/check-digital-employee-migrations.ts
node node_modules/tsx/dist/cli.mjs server/digitalEmployees/migrationReleasePreflight.test.ts
```

全部 exit 0。两个门禁报告均 `status=passed`, `checkedMigrations=149`, `blockers=[]`。这证明当前完整工作区的文件完整性，不等于 149 项都已提交审阅或已部署。测试仅使用隔离 Git fixture，未执行 migration 函数或接触 PocketBase。

逐项 Git/hash 证据：`work/production-gate-migration-history-evidence.json`。新增 `scripts/production-gate-migration-history.test.mjs` 不执行迁移，只读 Git blobs 与工作区文件，写此证据 JSON。

复核命令：

```sh
git log --all --format='%H %s' -- pb_migrations/1791072008_create_content_execution_queue.js
git show --stat fd03ac17a395adcb792eb7f8c854f0e9302faf5e
git diff fd03ac17^ fd03ac17 -- pb_migrations/1791072008_create_content_execution_queue.js
git diff -- scripts/pb-migration-checksums.json
```
