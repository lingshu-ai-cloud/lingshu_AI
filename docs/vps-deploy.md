# 单机 Ubuntu 生产部署指南

> 这份文档是操作入口，完整门禁、备份、恢复和回滚以 [`production-readiness-runbook.md`](./production-readiness-runbook.md) 为准。构建、测试或准备代码都不等于获得了上线授权；只有在明确的变更窗口和上线授权下才能启动或更新生产服务。

## 1. 架构与前置条件

对外只需要一个应用域名，例如 `app.your-company.com`，DNS A/AAAA 记录指向服务器。

- Caddy 公开 80/443，终止 TLS 并转发到应用。
- 应用容器仅经 Caddy 接收业务流量。
- PocketBase 不设置公网域名，只绑定宿主机 `127.0.0.1:8090` 和 Compose 私有网络。
- PocketBase 数据和应用素材分别使用两个预先创建、明确命名的外部 Docker volume。

建议至少 2 vCPU、4 GiB 内存，并为媒体渲染和备份保留充足磁盘。对视频生成或批量分析应单独做容量评估。

## 2. 安装基础环境

在受控 Ubuntu 主机安装 Git、Docker Engine/Compose plugin、OpenSSL 和 `age`。不要在未审查的变更窗口中直接执行远程 `curl | sh`。`deploy/bootstrap-ubuntu.sh` 不会代为安装 Docker：如果未检测到已审核的 Docker Engine 和 Compose plugin，它会 fail closed 并指向 Docker 官方 apt 仓库流程。安装时必须核对签名 key fingerprint 并固定经批准的包版本。防火墙只需放行 SSH、80 和 443；不得放行 8090 公网入站。

## 3. 固定代码版本

生产不使用漂移的分支头或 `git pull`。在变更评审中记录完整 40 位 commit SHA，然后在服务器上校验：

```bash
git fetch --prune origin
git checkout --detach <exact-40-character-commit>
test "$(git rev-parse HEAD)" = "<exact-40-character-commit>"
git status --short
```

工作树必须为空；`.env.production` 不得进入 Git。

## 4. 生成并审核配置

```bash
npm ci
bash deploy/make-production-env.sh
```

生成器会：

- 要求真实 HTTPS 域名、PocketBase superuser 和独立的 Workbench 管理员；
- 要求可用的文本 LLM 与 Studio TTS 凭证；
- 为渲染、素材、OAuth 凭证、注册凭证、支持会话、爬虫 worker 和监控分别生成不复用的密钥；
- 写入 Compose 强制的 `PB_DATA_VOLUME_NAME` 和 `APP_DATA_VOLUME_NAME`；
- 默认关闭真实社媒发布，但保持持久化排期 worker 运行；
- 用应用自身的 production validator 和 `docker compose config --quiet` 校验完整配置；
- 以 0600 原子写入 `.env.production`，不启动、迁移或部署任何服务。

若选择自动生成 PB/Workbench 密码，密码不会打印到终端，而是写入 0600 的 `.env.production.bootstrap-secrets`。这是一次性交付文件：立即转存到批准的密码管理器、核对后安全删除；未处理前生成器会拒绝再次运行。

生成后由两人复核域名、邮箱、volume 名、LLM/TTS provider 和所有非空外部端点。不要把配置或 bootstrap secrets 贴到工单或聊天中。

## 5. 创建外部数据卷

使用 `.env.production` 中精确的两个名称创建卷：

```bash
docker volume create lingshu-production-pb-data
docker volume create lingshu-production-app-data
```

如果你在生成器中选了其他名称，命令也必须使用完全相同的名称。不得指向 preview/test 卷或历史项目的默认卷。

## 6. 上线前门禁

在相同 commit 上完整执行 [`production-readiness-runbook.md`](./production-readiness-runbook.md) 的“上线门禁”，包括：

- `npm ci`、TypeScript、全部已发现回归测试的防遗漏门禁、生产构建与依赖审计；
- PocketBase 新库迁移、canonical schema、CAS 与 create-if-absent 并发冒烟测试；
- Compose 配置展开和两个 Docker 镜像的本地构建；
- 加密备份的隔离恢复演练和完整回滚方案。

任一门禁失败都必须停止。

## 7. 首次启动（仅在明确授权后）

确认目标主机、域名、commit 和两个 volume 均与变更单一致后，才能在授权的变更窗口执行：

```bash
bash deploy/start.sh
```

PocketBase 容器会先在私有数据卷上执行版本化迁移并创建/更新 superuser；应用容器随后运行 `setup:pb` 同步与校验 canonical schema，成功后才启动工作进程。不需要再手工创建 PocketBase 管理员或重复运行 schema setup。

## 8. 健康验证

外部存活拨测：

```bash
curl -fsS "https://app.your-company.com/api/overseas/livez"
```

生产流量门禁（匿名响应只返回总体状态）：

```bash
curl -fsS "https://app.your-company.com/api/overseas/readyz"
docker compose --env-file .env.production exec -T app \
  sh -c 'curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:8788/api/overseas/readyz'
```

只有 `readyz` 为 `ready` 或明确可接受的 `degraded`、schema 无漂移、所有关键 worker 心跳正常时才能切入流量。`/api/overseas/health` 是旧客户端兼容接口，不能作为编排或上线成功标准。

## 9. 私有 PocketBase 管理

不得为 PocketBase 配置公网子域名。需要访问管理界面时，从受信任电脑建立临时 SSH 隧道：

```bash
ssh -L 8090:127.0.0.1:8090 <user>@<server>
```

然后只在本机打开 `http://127.0.0.1:8090/_/`。使用 `.env.production` 中的 PocketBase superuser 凭证，完成后立即关闭隧道。

## 10. 备份、更新与回滚

手工备份只使用加密一致性流程：

```bash
AGE_RECIPIENT='age1...' BACKUP_DIR=/secure/lingshu-backups bash deploy/backup.sh
```

该流程同时停止 app/PocketBase 取得一致快照，覆盖两个外部卷，生成逐文件 checksum，用 `age` 加密，并在退出时恢复服务及等待 `readyz`。明文 tar 备份已禁用。

`deploy/update.sh` 是一个永不部署的 fail-closed 兼容入口：它只接受完整 40 位 commit，验证后打印当前运行手册并以非零退出，不会 `git pull`、切换代码、构建、迁移、同步 demo 账号、重启或部署。更新必须回到 [`production-readiness-runbook.md`](./production-readiness-runbook.md) 执行加密备份、固定 revision、门禁、变更授权和回滚流程。

任何 migration/schema 失败、`readyz` 持续 503、worker 无心跳、outbox dead-letter 增长或发布出现重复/待对账异常，都必须停止切流并按运行手册回滚。

## 11. 数据位置

- PocketBase：`PB_DATA_VOLUME_NAME` 指定的外部 Docker volume，容器内挂载为 `/pb/pb_data`。
- 应用素材、音频、渲染结果和本地持久化状态：`APP_DATA_VOLUME_NAME` 指定的外部 Docker volume，容器内挂载为 `/app/data`。
- 项目目录中的 `./data` 和 `./pb_data` 不是 Compose 生产数据源，不得用它们代替 volume 备份或恢复。
