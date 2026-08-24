# 三环境 GitHub Actions 部署手册

## 目标状态

代码只在 GitHub Actions 的托管 Runner 上测试并构建一次，生成两个不可变 GHCR 镜像：

- `ghcr.io/boooppppiiii-cloud/lingshu-ai-app:sha-<commit>`
- `ghcr.io/boooppppiiii-cloud/lingshu-ai-pocketbase:sha-<commit>`

三台服务器各运行一个专用 Self-hosted Runner，只主动连接 GitHub，不接受跨服务器 SSH 部署。服务器标签固定为：

| 环境 | Runner 标签 | 建议用途 |
| --- | --- | --- |
| 内部 | `self-hosted,linux,lingshu,internal` | 团队开发验证 |
| 试用 | `self-hosted,linux,lingshu,trial` | 合作伙伴验收 |
| 正式 | `self-hosted,linux,lingshu,production` | 正式客户 |

部署工作流按环境加互斥锁，同一环境永远只有一个发布任务。运行密钥保存在对应服务器的 `/opt/lingshu/<environment>/.env.runtime`，不进入 GitHub 仓库或工作流日志。

## 安全前置条件

1. **先把仓库改成 private。** GitHub 官方不建议公开仓库连接 Self-hosted Runner，因为 fork 或不受信任的工作流可能在服务器上执行代码。
2. GitHub Organization 管理员创建只允许 `lingshu_AI` 使用的 Runner group；若套餐支持，再限制为只允许这两个部署工作流使用。
3. `main` 开启分支保护：必须 Pull Request、至少一人审核、状态检查通过、禁止直接 push。
4. 创建 `internal`、`trial`、`production` 三个 GitHub Environment。正式环境启用 required reviewer、prevent self-review、禁止绕过（GitHub 套餐支持时）。
5. 不要在 Self-hosted Runner 上运行 `pull_request` 工作流。测试和镜像构建只能使用 `ubuntu-latest`。

## 仓库工作流

- `Build release images`：PR 只做检查；`main` 通过检查后发布带完整 commit SHA 的不可变镜像。
- `Deploy environment`：人工选择环境和已发布的完整 commit SHA。只允许 `main` 中存在的 commit；正式环境还必须输入 `DEPLOY production`。
- `Roll back environment`：恢复该服务器记录的上一组镜像；正式环境必须输入 `ROLLBACK production`。

三个部署工作流都使用环境级并发锁，避免两个人同时覆盖部署。

## 每台 Ubuntu 服务器初始化

先在服务器上准备主机。`<environment>` 分别替换为 `internal`、`trial` 或 `production`：

```bash
sudo bash deploy/prepare-runner-host.sh <environment>
```

该脚本会安装 Docker Compose v2、创建低权限 `actions-runner` 用户、持久部署目录和独立 Docker volumes。它不会注册 Runner，也不会修改防火墙。

在 GitHub Organization 的 Runner group 中点击 **New self-hosted runner**，选择 Linux/x64，然后严格使用页面给出的当前版本、校验值和一小时有效注册 token。在 `/opt/actions-runner` 中以 `actions-runner` 用户完成注册，附加标签：

```text
lingshu,<environment>
```

最后把 Runner 安装为 systemd 服务。确认 GitHub 页面中该 Runner 状态为 **Idle**。

## 每台服务器的运行配置

用仓库的 `deploy/runtime.env.example` 创建：

```text
/opt/lingshu/<environment>/.env.runtime
```

要求：

```bash
sudo chown actions-runner:actions-runner /opt/lingshu/<environment>/.env.runtime
sudo chmod 600 /opt/lingshu/<environment>/.env.runtime
```

每个环境使用独立域名、数据库管理员密码、签名密钥、第三方 API Key 和对象存储前缀。不要复制正式环境的客户数据或密钥到内部/试用环境。

服务器安全组和 UFW 只需入站开放应用所需的 `80/443` 与受限来源的运维 `22`；Runner 通过出站 HTTPS 连接 GitHub。

## 首次发布顺序

1. 合并代码到 `main`。
2. 等待 `Build release images` 完成，复制完整 40 位 commit SHA。
3. 手动运行 `Deploy environment`，先选 `internal`。
4. 完成功能和数据隔离验收后，用同一个 SHA 发布到 `trial`。
5. 合作伙伴验收通过后，用同一个 SHA 发布到 `production`；正式环境必须经过审批。

这叫“提升同一制品”：不是在三台服务器分别重新构建，所以不会出现同一个 Git commit 在不同环境产生不同镜像。

## 失败与回滚

每次发布会先在 `/opt/lingshu/<environment>/backups` 生成 PocketBase 压缩备份，然后启动候选镜像并等待应用与 PocketBase 健康检查。如果健康检查失败，脚本自动恢复上一镜像。

人工回滚运行 `Roll back environment`。回滚只切换容器镜像，不自动覆盖数据库；这样不会在回滚时误删发布后产生的客户数据。若数据库迁移不向后兼容，需要在维护窗口中根据对应备份单独恢复数据。

当前版本记录：

```text
/opt/lingshu/<environment>/.release.env
```

上一版本记录：

```text
/opt/lingshu/<environment>/.previous-release.env
```

部署审计记录：

```text
/opt/lingshu/<environment>/deployment-history.tsv
```

## 日常发布规则

- 开发者只提交分支和 PR，不登录服务器更新代码。
- 审核者确认 CI、迁移兼容性和回滚说明。
- 内部、试用、正式始终提升同一个 commit SHA。
- 服务器上禁止再运行 `git pull`、`docker compose up --build` 或旧的 `deploy/update.sh`。
- 紧急回滚走 GitHub Actions，保留操作者、时间、目标环境和 Actions run URL。
