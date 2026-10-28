# 图文复刻创建中断：数据库字段遗漏（2026-10-28）

## 结论与范围

正式服和本地源码均为 `874237dafd53b1232ff2965aef9eb64e84b55add`。本次修复针对“内容任务已创建，但页面提示服务暂时不可用，未建立图文子任务”的提交失败。

`refreshSocialTaskReferenceOutputs` 写入 `reference_video_analysis`、`replication_script`、`shot_material_map`，但既有 207 项迁移未定义这些字段；初始创建使用的 `content_order` 也缺少迁移。正式服只读 `PRAGMA table_info` 证实这四个字段均不存在。

PocketBase 0.39.5 会在 PATCH 返回 200 的同时忽略未知字段。`pbStore.update` 随后的严格回读校验因此失败，仓储抛出 `starter_198_storage_unavailable`，路由返回 503，前端将其展示为“服务暂时不可用，请稍后重试”。不能放松回读校验，否则会把证据丢失误报成成功。

## 正式服只读证据

- 内容任务：`socialtask_01b841f596f3acbf837b519d`；内部行 `e4cc8bu7ztvjscf`。
- 创建操作：`socialop_0db560a621a54384ffa08e8a`；状态 `processing`，没有成功回执。
- PocketBase 日志：2026-10-28 04:04:06.948 UTC 创建操作记录成功；04:04:08.432 UTC 对该任务行 PATCH 返回 200。
- 任务行已变为版本 `2`，`last_operation_id` 为上述操作加 `:reference-analysis`，但参考字段缺失。该写入留有 `datastore_cas_claims` 记录，过期时间为 04:06:38.426 UTC；严格校验失败时保留锁是现有保护行为。
- 没有查到对应图文 Studio 项目或内容执行作业。未核验供应商账单，不能据此断言没有扣费。
- 同期其他 CAS 创建 400 的细节为 `target_key: Value must be unique`；它们与其他缺失集合 404 不是本次根因的必要证据，不把时间重合当作因果。

## 修复

新增 `1793145600_persist_social_content_reference_outputs.js`，向原任务集合追加上述四个可选 JSON 字段，并注册不可变迁移校验和。没有改动既有迁移、应用权限、供应商调用或回读校验。

迁移不补造历史参考分析、不改写任务状态、不删除遗留锁、不重新执行付费任务。旧写入的完整载荷不在 claim 中，不能仅凭过期时间或操作标记批量解锁。正常图文草稿恢复可以复用原内容任务及创建幂等键，不依赖删除该遗留锁；它不证明原内容任务今后的其他写入也能穿过旧锁。

## 本地复现与验证

新增真实 PocketBase 测试 `server/starter198/socialContentPersistence.pocketbase.test.ts`，使用一次性本地数据库，完全隔离生产数据：

1. 用旧 207 项迁移创建数据库，执行与参考输出相同的写入；断言确实出现 `starter_198_storage_unavailable`、版本和操作标记部分落库、创建回执停在处理中、写入锁保留。
2. 停止该本地实例，对同一数据库应用新迁移并重启；断言历史 brief 和操作标记保留，缺失分析仍为空，不伪造证据。
3. 验证新写入成功、四个字段持久化、创建回执完成、重复请求不重复建单，成功写入只释放自己的锁。
4. 通过真实 `createSocialContentTask`、图文绑定与草稿更新函数验证选定产品、参考图保存、重复请求恢复；模拟线上处理中回执和遗留锁，确认原任务可建立图文草稿且不会悄悄清锁。
5. 禁止本地测试向 PocketBase 以外的地址发送 fetch；没有启动队列或 worker，断言没有生成内容执行作业。

实际命令（Node 和 pnpm 需要在 PATH 中）：

```sh
PB_INTEGRATION_BINARY=/Users/julia1/.lingshu-ai/deployment-validation/pb-0.39.5/pocketbase pnpm run test:image-replication-persistence
pnpm run test:image-replication
pnpm run test:social-image-pipeline
node --import tsx server/starter198/socialContentWorkflow.test.ts
pnpm run lint
pnpm run check:architecture
pnpm run check:digital-employee-migrations
git diff --check
```

真实数据库复现/升级/草稿恢复测试通过；图文入口 26/26、图文主回归 102/102 加 HTTP 和合同检查、内容工作流 HTTP 测试、TypeScript、208 项迁移完整性检查、3067 文件架构检查及最终 `git diff --check` 通过。未设置 `PB_INTEGRATION_BINARY` 时真实数据库测试会明确跳过；跳过不构成通过证据。

## 上线边界与恢复点

修复当前仅在本地工作区，HEAD 仍为 `874237da`，没有执行生产迁移、部署或真实付费 E2E。现有来源预算及 worker 全量验收缺口保持原结论。

得到本次修复的正式服部署授权后，先核对当前服务器 SHA、Git 状态、运行中部署和数据库快照，再按 AGENTS.md 的既有交互式 SSH / GitHub HTTPS / `deploy/update.sh` 路径部署。新增字段随正常迁移应用，不直接改生产 SQLite。

部署后只读核验四个字段、迁移记录、容器状态、web/worker SHA 和 `/api/overseas/ready`。恢复原请求必须沿用原创建幂等键；页面“恢复本次复刻任务”还可能继续入队付费生成，不能把免费草稿恢复验证与付费生成授权混在一起。不要用迁移 down 删除字段作为日常回滚，已新增的数据需要保留。
