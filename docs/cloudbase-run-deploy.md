# CloudBase Run 部署说明

目标：把当前工具部署成客户可直接访问的线上链接。当前项目是 React + Express + PocketBase，不是纯静态网页，所以应部署到 CloudBase 云托管 / CloudBase Run。

## 推荐架构

- CloudBase Run：运行主应用，也就是本仓库。
- PocketBase：单独部署，并开启持久化存储。不要把正式数据放在 CloudBase Run 容器本地目录里。
- 对象存储 COS：后续用于长期保存素材、生成视频、封面和音频。

## CloudBase Run 配置

使用仓库根目录的 `Dockerfile` 构建。

服务端口：

```bash
8788
```

构建过程会执行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

启动命令已写在镜像里：

```bash
pnpm run start
```

## 必填环境变量

在 CloudBase Run 服务的环境变量中配置：

```bash
PB_URL=https://your-pocketbase.example.com
PB_ADMIN_EMAIL=your-admin@example.com
PB_ADMIN_PASSWORD=your-strong-password
RENDER_TOKEN_SECRET=change-to-a-long-random-secret
TENANT_PLATFORM_APP_KEY=generate-with-openssl-rand-base64-32
PUBLIC_BASE_URL=https://your-cloudbase-domain.example.com
QUOTE_SKILL_ENABLED=true
# 首次发布建议只填写内部测试租户 ID；多个租户用逗号分隔，留空表示全部租户。
QUOTE_SKILL_TENANT_ALLOWLIST=your-internal-tenant-id
```

至少配置一个大模型服务：

```bash
GEMINI_API_KEY=your-key
```

或：

```bash
OVERSEAS_LLM_BACKEND=qwen
DASHSCOPE_API_KEY=your-key
```

如需启用视频生成，再配置：

```bash
SEEDANCE_API_KEY=your-key
SEEDANCE_VIDEO_ENABLED=true
```

## PocketBase migration

正式 schema 的唯一写入源是仓库 `pb_migrations/`。推荐使用仓库的 `Dockerfile.pocketbase` 部署独立 PocketBase，并把该目录只读挂载到它的 migrations 目录；PocketBase 启动时会按版本自动执行。

不要把 `pnpm run setup:pb` 加入应用启动命令，也不要让多个应用副本并发补表。升级前先备份目标实例，并在隔离副本跑 migration preflight 与恢复演练。

## 健康检查

部署完成后访问：

```bash
https://your-domain.example.com/api/overseas/ready
```

正常会返回：

```json
{
  "status": "ready",
  "issues": []
}
```

## 重要注意

CloudBase Run 容器本地目录适合临时文件，不适合保存正式客户数据。当前代码里仍有一部分素材、项目草稿、音频和封面默认写入 `data/` 目录；正式商用前建议迁移到 COS 或 PocketBase 文件字段。

本演示版的灵感大屏视频文件已随仓库放在 `data/media/`，CloudBase Run 必须用 Dockerfile 构建完整应用，不能只部署 `dist/` 静态前端。部署后可访问任意 `/media/<文件名>` 检查视频文件是否随镜像发布成功。

如果灵感大屏页面显示“暂无真实视频数据”，这是该租户当前没有真实记录，不应给正式租户导入演示数据。仅在隔离 demo 环境明确启用 `ENABLE_LOCAL_DEV_FALLBACK=true` 后，才可执行演示初始化命令。

```bash
pnpm run demo:sync-accounts
pnpm run import:trend-videos
```

导入完成后仅用测试账号验收，禁止把该流程用于正式客户租户。

如果只做小范围演示，可以先用 CloudBase Run + 外部 PocketBase 跑起来；如果要给付费客户长期使用，应优先完成文件存储迁移和定期备份。
