# 1000 用户只读容量验收工具

## 结论边界

`scripts/capacity-acceptance.mjs` 是可复现的 HTTP GET 容量基线工具。它默认只访问：

- `/api/overseas/health`
- `/api/overseas/ready`

工具没有 POST、PUT、PATCH、DELETE 或请求体能力；生成、渲染、发布、发送、上传、迁移、支付等动作路径也会被拒绝。默认运行因此不会创建业务记录、调用生成 provider、发布内容或产生付费动作。

该工具不是完整的 `load_profile_198_ga_v1`。即使 `public-read-1000-v1` 通过，也只证明指定环境在该时间窗口承受了 1000 个客户端并发的 health/readiness GET，不证明：

- 1000 位已登录用户的完整业务读取已经通过；
- SSE、写请求、队列、文件、AI、provider 或故障恢复已经通过；
- 没有跨租户读取；
- 服务端 CPU、内存、PocketBase 连接和磁盘仍有 30% 余量；
- 当前版本可以对外承诺“支持千人并发”。

完整发布门禁仍以产品 PRD 第 15 节的 1200 已登录会话、30 分钟峰值、混合负载、长稳和故障演练为准。

流量模型是固定并发的 closed-loop：每个 worker 等上一次响应完成后再发下一次请求。它不实现 PRD 中按到达率定速的 open-loop 混合流量。

## Profile 与阈值

| Profile | 并发 | 预热 | 采样时长 | 成功吞吐 | 错误率 | P95 | P99 | 默认路径 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `safe-smoke-v1` | 10 | 1 秒 | 10 秒 | ≥ 5 RPS | ≤ 1% | ≤ 500ms | ≤ 1500ms | health + ready |
| `public-read-1000-v1` | 1000 | 60 秒 | 30 分钟 | ≥ 60 RPS | ≤ 1% | ≤ 500ms | ≤ 1500ms | health + ready |

阈值与普通读取 SLO 对齐。工具还强制检查：

- 实际观测到的客户端 pending 请求峰值达到配置并发；
- 每条配置路径至少收到一次请求；
- 全局以及每条路径分别满足错误率、P95 和 P99 阈值；
- 运行没有被 SIGINT/SIGTERM 中断；
- 若配置 token/tenant 最小数，本次并发实际覆盖达到该数量。

任何检查失败时退出码为 `1`。参数、token 文件或安全校验失败时退出码为 `2`；中断为 `130`。

## 默认本地 smoke

先启动本地服务，再执行：

```bash
node scripts/capacity-acceptance.mjs
```

默认目标为 `http://127.0.0.1:8788`。输出是 schema 版本化 JSON，包含：

- PASS/FAIL 和逐项阈值判断；
- attempted/successful RPS；
- latency min/mean/P50/P95/P99/max；
- HTTP status 分布；
- `http_429`、`http_4xx`、`http_5xx`、timeout、DNS、连接、TLS、响应过大等错误分类；
- 全局及逐路径指标；
- 实际客户端 pending 峰值。
- 执行端 Git revision、Node 版本、操作系统和架构。

可用 `--output-json <file>` 保存同一报告。工具不会自动创建目录、不会覆盖既有报告，报告文件权限默认为 `0600`。

## 1000 并发公开只读基线

仅在已获准的隔离压测或 staging 环境运行：

```bash
node scripts/capacity-acceptance.mjs \
  --profile public-read-1000-v1 \
  --base-url https://staging.example.test \
  --output-json capacity-public-read-1000.json
```

不要在没有当前任务明确授权、容量隔离和监控值守的情况下指向生产环境。仓库没有记录任何真实生产执行结果。

## 多租户 bearer token 文件

压测受保护只读路径时，应通过文件提供 token，不能在命令行传 token。文件格式：

```json
[
  { "tenantId": "tenant-a", "token": "REDACTED" },
  { "tenantId": "tenant-b", "token": "REDACTED" },
  { "tenantId": "tenant-b", "token": "REDACTED_SECOND_SESSION" }
]
```

同一租户可以出现多次以表达多会话/热点租户分布。每个并发 worker 固定分配一个 token；若 token 多于并发数，超出的 token 不会被计入本次实际覆盖。报告只输出可用/实际覆盖的 token 数及实际 tenant 数，不输出 token 或 tenantId。

`tenantId` 是压测数据制作者提供的分布标签，工具不会查询服务端身份记录验证其真实性；因此 tenant 数量门槛本身不能证明租户隔离正确。

token 文件应在仓库外生成并限制权限：

```bash
chmod 600 /secure/path/capacity-tokens.json
```

非 Windows 系统若文件对 group/world 可读，工具会在发出任何请求前拒绝运行。携带 bearer token 时，远程目标必须使用 HTTPS；只有 loopback 允许 HTTP。

受保护只读路径示例：

```bash
node scripts/capacity-acceptance.mjs \
  --profile public-read-1000-v1 \
  --base-url https://staging.example.test \
  --path /api/overseas/starter-198/workspace \
  --confirm-read-only \
  --tokens /secure/path/capacity-tokens.json \
  --concurrency 1200 \
  --min-token-count 1200 \
  --min-tenant-count 1000 \
  --output-json capacity-authenticated-read.json
```

`--confirm-read-only` 表示执行人已逐条审查 GET handler 及其依赖不会写记录、刷新外部 token、触发懒加载任务或调用付费 provider。工具的 GET 限制不能弥补服务端存在的副作用式 GET。

## 参数覆盖

可显式覆盖 profile，但不得为了让失败结果变绿而临时降低发布门槛：

```text
--concurrency
--duration-seconds
--warmup-seconds
--timeout-ms
--min-rps
--max-error-rate        # 0..1，或 1% 形式
--max-p95-ms
--max-p99-ms
--max-response-bytes
--min-token-count
--min-tenant-count
```

每次验收应保存：Git commit、目标环境版本、完整命令、脱敏 token 数据分布、输出 JSON、服务端 CPU/内存/连接池/磁盘/队列监控，以及开始结束时间。变更阈值或流量模型时新建 profile 版本，不能覆盖历史报告。

## 离线自测

```bash
node scripts/capacity-acceptance.test.mjs
```

自测只启动 `127.0.0.1` 随机端口 mock server，覆盖：

- 默认安全路径和危险路径拒绝；
- 安全 token 文件解析及多租户轮询；
- PASS 阈值；
- 429、5xx 和 timeout 分类；
- 报告不泄露 bearer token；
- 全程只发送 GET。

它不连接 PocketBase、外部环境或生产系统。

## 建议 package scripts

由维护 `package.json` 的任务合入：

```json
{
  "capacity:smoke": "node scripts/capacity-acceptance.mjs",
  "capacity:readonly-1000": "node scripts/capacity-acceptance.mjs --profile public-read-1000-v1",
  "test:capacity-harness": "node scripts/capacity-acceptance.test.mjs"
}
```
