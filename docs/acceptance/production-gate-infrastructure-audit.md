# 本地隔离基础设施门禁验收

日期：2026-10-10。仅新增 `production-gate-infrastructure-*` 验收文件，未改主功能、未提交、未安装软件、未加载生产 env、未执行 schema/迁移、未接触真实服务。

## 设施调查

- `command -v docker/psql/redis-cli` 均无结果；`/usr/local/bin`、`/opt/homebrew/bin` 的常见可执行路径不存在。
- `/Applications` 中未发现 Docker / OrbStack。`/var/run/docker.sock`、用户 Docker 与 OrbStack sockets 不存在。
- 对 Codex runtime、Applications、usr/local、Homebrew 文件清单的精确文件名搜索没有找到 postgres、initdb、pg_ctl、redis-server、docker、podman 或 nerdctl。
- `/usr/sbin/lsof -nP -iTCP:5432 -iTCP:6379 -sTCP:LISTEN` 无结果。没有向这些端口发起连接。
- 仓库 `docker-compose.yml` 为 app/worker/PocketBase/Caddy，并引用生产 env 和外部 PocketBase volume；不存在供本验收启动的隔离 Postgres/Redis 服务。未启动此 compose。

因此本轮不能证明真实 Postgres/Redis/BullMQ 连接或实际数据库并发事务。使用内存/SqlExecutor/注入 probe 的通过结果不得写成真实基础设施集成通过。

## 隔离测试

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/production-gate-infrastructure-run.mjs
```

结果 exit 0，10 项全部通过：

| 范围 | 已证明 | 实测层级 |
| --- | --- | --- |
| DATA_BACKEND | 实际 storage/index 在 postgres 模式将 business/lease 读写转 Postgres；users/auth 留 PocketBase | 实际模块 + 替换 store 方法；未发数据库请求 |
| PostgreSQL SQL | 参数化过滤、排序、非法 collection/field 拒绝 | SqlExecutor 合同 |
| PostgreSQL cutover | starter/provisioning/source/observability/readiness 不误读 PB business | 源码合同 |
| 原子发布门禁 | 未声明 capability、PB/local fallback 无法到 provider；只有实际有效唯一索引目录证明才通过，错字段/谓词/失效/连接错误拒绝 | 真实门禁 + 注入 catalog rows |
| durable lease | 唯一赢家、续租、释放、过期宽限、旧 token 拒绝 | 内存 DataStore 模型 |
| direct publish lease | 两实例同资源只允许一个 callback进入；错误/失去租约处置 | 内存共享模型；没有真实发布 |
| BullMQ | 生产 local fallback 拒绝，URL/TLS配置、敏感错误脱敏、探针超时 | 注入连接 probe；未启动 worker/job |
| failclosed auth | provider outage 返回503且不next；私有asset/cloud-media同样拒绝；subscription authority outage拒绝 | 真正 ephemeral HTTP loopback + 注入provider |
| 8个静态生产门禁 | PG、原子store、durable queue、auth fallback及平台release配置缺失时拒绝 | 注入 env |
| 实际连接第9门禁 | 配置不等于连接成功；queue failure、local noop、超时拒绝，错误脱敏 | 注入 connection probe |

新增 backend 测试只替换 ports 后调用，finally 恢复。不创建 PostgresPool、不调用 schema/apply、不访问 PocketBase。

## 隔离约束与证据

runner 为每项子进程构造清洁环境，不继承 DATABASE_URL/REDIS_URL、PB凭据、供应商凭据或 NODE_OPTIONS；设置 test、禁本地 auth fallback，并明确 local queue。个别现有测试使用的 provider URL/口令是源码内合成值，且其 fetch 已替换。

network preloader 只允许两类 Socket：当前子进程创建的 loopback ephemeral HTTP listener，以及 tsx loader 精确父PID的临时 IPC pipe。其它 socket一律拒绝并记录；出现拒绝也会将本项判失败。不得用此 harness 去运行生产服务器或 schema脚本。

`work/production-gate-infrastructure-evidence.json` 含逐项命令、exit、输出、源码 SHA256、socket events；10项 exit均0，没有blocked_socket。唯一 TCP 请求指向 auth测试自己创建的127.0.0.1 ephemeral HTTP server；其余只有tsx loader IPC。证据顶层明确 `actualPostgresVerified=false`、`actualRedisVerified=false`。

## 缺口与后续路径

- **INFRA-PG-REAL：未实测真实 Postgres。** 还需在明确临时专属实例/schema上执行 schema和唯一索引校验，验证多客户端同tenant/scope/subject争用只有一个 lease owner、旧token不可续租/覆盖，并核对失败回滚。
- **INFRA-REDIS-REAL：未实测真实 Redis/BullMQ。** 还需专属隔离实例或明确DB/prefix，验证 enqueue去重、worker消费、重连、超时及关闭后清理；不能连接来源未知的本地6379。
- **INFRA-AUTH-REAL：未实测真实鉴权服务 outage。** 已证明 HTTP中间件在注入provider failure时关闭权限，未证明真实 token交换及PG cutover期间实际用户会话。
- 本轮没有发现需要改主功能的安全门禁错误。没有把缺失服务转成 ready，也没有安装或启动不明确归属的设施。

runner还保存实际存储、队列、租约、认证和production probe源码运行前后SHA256及HEAD。相关源码漂移时退出失败；每项运行前删除旧network证据，缺失本次网络记录同样失败，防止旧日志被误当成本次隔离证明。根代理加强此检查后重跑10项仍全部exit0。
