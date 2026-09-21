# 单台 Ubuntu 服务器部署说明

这份文档适合 Linux 小白照着做。目标是把整个工具部署到你自己的 Ubuntu 服务器上，让客户打开一个链接就能使用。

你的服务器：

- 系统：Ubuntu
- 配置：2 核 CPU、2GB 内存、40GB 磁盘
- IPv4：`43.159.41.222`

这台机器可以跑早期演示和小规模客户使用。视频生成、爬虫、批量分析比较吃资源，前期不要开太高并发。

## 你必须自己准备的东西

下面这些我不能替你完成，需要你自己操作：

1. 一个给客户访问的域名。
2. 把域名 DNS 解析到服务器 IP。
3. 能登录服务器的账号和密码/密钥。
4. 至少一个 AI 模型 Key，例如 Gemini API Key 或 DashScope API Key。

准备一个应用域名：

```text
app.example.com  -> 给客户打开工具
```

给它添加 A 记录，指向：

```text
43.159.41.222
```

## 第 1 步：登录服务器

在你电脑的终端里执行，把 `root` 换成你的服务器用户名：

```bash
ssh root@43.159.41.222
```

这一步是在进入服务器。后面的命令都在服务器里执行。

## 第 2 步：安装基础环境

先安装一些基础工具、Docker 和防火墙规则：

```bash
sudo apt update
sudo apt install -y git ca-certificates curl ufw openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

这一步在做三件事：

- 安装 Git，用来拉取 GitHub 代码。
- 安装 Docker，用来运行应用、PocketBase 和 HTTPS 入口。
- 开放 80/443 端口，让客户可以通过网页访问。

执行完后，退出服务器再重新登录：

```bash
exit
ssh root@43.159.41.222
```

重新登录是为了让 Docker 权限生效。

## 第 3 步：下载项目代码

```bash
git clone https://github.com/boooppppiiii-cloud/lingshu_AI.git
cd lingshu_AI
```

这一步会把 GitHub 上的项目下载到服务器。

如果提示目录已经存在，就进入已有目录：

```bash
cd lingshu_AI
git pull --ff-only
```

## 第 4 步：生成线上配置

执行：

```bash
bash deploy/make-production-env.sh
```

它会问你几个问题：

- 客户访问域名：填你的 `app.example.com`
- PocketBase 管理邮箱：填你的邮箱
- PocketBase 管理密码：可以自己填，也可以直接回车自动生成
- 工作台管理员邮箱和密码：与 PocketBase 超级管理员保持独立
- Gemini / DashScope：至少填写一个；Seedance Key 可暂时跳过

这一步会生成 `.env.production`，里面保存线上密钥。不要把这个文件发给别人。脚本还会按应用域名生成唯一的 `PB_DATA_VOLUME_NAME`、随机的 `PB_DATA_VOLUME_OWNER`，并把宿主机探针端口固定为 `APP_HOST_PORT=18788`；不要复用其他环境的 volume 名或 owner。
其中 `TENANT_PLATFORM_APP_KEY` 用于加密每个租户的平台 App Secret 和 Token；脚本会自动生成。手动部署时可用 `openssl rand -base64 32` 生成，详见 `docs/tenant-platform-app-key.md`。

## 第 5 步：启动全部服务

```bash
bash deploy/start.sh --fresh-install
```

这一步会启动三个服务：

- `app`：你的工具本体
- `pocketbase`：数据库和账号系统
- `caddy`：自动 HTTPS 和域名转发

第一次启动会比较慢，因为服务器要下载镜像、安装依赖和构建前端。只有显式的 `--fresh-install` 才会创建空 volume，并同时写入 `com.lingshu-ai.data-role=pocketbase` 与当前安装的 owner 标签。此后不带参数的启动和更新都只接受已经存在、role/owner 完全一致的 volume，不会在数据库丢失时悄悄创建空库。

从旧版本升级时，先用 `docker volume ls --format '{{.Name}} {{.Labels}}'` 找到真实 PB volume，并做独立备份。为 `.env.production` 配置一个与旧卷不同的新 `PB_DATA_VOLUME_NAME`、唯一的 `PB_DATA_VOLUME_OWNER=lingshu-install-<32位随机十六进制>` 和 `APP_HOST_PORT=18788`，再显式复制旧卷（把示例源名称替换为检查出的完整名称）：

```bash
bash deploy/ensure-pb-volume.sh --adopt-legacy lingshu-ai-cs-preview_preview_pb_data .env.production
bash deploy/start.sh
```

先停止仍在使用旧卷的旧 PocketBase stack。adopt 只接受没有 owner 且具有已知 LingShu/PB Compose 标签、当前没有运行中容器使用的源卷；它会创建带当前 owner 的新卷并复制数据，旧卷保持不变。不要猜卷名，也不要直接把旧 preview 卷名写成当前目标；正常启动/更新不会隐式接受或迁移 legacy volume。

## 第 6 步：确认数据库迁移和能力就绪

PocketBase 只监听宿主机 `127.0.0.1:8090`，应用探针端口也只监听 `127.0.0.1:${APP_HOST_PORT}`；Caddy 在私有 Compose 网络内访问 `app:8788`，不要为 PocketBase 或应用探针另开公网端口。部署入口会强制重建 PocketBase 容器，使它根据 `.env.production` 创建或更新超级管理员，并在开始接流量前执行仓库中的全部待执行版本化 migration；应用进程不会在启动时改表。

migration 成功后，`deploy/start.sh` / `deploy/update.sh` 会单独运行 `scripts/bootstrap-workbench-admin.mjs`。它只幂等创建或核对 `tenants`、`users` 记录，不创建/修改集合 schema；账号冲突、PB 不可用或字段契约不符都会让部署失败。已有工作台账号的密码不会随环境变量自动轮换，需要走明确的密码重置流程。历史 `trend_videos` 的空 `contentFormat` 由不可变 migration 一次性回填：分析标记为图片的写 `image`，其余写 `video`。

先查看 migration 日志：

```bash
docker compose --env-file .env.production logs --tail=120 pocketbase
```

再检查依赖和功能开关：

```bash
curl -fsS https://你的客户访问域名/api/overseas/ready
```

只有返回 `status=ready` 才算可接流量。若返回 503，按 `issues` 修好缺少的模型、TTS、视频、数字人、Starter Worker、报价开关或平台加密密钥；不要通过开启运行时修表或演示回退来绕过。

## 第 7 步：检查是否部署成功

在浏览器打开：

```text
https://你的客户访问域名/api/overseas/ready
```

正常会看到类似：

```json
{
  "status": "ready",
  "issues": []
}
```

然后打开客户访问域名：

```text
https://你的客户访问域名
```

如果页面能打开，说明客户已经可以使用这个工具。

## 常用命令

查看服务状态：

```bash
bash deploy/status.sh
```

查看全部服务：

```bash
docker compose --env-file .env.production ps
```

查看主应用日志：

```bash
docker compose --env-file .env.production logs -f app
```

查看 PocketBase 日志：

```bash
docker compose --env-file .env.production logs -f pocketbase
```

更新代码并重启只需要下面两条命令。Docker 构建缓存会保留，通常只重新构建发生变化的层：

```bash
git pull --ff-only
bash deploy/update.sh
```

快速更新不会自动创建部署前备份。如果本次包含高风险数据迁移，先单独运行下方的加密备份命令，再执行更新。

手动备份（同样必须加密）：

```bash
AGE_RECIPIENT=age1... bash deploy/backup.sh
```

停止服务：

```bash
docker compose --env-file .env.production down
```

重新启动也必须走带 volume 校验、migration、账号 bootstrap 和 readiness 门禁的入口：

```bash
bash deploy/start.sh
```

## 如果出错

如果域名打不开，先检查：

1. 域名 A 记录是否指向 `43.159.41.222`。
2. 服务器安全组是否放行 80 和 443。
3. 服务器防火墙是否放行 80 和 443。

查看 Caddy HTTPS 日志：

```bash
docker compose --env-file .env.production logs -f caddy
```

如果页面能打开但功能报错，查看主应用日志：

```bash
docker compose --env-file .env.production logs -f app
```

如果登录、账号、数据表异常，查看 PocketBase 日志：

```bash
docker compose --env-file .env.production logs -f pocketbase
```

## 数据保存在哪里

PocketBase 数据保存在 `.env.production` 的 `PB_DATA_VOLUME_NAME` 指定的 Docker volume 里。首次启动后可核对：

```bash
docker volume inspect "$(sed -n 's/^PB_DATA_VOLUME_NAME=//p' .env.production)"
```

输出必须同时包含 `com.lingshu-ai.data-role=pocketbase` 和与 `.env.production` 中 `PB_DATA_VOLUME_OWNER` 一致的 `com.lingshu-ai.installation-owner`。旧 Compose 管理且带 `com.docker.compose.volume=pb_data` 或 `preview_pb_data` 标签的 volume 只能通过前述显式 adopt 复制到新卷；无标签或已有其他 owner 的 volume 会被拒绝，不能靠改回 preview 默认名绕过。
应用上传或生成的素材保存在项目的 `data/` 目录里。

建议你每次更新前都先备份：

```bash
AGE_RECIPIENT=age1... bash deploy/backup.sh
```

备份同时包含 PocketBase 与 `data/`，落盘前使用 age 加密并生成 SHA-256 清单。恢复先做非破坏性演练，详见 `docs/backup-restore-r2.md`。
