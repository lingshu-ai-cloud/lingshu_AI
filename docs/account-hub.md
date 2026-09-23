# 团队 AI 账号与 Codex 用量管理台

这是一个独立应用，面向小团队的“一人一号”管理。它集中保存账号归属、成员设备上报的认证与额度快照、协调租约和 Codex Token 遥测。它不接收网页任务、不代理模型请求、不集中托管 Provider 登录态，也不在额度耗尽后切换到其他成员账号。

## 安全边界

- 每位成员在每个 Provider 最多绑定一个本人账号；同一 Provider 邮箱不能重复绑定。
- 成员继续在自己的 Codex/Claude 官方客户端登录。密码、Cookie、验证码、OAuth Token、API Key 和 `auth.json` 不上传到中台。
- 中台不提供 Provider 凭据导入、下载、导出或恢复接口；即使请求正文伪装成普通元数据，字段白名单和递归凭据检测也会拒绝它。
- 中台没有授权、状态探测、Provider 注销或网页任务 API；本机连接器只调用官方 CLI 的只读状态/额度方法。
- “仅退出本地”只释放本设备的协调租约，不调用 Provider 登出，不删除成员电脑的登录态。
- 协调租约有效期为 15 分钟；持续连接器每次心跳会续租。同一账号的另一台设备在租约释放或过期前不能通过连接器取得锁。
- 由于系统不代理请求，协调锁不能阻止成员绕过连接器直接启动官方客户端。团队仍需制度约束，不能把它描述为 Provider 级强制锁。
- 不做账号池化、跨成员凭据共享、自动轮换或规避用量限制。
- 管理 API 只允许服务所在机器的回环来源并要求管理员身份。成员设备只能访问成员令牌保护的遥测、状态和租约端点。
- 账号状态存储采用字段白名单并递归拒绝凭据形态；数据文件权限为 `0600`，目录为 `0700`。
- 管理变更写入本机 `account-audit.jsonl`，不记录请求正文或凭据。

## 账号管理流程

1. 管理员在“团队用量”添加成员，妥善保存只显示一次的遥测令牌与连接器令牌；两者权限互不通用。
2. 在“AI 账号”添加 Codex 或 Claude 账号并绑定该成员。
3. 成员在自己的电脑使用官方客户端完成正常登录。
4. 按页面生成的配置模板运行本机连接器。连接器上报脱敏状态与额度，并取得/续租协调锁。
5. 管理台自动展示认证状态、最后心跳、套餐、可获得的额度窗口和锁占用情况。
6. 停止或重启连接器时，它只停止续租，不主动释放活跃协调锁；租约会在 15 分钟 TTL 后自然到期，避免把进程停止误判成账号退出。Provider 登录不受影响。

额度信息是本机官方 CLI 当前可提供的只读快照。无法读取时必须显示“暂不可获取”，不能推测或伪造。

## 本机连接器

在成员电脑创建仅本人可读的 JSON 文件，例如 `~/.config/lingshu-account-hub/connector.json`：

```json
{
  "endpoint": "https://YOUR-INTERNAL-HOST/api/overseas/account-hub/telemetry/v1/account-state",
  "connectorToken": "cdc_REPLACE_WITH_CONNECTOR_TOKEN",
  "provider": "codex",
  "accountId": "acct_REPLACE_WITH_ACCOUNT_ID",
  "deviceId": "member-macbook-01",
  "deviceLabel": "成员 MacBook",
  "intervalSeconds": 60
}
```

macOS/Linux 设置权限并启动：

```bash
chmod 600 ~/.config/lingshu-account-hub/connector.json
pnpm account-hub:connector -- --config ~/.config/lingshu-account-hub/connector.json --watch --hold
```

- `--watch` 持续发送安全心跳；`--hold` 获取并续租该账号的协调锁。续租必须提交服务端上一次返回的 `leaseId`，仅复制相同 `deviceId` 不能冒充原进程续租。
- 去掉两项参数可执行一次状态测试，不会获取租约。
- 命令行不包含令牌，避免写入 Shell 历史或进程参数。
- 配置文件拒绝符号链接及组/其他用户可读权限。
- 非回环地址必须使用 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1` 或 `::1` 开发验证。
- 心跳间隔限制为 30–300 秒，避免 15 分钟租约出现续租空窗；重启连接器后若旧租约仍有效，需要等待其到期。
- 请求禁止跟随重定向，避免连接器令牌被转发到其他站点。

连接器对 Codex 使用官方 `app-server` 的 `account/read`、`account/rateLimits/read` 和 `account/usage/read`，并明确关闭 refresh；对 Claude 使用 `claude auth status`。两者都使用成员当前默认配置，不覆盖 `CODEX_HOME` 或 `CLAUDE_CONFIG_DIR`，不创建第二套登录态。

Codex 成员机建议在官方用户级 `~/.codex/config.toml` 中启用系统凭据库：

```toml
cli_auth_credentials_store = "keyring"
```

`keyring` 要求操作系统提供可用的凭据存储。不要使用 `auto` 作为强制安全策略，因为凭据库不可用时它可能回退到文件。中台不会替成员修改这项配置，也不会搬运现有登录态；如需把已经保存到文件的旧会话迁入钥匙链，应由成员在自己的电脑按官方流程重新登录一次。

### 自动状态更新与退出检测

- `--watch --hold` 每次心跳先只读探测并上报本机官方客户端状态。只有状态为 `authenticated` 时才会获取或续租协调锁。
- 只有状态明确变成 `unauthenticated` 时，连接器才会使用当前进程持有的精确 `leaseId` 调用 `local-release`，确认成功后清除本地租约能力。这个动作只释放中台协调锁，绝不执行 Codex/Claude logout，也不修改官方登录文件。
- `error` 或 `unknown` 不能证明成员已经退出。此时连接器采取 fail-closed 策略，保留当前租约能力、不发释放请求并继续探测，避免短暂 CLI 故障导致另一设备接管账号。
- 没有租约时，未登录或暂不可探测不会让连接器退出；它会继续发送心跳。之后重新登录官方客户端，连接器会自动获取新租约，不复用已经释放的旧 `leaseId`。
- 状态上报、获取或释放发生网络错误时，连接器不会把错误当成已退出，也不会丢弃当前 `leaseId`；它会继续重试，服务端租约在设备长期不可达时按 TTL 自然过期。
- 收到 SIGINT 或 SIGTERM 时，连接器只停止心跳，不调用 `local-release`；即使最后一次状态是 `authenticated`、`error` 或 `unknown`，也由 TTL 自然释放。明确的 `unauthenticated` 心跳仍会立即精确释放。
- 这里的“自动更新”仅指状态快照与协调租约随心跳更新，不包含连接器程序自动升级；代码版本升级仍由管理员按正常发布流程完成。

连接器不会读取、复制或上传 `auth.json`、refresh token、Cookie、密码等 Provider 凭据。它只通过官方 CLI 的只读状态接口获得允许上报的脱敏字段。

## Token 遥测

遥测使用单独的 `cdu_` 令牌，不能用于账号状态或租约控制。将下列配置合并到成员电脑的用户级 `~/.codex/config.toml`：

```toml
[otel]
environment = "prod"
log_user_prompt = false

[otel.exporter."otlp-http"]
endpoint = "https://YOUR-INTERNAL-HOST/api/overseas/account-hub/telemetry/v1/logs"
protocol = "json"

[otel.exporter."otlp-http".headers]
Authorization = "Bearer cdu_REPLACE_WITH_MEMBER_TOKEN"
```

`log_user_prompt` 必须保持 `false`。服务端只保留 Token 数、模型、客户端版本、时间、来源以及散列后的会话标识，不保存提示词、代码、工具输出或原始会话 ID。任一令牌泄露时在成员行执行轮换；系统会同时更换遥测和连接器令牌，两个旧令牌立即失效。

## 数据口径

- Token 在请求完成并由客户端批量发送后更新，不是逐 Token 实时扣费。
- 页面分别展示输入、缓存输入、缓存写入、输出、推理和合计 Token。
- “在线”表示最近两分钟收到该成员设备的 OTel 批次，不等于成员正在输入。
- Token 数据属于客户端遥测估算，不是 OpenAI/Anthropic 最终账单。
- Pro 订阅费、订阅额度百分比、额外购买费用与 API 单价折算值不能混为实际支出。
- 设备离线、未接入设备、客户端版本差异或导出延迟可能造成数据缺口，因此页面保留最后同步时间。

## 遗留托管凭据迁移

旧版本可能在 `ACCOUNT_HUB_DATA_DIR/accounts/<account-id>/profile/` 留有服务端托管登录文件。新版本不会读取、刷新、注销或自动删除它们；页面只显示存在性告警，不返回内容或路径。检测到遗留文件的账号会失败关闭：不能上报新认证状态，也不能取得协调锁。

迁移时由运维人员先确认成员自己的官方客户端已经登录，再备份并按组织的数据销毁流程人工清理旧目录。不要让应用自动删除，以免误删唯一可用登录态。此仓库不会自动执行该清理。

## 本地开发与验证

1. 可选设置绝对路径 `ACCOUNT_HUB_DATA_DIR`；它只保存索引、租约、脱敏快照、遥测与审计。
2. 启动后端，再运行 `pnpm run dev:account-hub`。本机长期预览可直接运行 `pnpm run dev:preview:keepalive`，守护进程会同时维护原应用和独立的 Account Hub 前端。
3. 独立应用默认监听 `http://127.0.0.1:5178`，不注册到灵枢主应用路由或导航。
4. 生产环境默认关闭，只有显式设置 `ACCOUNT_HUB_ENABLED=true` 才开启。
5. 运行 `pnpm run test:account-hub` 和 `pnpm run build:account-hub` 完成验证。

当前持久化适合单机、单进程和小团队。多实例前应迁移到共享数据库，并为成员令牌、快照唯一性、租约和事件去重提供集中事务控制。
