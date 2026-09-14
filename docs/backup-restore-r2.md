# 灵枢生产备份与恢复

生产恢复的权威工件是一个同时包含 PocketBase `pb_data` 与应用 `data/` 的 age 加密快照，以及配套 SHA-256 清单。应用内的每日 R2 JSON 同步只是一层增量保护，不能代替完整快照。

## 准备 age 密钥

在受控机器生成身份文件；身份文件不得进入仓库或普通服务器目录：

```bash
age-keygen -o /secure/lingshu-backup.agekey
chmod 600 /secure/lingshu-backup.agekey
age-keygen -y /secure/lingshu-backup.agekey
```

最后一条输出的 `age1...` 是公钥，可以提供给备份服务器；私钥只能交给获准执行恢复的人。

## 创建完整快照

在仓库根目录执行：

```bash
AGE_RECIPIENT=age1... pnpm run backup:production-data
```

`deploy/backup.sh` 委托给同一个实现。脚本会：

1. 记录 app/PocketBase 原先是否运行，并只暂停正在运行的服务；
2. 一致性复制 PocketBase volume 与 `data/`；
3. 在临时目录内打包并直接加密，不把明文归档写入备份目录；
4. 生成 `lingshu-production-<UTC>.tar.gz.age` 和同名 `.manifest.txt`；
5. 恢复备份前的服务运行状态。

`AGE_RECIPIENT`、age、应用数据、Docker Compose 或 PocketBase 容器缺失时会失败，不会退化成未加密备份，也不会在生产环境自动改读可能陈旧的本地 `pb_data/`。

仅在隔离的本地/离线目录、明确知道 `PB_DATA_DIR` 是目标数据源时，才可显式选择文件系统模式：

```bash
BACKUP_SOURCE_MODE=local-filesystem \
PB_DATA_DIR=/isolated/pb_data \
APP_DATA_DIR=/isolated/data \
AGE_RECIPIENT=age1... \
  bash scripts/backup-production-data.sh
```

`deploy/backup.sh`、更新前快照和线上恢复前快照都会强制使用 `production-docker`，不会继承这个离线选择。

## 异地保存

把 `.tar.gz.age` 和 `.manifest.txt` 一起上传到受控对象存储。示例：

```bash
rclone copy ./backups r2:overseas-assets/lingshu-full-backups --include '*.tar.gz.age' --include '*.manifest.txt'
```

对象存储应启用版本控制/保留策略，并限制删除权限。只上传清单而漏掉密文，或只上传密文而漏掉清单，都不算可恢复备份。

## 必做：非破坏性恢复演练

先下载一对密文与清单，在隔离机器或隔离目录执行：

```bash
AGE_IDENTITY=/secure/lingshu-backup.agekey \
  pnpm run restore:production-data -- backups/lingshu-production-20260914T000000Z.tar.gz.age
```

默认只会：

- 校验 SHA-256；
- 验证 age 认证解密；
- 拒绝绝对路径、`..` 穿越和 `pb_data`/`data` 之外的归档成员；
- 解压到新的 `restore/<UTC>/` 目录。

它不会替换线上数据，也不会覆盖已有演练目录。演练后至少检查 PocketBase 能启动、migration 状态正常、客户/素材数量合理，以及 `/api/overseas/ready` 返回 `status=ready`。

## 替换线上数据

仅在已经完成上述演练、明确选择目标服务器和备份版本后执行：

```bash
AGE_IDENTITY=/secure/lingshu-backup.agekey \
AGE_RECIPIENT=age1... \
RESTORE_APPLY=true \
RESTORE_CONFIRM=replace-live-data \
  pnpm run restore:production-data -- backups/lingshu-production-20260914T000000Z.tar.gz.age
```

线上替换需要两个显式开关，并会先再次创建“当前线上状态”的加密、带校验清单快照。替换期间服务暂停；中途失败时脚本会尝试从临时快照恢复原数据并恢复此前正在运行的服务。不要删除预恢复加密备份，直到业务校验完成。

恢复完成后检查：

```bash
docker compose --env-file .env.production ps
curl -fsS https://你的域名/api/overseas/ready
docker compose --env-file .env.production logs --tail=120 app pocketbase
```

## 应用内 R2 增量备份的边界

`R2_BACKUP_PREFIX` 与 `R2_BACKUP_LOCAL_RETENTION_DAYS` 控制应用内 WhatsApp/本地 JSON 备份上传和本地保留：

```bash
R2_BACKUP_PREFIX=lingshu-backups
R2_BACKUP_LOCAL_RETENTION_DAYS=7
```

这条链路不包含完整 PocketBase volume，也不覆盖所有对象存储素材，因此不能单独用于灾难恢复。它适合辅助找回近期 JSON 状态；完整恢复仍必须使用前述加密快照。

## 运行制度

- 每次更新前创建完整快照；日常至少每日一份并异地保存。
- 至少每月在隔离环境做一次实际恢复演练并保存结果。
- 清单、密文、Git revision、目标环境和演练记录一起归档。
- 定期验证 age 私钥可读；不要在备份服务器上长期保存私钥。
- 容量验收和恢复演练都不得直接触发 AI 生成、消息发送或社媒发布。
