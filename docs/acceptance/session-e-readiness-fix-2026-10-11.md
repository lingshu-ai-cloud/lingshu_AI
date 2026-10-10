# 会话 E：严格 readiness 本地修复与决策记录

日期：2026-10-11（Asia/Shanghai）。依据 `5bd6708` 和《缺口与 MVP 测试》第 11–12 节。三名子 Agent 分别负责修复、独立测试和只读清单；主会话审查、回归并独立提交负责文件，没有包含其他会话的工作树改动。

## 问题与修复

原 canonical `deploy/update.sh`、`deploy/start.sh` 和 app Compose healthcheck 只使用 `curl -fsS`，会把 SPA HTML 的 HTTP 200 当作 readiness 成功。

新增 `scripts/check-runtime-readiness.mjs`，统一使用一次无认证 GET，要求 HTTP 200、JSON Content-Type（含合法 +json 类型）、对象报告、有效 role、capabilities 对象、build 的 commitSha/version/startedAt 非空字符串，以及 `status === 'ready'` 和空 issues。它拒绝重定向、URL 内嵌凭据、无效结构、降级与超大响应，设置 4 秒超时和 256 KiB 上限，失败只输出固定错误类别，不输出地址、报告正文或凭据。

两个 canonical 入口在 app 容器内执行 Node 探针，Compose healthcheck 使用同一脚本，Dockerfile 显式复制脚本。宿主无需额外安装 Node。`set -e` 保证失败时不执行随后成功声明；Compose 的 `--wait` 亦受严格健康检查约束。

## 验证

- 新增独立 loopback HTTP/CLI 测试 **24/24**：正确 JSON；HTML 200；错误 Content-Type；无效 JSON；数组/null；status/issues；build/role/capabilities；503；不跟随重定向；响应头与正文超时；大小上限；URL 凭据零请求；CLI 退出码与输出脱敏。
- 基础设施与六类证据合同 **61/61**，部署 bootstrap 与 production ops 两个文件级合同通过。组合回归在新增 CLI 两例之前为 **85/85**；最终 readiness 文件再次 **24/24**，合计验证 87 个不同检查。未构建镜像、启动 Docker 或连接真实服务。
- `bash -n deploy/start.sh deploy/update.sh` 与负责文件 `git diff --check` 通过。
- 三个离线预检命令实际执行并退出 0：config 模板合同 `serviceConnections:0`、`deploymentExecuted:false`；PG dry-run `executed:false`；backup dry-run `mutations:0`、`connect:false`。只使用签入模板，不读真实 env 或 manifest。

## 实际限制和后续验收

容器内探针验证应用报告，不验证宿主端口映射、公网 TLS/代理或期望 SHA 一致性。build SHA 为 `unknown` 仍允许本地 schema 校验通过，不能据此声明部署版本核验完成；后续管理员验收必须单独比较批准候选与远端/运行 SHA，并采集宿主及公网的原始 JSON。

这是运行 readiness 的 `status` 合同，不是周执行门禁的 `ready:boolean`，也不消费六类真实证据。`deploy/release.sh`、release Compose 与 `restore-production-data.sh` 仍有 HTTP-only 校验，本轮未修改，不能声明所有操作路径都已修复。release 不属于 AGENTS.md 允许的默认部署路径；恢复前仍须独立审查并修复其门禁。

本轮没有重试 SSH。最后已有记录为 SSH banner 超时、公网 `/ready` HTML；不能声称本日线上状态有变化。PG/Redis/Worker/PB/COS、完整备份和六类证据的下一步只读顺序见 `session-e-readonly-checklist-2026-10-11.md`。该清单将零连接、实际连接和写入工具分开，禁止把 migration `--verify` 或 Worker 启动当作只读动作。

## 八项口径

| 项目 | 本轮结论 |
| --- | --- |
| 本地受控合同 | readiness 24/24，infra/evidence 61/61，部署合同通过；仅证明本地行为。 |
| 真实媒体文件 | 本轮未生成；既有 MP4 记录不提升为本轮结果。 |
| 真实付费供应商 | 本轮未调用。 |
| 创意质量 | 本轮无新增验收；既有成片仍需修改、不可发布。 |
| 真实发布 | 本轮未发布，真实 MVP 发布未完成。 |
| 真实平台回执 | 未取得新增可信回执。 |
| 真实指标 | 未回收，不补零。 |
| 生产 ready:true | 未证明；本地门禁修复不等于生产修复。 |

## 决策与例外

Agent 自主选择 Node 原生 fetch、容器内复用、严格 schema、安全错误输出和 loopback 测试，完成本地技术修复，无需让普通客户决定技术方案。主会话继续保持 E 的基础设施范围，不选择或拼接 A/B 产品，不创造客户授权或平台批准。

管理员例外仍为可达 SSH/批准只读访问范围、远端目标与受控凭据、完整备份及真实依赖证据；生产部署、迁移、恢复、启停消费者等变更必须单独批准。制作授权、A ¥5 数字人口播上限、公开发布授权和生产变更授权互不替代。当前无需就已授权的本地修复重复询问；只有恢复访问或执行生产变更时才需要管理员处理对应例外。
