# 腾讯云 PostgreSQL + COS + Redis/BullMQ 迁移运行手册

## 已确定的目标拓扑

- 新加坡腾讯云 PostgreSQL：业务记录主库。
- 新加坡腾讯云 COS：视频、图片、音频及派生文件；私有桶，不开放目录读取。
- 新加坡腾讯云 Redis + BullMQ：内容生成等异步任务的投递、重试和消费。
- PocketBase：迁移窗口内只保留旧账号登录令牌验证；业务数据完成校验后不再写入 PocketBase。待所有活跃用户完成令牌换签，再迁移认证并下线。
- 两台轻量应用服务器不直接承载 PostgreSQL 或 Redis。通过云联网打通轻量网络与数据库 VPC，或把正式 API/Worker 迁入同 VPC 的 CVM。

## 不可违反的安全规则

1. 迁移只向 PostgreSQL 和 COS新增或幂等覆盖同一内容哈希对象，不删除 PocketBase 数据。
2. 不清空 COS，不下发生命周期删除规则，不修改现有 COS 对象。
3. 迁移默认是 `plan`；写入必须同时提供命令参数 `--apply` 和进程级 `MIGRATION_APPLY=true`。
4. 每个 PocketBase 记录保存 SHA-256 来源摘要；每个集合按 `id + 摘要` 生成总摘要。数量或摘要不一致则迁移任务标记失败，不能切流量。
5. 文件复制使用 `pocketbase-migration/<collection>/<record>/<field>/...` 前缀。内容哈希进入对象名，重复运行会复用相同对象。
6. PocketBase 备份、PostgreSQL 自动备份和迁移报告至少保留到切换后 30 天。

## 腾讯云准备

在新加坡创建：

- PostgreSQL 主实例和只读/容灾能力，开启自动备份与时间点恢复。
- Redis 标准架构实例，开启 TLS（可用时）、访问控制和持久化。
- 与当前 COS 桶相同地域的私有网络路径。
- 最小权限 COS 子账号：迁移期只需要 `GetObject`、`HeadObject`、`PutObject`、分块上传和列举指定迁移前缀；不授予 `DeleteObject`。

服务器侧连接信息只写入权限为 `0600` 的生产环境文件，不写进 Git：

```dotenv
DATA_BACKEND=postgres
DATABASE_URL=postgresql://USER:PASSWORD@PRIVATE_HOST:5432/lingshu
DATABASE_SSL_MODE=require
DATABASE_POOL_MAX=10

QUEUE_BACKEND=bullmq
REDIS_URL=rediss://:PASSWORD@PRIVATE_HOST:6379/0
BULLMQ_PREFIX=lingshu-production

OBJECT_STORAGE_DRIVER=cos
COS_REGION=ap-singapore
COS_BUCKET=REPLACE_ME
COS_SECRET_ID=REPLACE_ME
COS_SECRET_KEY=REPLACE_ME
```

配置写入服务器后，先执行统一预检；它只做连接、读取和结构检查，不迁移数据，也不删除对象：

```bash
pnpm run backend:preflight
```

结果中的 `postgres`、`redis`、`cos`、`pocketBaseSource` 必须全部为 `ready: true`，才能进入迁移窗口。

## 执行顺序

以下命令必须在服务器现有仓库的交互式终端执行。正式执行前先停写或进入维护窗口，避免来源集合在摘要计算期间变化。

### 1. 备份与连通性

```bash
pnpm run backup:production-data
pnpm run storage:inventory
```

`storage:inventory` 只读，不删除 COS 内容。随后验证 PostgreSQL、Redis 和 COS 私网连通性。

### 2. 创建 PostgreSQL 结构

```bash
pnpm run postgres:schema
```

结构创建使用 PostgreSQL advisory lock，可重复执行。

### 3. 生成迁移计划

```bash
pnpm run migrate:pocketbase-postgres
```

计划模式只读取 PocketBase，输出每个集合的记录数、文件引用数和来源摘要，不写 PostgreSQL/COS。

2026-10-02 已对当前 PocketBase 执行一次真实只读盘点：共发现 184 条业务记录、86 个文件引用。数据主要集中在 `materials`（33 条、66 个文件引用）、`starter_social_content_files`（20 条、20 个文件引用）、`starter_social_content_operations`（59 条），以及内容任务、导演方案、周目标/计划和工作流数据。该盘点未连接或写入目标 PostgreSQL，也未复制、覆盖或删除 COS 对象。正式迁移时必须重新运行计划，以停写窗口当时的结果为准。

### 4. 迁移记录与文件

先选择一个小集合演练：

```bash
MIGRATION_APPLY=true MIGRATION_RUN_ID=pilot-001 \
  pnpm run migrate:pocketbase-postgres -- --apply --collections=tenants
```

演练通过后复制全部记录和 PocketBase 文件到 COS：

```bash
MIGRATION_APPLY=true MIGRATION_COPY_FILES=true MIGRATION_RUN_ID=full-001 \
  pnpm run migrate:pocketbase-postgres -- --apply --copy-files
```

该命令不会删除 PocketBase 文件或任何 COS 对象。中断后使用相同 `MIGRATION_RUN_ID` 重跑即可。

### 5. 独立校验

```bash
MIGRATION_RUN_ID=full-001 pnpm run migrate:pocketbase-postgres -- --verify
```

所有集合必须同时满足：来源数量等于目标数量、来源摘要等于目标摘要、文件对象 `HEAD` 校验成功。失败集合保留在 `lingshu_migration_collections.error`。

### 6. 切换

1. 先启动一个 Worker，设置 `QUEUE_BACKEND=bullmq`，观察失败队列和内容生产任务。
2. 再启动一个应用实例，设置 `DATA_BACKEND=postgres`，执行登录、租户隔离、素材播放、内容生成、任务恢复验收。
3. 验收通过后切 Web 流量；PocketBase 保持只读和私网可达，用于旧登录令牌验证。
4. 至少观察一个完整业务周期后，再单独规划账号密码/令牌换签。不要在业务数据切换当晚删除 PocketBase。

## 回滚

- 切换窗口内把 `DATA_BACKEND` 改回 `pocketbase`、`QUEUE_BACKEND` 改回 `local`，重启应用即可回到旧数据路径。
- 不回写或删除 PostgreSQL/COS 迁移结果；保留现场用于差异分析。
- 若切换后已经在 PostgreSQL 产生新业务写入，不得直接回切。先导出增量记录并完成双向差异处理。
