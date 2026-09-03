# 灵枢生产备份与 R2 异地保存

> 完整的恢复、回滚和变更窗口规则以 [`production-readiness-runbook.md`](./production-readiness-runbook.md) 为准。

## 唯一受支持的生产备份

生产灾备只认可 `scripts/backup-production-data.sh` 生成的 v3 加密包。应用不再把 WhatsApp 客户或交互 JSON 明文上传到对象存储；这类导出既不是一致性快照，也会扩大客户隐私数据的暴露面。备份脚本会先停 app、再停 PocketBase，从两个外部 Docker volume 取得一致快照，随后立即恢复服务；压缩和加密不占用停机窗口。包内记录逐文件 SHA-256、数据库实际 migration history、PocketBase runtime、Git revision、镜像与源卷身份。

## 1. 生成加密一致性备份

事先在离线介质保存 age identity，生产主机只需要 recipient。

```bash
AGE_RECIPIENT='age1...' \
BACKUP_DIR=/secure/lingshu-backups \
COMPOSE_ENV_FILE=/etc/lingshu-ai/env \
bash deploy/backup.sh
```

`BACKUP_DIR` 必须是仓库外的绝对、非符号链接目录；不再提供仓库内默认值。`COMPOSE_ENV_FILE` 可指向自定义生产 env 文件，但必须是可读的普通非符号链接文件。备份前脚本会核对 env 中的两个外部 volume 名、Docker volume 身份与唯一运行中的 app/PocketBase 容器 mount。容器缺失、被扩容、未运行或 mount 不匹配时必须停止，不会回退备份仓库里的 `./data` 或 `./pb_data`。命令必须同时生成：

- `lingshu-production-<UTC timestamp>.tar.gz.age`
- `lingshu-production-<UTC timestamp>.manifest.txt`

两者权限必须为 0600。旧 `pb_data_*.tar.gz`/`app_data_*.tar.gz` 明文流程已禁用。

## 2. 复制到 R2 或其他独立故障域

只上传 `.age` 和对应 manifest，不要上传解密后的 tar 或 age identity。例如：

```bash
rclone copy /secure/lingshu-backups/ r2:overseas-assets/lingshu-production-backups/ \
  --include '*.tar.gz.age' --include '*.manifest.txt' --progress
```

复制后逐个比对 manifest，并为 bucket 启用版本保留、最小权限凭证和独立告警。不得只保留在生产主机本地磁盘。

## 3. 每月隔离恢复演练

默认恢复不会触碰生产 volume，只解密、检查归档路径、逐文件 checksum、SQLite `quick_check` 和 migration history，然后通过同父目录 rename 原子写入仓库外的绝对新目录。未设置 `RESTORE_DIR` 时使用仓库同级的 `lingshu-restore`；相对路径、仓库内路径、符号链接或任何已存在目录都会被拒绝：

```bash
AGE_IDENTITY=/secure/offline/backup-key.txt \
RESTORE_DIR=/srv/lingshu-restore-drill-$(date +%Y%m%d) \
npm run restore:production-data -- \
  /secure/lingshu-backups/lingshu-production-YYYYMMDDTHHMMSSZ.tar.gz.age
```

演练成功标准：

1. 外层 manifest 校验通过；
2. 归档不含绝对路径、路径穿越、链接或特殊文件；
3. `BACKUP-CONTENTS.sha256` 覆盖且只覆盖 `pb_data/` 和 `data/` 内全部普通文件；
4. v3 `BACKUP-METADATA.txt` 的文件数、实际 schema、PocketBase 版本、镜像/卷身份可识别，`PB-MIGRATIONS.txt` 与 `data.db` 完全一致；
5. 在隔离 PocketBase/应用实例上执行 schema check、登录、客户与素材抽样。

## 4. 正式恢复

正式恢复是破坏性生产变更，必须在当前任务中获得明确授权。除 age identity 外，还要求对两个目标 volume 名做双重精确确认：

```bash
RESTORE_APPLY=true \
RESTORE_DIR=/srv/lingshu-restore-apply-YYYYMMDDTHHMMSSZ \
COMPOSE_ENV_FILE=/etc/lingshu-ai/env \
RESTORE_CONFIRM_PB_VOLUME=lingshu-production-pb-data \
RESTORE_CONFIRM_APP_VOLUME=lingshu-production-app-data \
AGE_IDENTITY=/secure/offline/backup-key.txt \
npm run restore:production-data -- /secure/lingshu-backups/<backup>.tar.gz.age
```

目标卷名默认从 `COMPOSE_ENV_FILE` 唯一读取，也可由同名进程环境变量显式覆盖；两个确认值必须逐字匹配。脚本要求每个 service 恰好一个目标容器，核对容器 mount 与 Docker volume 身份，并要求目标 PocketBase 与备份保持相同 major/minor、patch 不低于备份且镜像包含备份 migration。v2 包只允许隔离提取，禁止 live apply。

脚本在替换数据前生成本地 plaintext rollback snapshot，恢复后等待 `readyz`。如果健康校验失败，会自动尝试回滚；若自动回滚任一步骤或 readiness 失败，snapshot 不会删除，并会写入 `RESTORE-FAILURE.txt`、打印唯一保留路径。此时必须限制访问、复制到批准的事件目录、停止切流并转人工处理。

## 5. 数据位置提醒

Compose 生产数据位于 `PB_DATA_VOLUME_NAME` 和 `APP_DATA_VOLUME_NAME` 指定的外部 Docker volume。项目目录中的 `./pb_data` 和 `./data` 不是生产恢复目标；向这两个目录解压不会替换容器实际数据。
