# 生产上线与回滚运行手册

这份手册用于上线前验收和正式变更窗口。仓库里的构建、测试和迁移准备不代表已经部署；只有得到明确上线授权后才能执行生产启动、迁移或恢复。

## 上线门禁

在与生产相同的提交上执行：

```bash
npm ci
npm run lint
npm test
npm run build
npm audit --omit=dev
node --check pb_hooks/atomic.pb.js
for migration in pb_migrations/*.js; do node --check "$migration"; done
bash -n deploy/bootstrap-ubuntu.sh deploy/make-production-env.sh deploy/update.sh deploy/backup.sh \
  scripts/backup-production-data.sh scripts/restore-production-data.sh
npm run test:pb-atomic-smoke
npm run test:pb-upgrade-smoke
```

Docker 可用的验收机还必须执行本地构建和配置展开；这一步只是构建，不启动生产：

```bash
APP_DATA_VOLUME_NAME=lingshu-validation-app-data \
PB_DATA_VOLUME_NAME=lingshu-validation-pb-data \
ENV_FILE_PATH=.env.production.example \
docker compose --env-file .env.production.example config --quiet

docker build --pull -t lingshu-app:validation -f Dockerfile .
docker build --pull -t lingshu-pocketbase:validation -f Dockerfile.pocketbase .
```

镜像验收项：应用和 PocketBase 最终镜像均为非 root；应用镜像包含 `desktop/render.cjs`；PocketBase 镜像包含 `pb_migrations` 和 `pb_hooks`；应用运行时只安装 production dependencies。

## 数据卷与配置

1. 从 `.env.production.example` 生成受权限保护的 `.env.production`，所有 `change-me` 和空的必需密钥必须替换。
2. 使用独立、明确命名的外部卷。Compose 没有 preview/test 默认卷，未设置以下名称会直接失败：

```bash
docker volume create lingshu-production-pb-data
docker volume create lingshu-production-app-data
```

3. `.env.production` 中的 `PB_DATA_VOLUME_NAME`、`APP_DATA_VOLUME_NAME` 必须精确对应上述卷，不能指向预览数据。
4. 生产必须保持 `ENABLE_LOCAL_STORE_FALLBACK=false`、`DISABLE_LOCAL_AUTH_FALLBACK=true`、`DISABLE_DESKTOP_OPEN_OUTPUT=true`，并配置随机 `METRICS_TOKEN`。
   Compose 只向公网 Caddy 注入 `APP_DOMAIN`，只向 PocketBase 注入 `PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD`；不得把整份 `.env.production` 注入这两个容器。
5. 若配置数字员工 webhook，URL 必须为 HTTPS，必须配置 HMAC secret，且 `DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS` 必须逐个列出允许的精确 origin（逗号分隔，不允许通配符或路径）。应用会拒绝 localhost 和私网字面地址；生产网络还必须用 egress firewall 禁止访问回环、链路本地、RFC1918/ULA 和云元数据网段，以防 DNS 解析变化/TOCTOU 绕过。不配置 URL 时，`run_events` 与带游标的 SSE 是内部 durable delivery，outbox 会正常标记 delivered。
6. 必须选择可用的文本模型后端：默认 `gemini` 需配置真实 `GEMINI_API_KEY`；设置 `OVERSEAS_LLM_BACKEND=qwen` 时需配置真实 `DASHSCOPE_API_KEY`。缺失或仍为占位值会在监听端口、数据库 bootstrap 和 worker 启动前直接终止进程。
7. 开启 `DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED=true` 前，必须保持 `PUBLISH_SCHEDULER_ENABLED=true` 与 `DIGITAL_EMPLOYEE_VOICEOVER_MODE=required`，并将 `DIGITAL_EMPLOYEE_TTS_PROVIDER` 设为 `auto`、`qwen` 或 `minimax`。`auto` 至少需一个真实 `DASHSCOPE_API_KEY`/`MINIMAX_API_KEY`；固定 provider 时必须配置对应凭证。启动校验会拒绝禁用/缺失的排期 worker、静音模式、缺失/占位凭证和未知 provider。运行中已配置语音服务但合成、下载、音频魔数/解码、大小或 60 秒时长校验失败时，本次渲染必须失败，不得生成可发布的静音成片。
8. 设置有限的 `PUBLISH_ACCOUNT_TIMEOUT_MS`（示例 10 分钟）且让 `PUBLISH_SCHEDULER_LEASE_MS` 覆盖该超时。平台无响应、超时、歧义 4xx、5xx、成功缺 ID 或成功结果落库不确定时，任务必须保持 `needs_reconciliation`，由管理员逐账号提交平台后台回执；不得通过编辑、删除或普通重试绕过对账。
9. PocketBase 必须保持在仓库固定并通过两套 smoke 的安全补丁版本。当前基线为 `0.39.9`；修改 `PB_VERSION` 时必须同步更新 Dockerfile、Compose、CI、示例配置，并重新执行 fresh 与 legacy-upgrade smoke。不得回退到 `0.39.5`，该版本早于官方 `0.39.7` 安全修复。
10. `TIKTOK_DIRECT_POST_AUDITED` 默认并必须保持 `false`，直到 TikTok 明确批准当前 API client。未审核时仅允许 `SELF_ONLY`；每个账号都必须实时读取 Creator Info、显式选择隐私/互动/商业披露并确认音乐使用，素材变更后确认失效。生产 worker 会在上传前再次校验 creator 权限与视频时长。

渲染服务必须显式保留以下字节上限：单个内联/数字员工素材 25 MiB、单次素材总量 75 MiB、最终渲染输出 512 MiB。对应配置为 `RENDER_INLINE_ASSET_MAX_BYTES=26214400`、`RENDER_INLINE_TOTAL_MAX_BYTES=78643200`、`DIGITAL_EMPLOYEE_RENDER_MAX_ASSET_BYTES=26214400`、`DIGITAL_EMPLOYEE_RENDER_MAX_TOTAL_BYTES=78643200`、`DIGITAL_EMPLOYEE_RENDER_MAX_OUTPUT_BYTES=536870912`。提高这些上限前必须重新评估容器内存、临时盘、超时和并发预算。

口播默认限制为 5000 字符、15 MiB 原始响应、60 秒最终时长和 90 秒总超时。合成后会转为租户私有的 24kHz 单声道 WAV，按输入指纹幂等复用；`DIGITAL_EMPLOYEE_TTS_CACHE_VERSION` 只能在明确需要整体失效旧口播时递增。DashScope 返回的音频下载地址仅允许 `DASHSCOPE_TTS_AUDIO_HOST_SUFFIXES` 中的公网 HTTPS 后缀，不允许跳转。

## 迁移前检查

1. 先执行一次加密全量备份，并在隔离目录完成解密、外层 checksum 和逐文件 checksum 校验。
2. 检查现有数据是否违反即将创建的唯一键，重点包括：
   - `posts(tenant_id, track_code)`；
   - `scripts(tenantId, idempotency_key)` 非空值；
   - `weekly_plans(tenant_id, goal_id, version)`；
   - active `handoff_sessions(tenant_id, task_id)`；
   - `digital_employee_outbox(tenant_id, event_id)`；
   - `webhook_message_receipts(tenant_id, provider, message_id)`。
3. 唯一键冲突必须先人工确认并清理；迁移失败不能通过删除索引或放宽原子语义绕过。
4. PocketBase 启动并完成迁移后，应用启动命令会执行 `setup:pb`。额外执行 `npm run setup:pb -- --check`，任何 schema/index drift 都阻止流量切入。

## 健康、流量与告警

- `GET /api/overseas/livez`：仅存活探针。
- `GET /api/overseas/readyz`：生产流量门禁；PocketBase 不可用、canonical schema 漂移、关键 worker 心跳中断或进程 draining 时返回 503。
- `GET /api/overseas/metrics`：生产需 `Authorization: Bearer <METRICS_TOKEN>`。
- `/api/overseas/health` 仅为旧客户端兼容，不能用于编排 readiness。

至少配置以下告警：readyz 连续失败、HTTP 5xx、PocketBase 请求错误、worker heartbeat stale、outbox pending 最老年龄、outbox dead-letter、定时发布 `reconciliation_required`、磁盘使用率 80%/85%、容器重启次数和备份任务失败。

## WhatsApp 消息对账

Meta 入站消息会先以 `(tenant_id, provider, message_id)` 原子占位，处理完成后才返回 200。进程崩溃、处理异常或租约过期时记录进入 `needs_reconciliation`；系统不会自动重放，因为客户状态、询盘指标或外发回复可能已经发生。该状态只会让 readyz 显示 `degraded`，不会把历史单条失败变成全站不可用。

1. 管理员通过 `GET /api/overseas/admin/webhook-reconciliation?status=needs_reconciliation` 获取待处理记录；响应不含客户消息正文和平台密钥。
2. 按 `tenantId`、`messageId` 在 WhatsApp Manager、客户会话和审计记录中核对是否已处理；如状态不完整，先人工补齐客户/互动/指标，禁止直接重发原消息或自动回复。
3. 使用 `POST /api/overseas/admin/webhook-reconciliation/:id/resolve`，提交当前 `expectedRevision`、`resolution=verified_processed` 或 `manually_repaired`，并填写 3–2000 字符的 `note`。接口使用 CAS，过期页面会返回 409，不会覆盖另一位管理员的处理。
4. 每次处理均写入 `audit_logs`。仅在待处理数量归零后关闭告警；不得删除 receipt 或唯一索引来恢复自动重放。

WhatsApp 出站请求统一设置供应商超时并持久化平台 message ID。网络中断、超时、5xx、成功但缺少 message ID，或多气泡部分发送都属于结果不确定：自动回复会转人工、草稿被清除，API 返回 `needs_reconciliation`，在平台侧核对前禁止重试。

## 备份

备份同时覆盖 PocketBase 和 `/app/data`，停止写入服务取得一致快照，生成逐文件 SHA-256 后再用 age 加密：

```bash
AGE_RECIPIENT='age1...' BACKUP_DIR=/secure/lingshu-backups npm run backup:production-data
```

`BACKUP_DIR` 必须显式设为仓库外绝对非符号链接目录；自定义生产配置用 `COMPOSE_ENV_FILE=/absolute/path/to/env`。脚本会核对配置中的两个外部 volume 名、Docker volume 身份、唯一运行容器和实际 mount，绝不回退到项目目录中的 `./data`/`./pb_data`。v3 包记录数据库实际 migration history、PocketBase runtime、Git revision、镜像和源卷身份。取得快照后服务会先恢复并通过 readyz，再执行耗时的压缩/加密；最终 payload 与 manifest 通过同文件系统 rename 发布。

## 恢复演练与正式恢复

默认恢复是非破坏性的，只通过同父目录原子 rename 写入仓库外、尚不存在的绝对目录。未设置 `RESTORE_DIR` 时使用仓库同级的 `lingshu-restore`；相对路径、仓库内路径、符号链接或任何已存在目录都会被拒绝：

```bash
AGE_IDENTITY=/secure/backup-key.txt \
RESTORE_DIR=/srv/lingshu-restore-drill \
npm run restore:production-data -- /secure/lingshu-backups/lingshu-production-YYYYMMDDTHHMMSSZ.tar.gz.age
```

只有获得明确生产恢复授权后，才能加 `RESTORE_APPLY=true`。还必须同时提供与目标卷完全一致的双重确认：

```bash
RESTORE_APPLY=true \
RESTORE_DIR=/srv/lingshu-restore-apply-YYYYMMDDTHHMMSSZ \
COMPOSE_ENV_FILE=/etc/lingshu-ai/env \
RESTORE_CONFIRM_PB_VOLUME=lingshu-production-pb-data \
RESTORE_CONFIRM_APP_VOLUME=lingshu-production-app-data \
AGE_IDENTITY=/secure/backup-key.txt \
npm run restore:production-data -- /secure/backup.tar.gz.age
```

正式恢复只接受 v3 包，会验证 SQLite、完整 migration history、目标 PB runtime/镜像、唯一容器和精确卷身份，再生成本机 rollback snapshot。恢复后 readyz 未通过时脚本自动回滚；自动回滚失败时 plaintext snapshot 与 `RESTORE-FAILURE.txt` 会保留在脚本打印的唯一目录，禁止盲目重试，必须停止切流并进入人工故障处理。

## 回滚判定

出现任一情况立即停止切流并回滚：migration/schema check 失败、readyz 在变更窗口内持续 503、CAS endpoint 非预期 404/400、worker 无心跳、outbox dead-letter 增长、发布出现重复或 reconciliation 告警。

应用代码回滚不能单独假设数据库向后兼容。先确认旧版本可读取新字段；如需回滚 migration，必须先保留新备份并验证 down migration 不会删除仍需保留的数据。
