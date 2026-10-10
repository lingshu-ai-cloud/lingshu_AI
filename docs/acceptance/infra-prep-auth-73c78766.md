# 基础设施准备：生产鉴权与 readiness 源码审计

基准：`73c78766c985871cd925453aeb5f3e937ec8b3f7`。范围仅为本地只读源码与隔离配置测试；没有读取生产 `.env`、连接服务、验证真实凭据、执行迁移、部署或回滚。本说明不证明任何线上实例配置正确或已就绪。

## 精确变量与来源

| 变量 | 源码行为 / 已签入默认 | 来源 |
| --- | --- | --- |
| `NODE_ENV` | 必须为精确字符串 `production` 才触发生产本地 fallback 硬禁用；Compose 的 app/worker 明确设置此值。 | `server/lib/localFallbackPolicy.ts:9`、`docker-compose.yml:10`、`:44` |
| `DISABLE_LOCAL_AUTH_FALLBACK` | 非生产时仅精确 `false` 会启用旧兼容 fallback；生产时任何值均无效。生成器写 `true`。 | `server/lib/localFallbackPolicy.ts:12`、`deploy/make-production-env.sh:96` |
| `ENABLE_LOCAL_DEV_FALLBACK` | 非生产时精确 `true` 启用；生产时任何值均无效。生成器写 `false`。不能以此救援生产登录。 | `server/lib/localFallbackPolicy.ts:11`、`deploy/make-production-env.sh:97` |
| `PB_URL` | 缺省 `http://localhost:8090`；Compose 将 app/worker 设为 `http://pocketbase:8090`。鉴权 refresh 与 readiness 都依赖 PB。 | `server/storage/pb.ts:18`、`docker-compose.yml:12` |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | 后端管理员读写凭据，两者都存在才返回 admin credentials。不是用户 Bearer 签名密钥；不记录值。 | `server/storage/pb.ts:69`、`deploy/make-production-env.sh:74` |
| `PB_AUTH_CACHE_TTL_MS` | 缺省 5000；有限数字夹在 0–30000，`0` 关闭身份缓存；无效数字回 5000。生成器 5000。 | `server/storage/pb.ts:37`、`deploy/make-production-env.sh:98` |
| `PB_REQUEST_TIMEOUT_MS` | 缺省 10000，整数夹在 500–60000；无效数字回 10000。 | `server/storage/pb.ts:42`、`deploy/make-production-env.sh:99` |
| `LOCAL_DEMO_TOKEN_SECRET` / `LOCAL_DEMO_TOKEN_TTL_SECONDS` | 仅本地演示 token 签名与 TTL，未配置 secret 时使用进程内随机 secret；不使生产本地身份可用。 | `server/auth/localDemoToken.ts:24`、`:51`；`server/auth/localIdentity.ts:47` |
| `RUNTIME_SCHEMA_REPAIR_ENABLED` | 生产下精确 `true` 被加入 startup readiness issue，禁止用运行时自动修表替代版本迁移。生成器 `false`。 | `server/index.ts:94`、`deploy/make-production-env.sh:100` |
| `READINESS_CACHE_TTL_MS` | 缺省 2000，整数夹在 250–10000；并发 miss 合并，共享短缓存。不是实时健康保证。 | `server/runtime/readiness.ts:386`、`deploy/make-production-env.sh:107` |
| `REQUIRED_CAPABILITIES` | 生成器为 `text_generation,qwen_generation,platform_ads`。缺省生产要求 `text_generation,qwen_generation,tts,video_generation,digital_human`；空值触发此缺省，不能清空要求。未知 capability 产生 issue。 | `server/runtime/readiness.ts:297`、`deploy/make-production-env.sh:111` |
| `PROCESS_ROLE` / `PROCESS_ROLE_SPLIT_ENABLED` | role 为 `all/web/worker`；web/worker 只有 split 精确 `true` 才允许。Compose web/worker split=true。不能只以 web 活着推断后台工作。 | `server/runtime/processRole.ts:5`、`docker-compose.yml:13`、`:46` |
| `WORKER_HEARTBEAT_MAX_AGE_MS` | 生产 readiness 的 worker 心跳新鲜度配置，缺省 60000；应结合持久心跳、队列与角色观察。 | `server/runtime/socialOperatingObservability.ts:97` |

鉴权仍由 `pbAuth` 提供，即使 `DATA_BACKEND=postgres` 已切换业务数据（`server/storage/index.ts:31`）。不能以 PostgreSQL 可达替代 PB 用户鉴权 readiness。

## Fail-closed 的实际边界

`pbAuth.verifyToken` 对 `local-demo.*` 只调用 `verifyLocalIdentity`；后者首先调用本地 fallback policy。因此生产 token 不会转为本地身份。PB 用户 token 经 `/api/collections/users/auth-refresh` 核验：401/403 返回无身份，其他非成功状态、网络失败、缺失 user/tenant 身份抛 `PbAuthUnavailableError`（`server/storage/pb.ts:160`）。`requireAuth` 把验证故障返回 `503 auth_provider_unavailable` 和 `Cache-Control: no-store`，缺失/无效身份走 401（`server/middleware/auth.ts:60`）。

身份缓存是明确例外：先前已成功核验的 token 在 TTL 内不再次请求 PB；默认最长 5 秒，允许配置至 30 秒。负向身份缓存最多 1 秒；provider 故障不写入成功身份。`PB_AUTH_CACHE_TTL_MS=0` 可做即时重查的隔离验收配置，但本次未更改任何实例配置。本地 auth 数据 authority 也不能混入 PB：`assertPocketBaseDataAuthority` 在查缓存前检查，局部身份请求禁止读取 PB（`server/storage/dataAuthority.ts`）。

另外存在签名媒体会话、支持只读 token 与浏览器只读凭据路径；它们是精确范围的签名 authority，不是 local demo fallback。不能把“禁用 local auth”泛化为“所有派生凭据每请求都向 PB 核验”。本次未做真实凭据生命周期或撤销验收。

## health / ready 的区分

`GET /api/overseas/health` 是 liveness：即使 startupIssues 非空仍 HTTP 200，body.status 为 `degraded`；无 issue 为 `ok`。`GET /api/overseas/ready` 返回 no-store，report.status 非 ready 时 HTTP 503。两者在通用 API limiter 前注册（`server/index.ts:145`、`:159`）。

正式 readiness 检查 required capabilities、startup issues、数据后端、PB `/api/health`、迁移后 entitlement 集合与经营集合、所选 BullMQ 队列、后台工作心跳。Postgres 模式仍要求 PB 健康。可选 supplier 能力的部分检查只是配置存在或本地 self-check，不验证真实供应商账号余额/权限，也不证明业务任务产物、发布或外发成功。`weeklyExecution` 是观察投影，不能替代持久任务证据。

Compose app healthcheck 和 canonical `deploy/update.sh` 都使用 `/api/overseas/ready`，不能用 `/health` 的 200 代替。readiness 短缓存与 quality self-check 进程级缓存意味着改配置/镜像后需要重启相应进程；不能把旧报告当新配置验收。

## 回滚边界（准备说明，未执行）

唯一默认可授权部署入口是 AGENTS.md 指定的现有 Ubuntu 交互 SSH、现有 checkout HTTPS Git 更新及 `bash deploy/update.sh`。仓库虽有 `deploy/release.sh` 自动候选回滚代码，当前授权并不允许用它替代 canonical 流程。

`deploy/update.sh` 要求既存 `PB_DATA_VOLUME_NAME`，停 caddy/app/worker 后重建 PB 并运行迁移，再 bootstrap admin、启服务、验 ready；脚本没有迁移降级或自动事务性回滚。只回退应用 Git/image 不能保证数据库 schema、已写任务 payload 或队列状态与旧代码兼容。失败应停在具体失败 checkpoint，保存 commit、Compose 状态与 readiness/迁移证据，不能自动重新 bootstrap 空卷、`down -v`、删持久队列、禁用鉴权、改 `NODE_ENV` 或打开 local fallback。

任何后续回滚必须先核对旧代码与已升级 schema/数据/任务协议兼容性及可恢复备份，再由当前任务明确授权。回退 Git 不回退外部副作用、原任务送达未知结果或租户已发生写入。保留 PB 卷、数据库和队列身份；密钥轮换不能当成回滚捷径。未在本次确认生产备份可恢复性或旧版本兼容性。

## 隔离验证结果

执行 `node --test scripts/infra-prep-auth.test.mjs`：5/5 通过。测试在 VM 中执行从源码抽取的原始纯配置函数，环境对象独立；注册真实源码的 health/ready handler 片段，使用受控 response/probe；另核对签入的 Compose/env 生成器/update 边界。没有导入/启动 app、读取真实 env、运行 Docker、启动 listener 或连接任何服务。该结果证明上述本地源码配置语义，不证明部署后的真实鉴权或 readiness。
