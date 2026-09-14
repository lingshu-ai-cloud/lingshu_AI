# Demo 部署说明

目标：给意向客户提供可外网访问的演示环境，重点保证完整试用链路顺畅，真实社媒/电商平台外发默认模拟。

## 环境

- Node.js 22.19+
- pnpm 11.19.0（Corepack）
- PocketBase
- Nginx + HTTPS
- 建议海外区域：新加坡优先，其次美国西部

## 初始化

```bash
cp .env.demo.example .env
corepack enable
pnpm install --frozen-lockfile
pnpm run demo:seed
pnpm run build
pnpm run start
```

## Demo 开关

`.env` 中开启：

```bash
DEMO_MODE=true
DEMO_ALLOWED_ACCOUNTS=test1@example.com,test2@example.com
DEMO_DAILY_AI_CHAT_LIMIT=20
DEMO_DAILY_GENERATION_LIMIT=10
DEMO_DAILY_RENDER_LIMIT=3
DEMO_INVITE_CODE=your-demo-code
```

试用时长固定为 5 天。注册/登录白名单会读取 `DEMO_ALLOWED_ACCOUNTS` 和 `data/demo-account-registry.json`；隔离演示环境需显式保留 `ENABLE_LOCAL_DEV_FALLBACK=true`，同时用 `openssl rand -base64 48` 生成并持久化 `LOCAL_DEMO_TOKEN_SECRET`（所有实例必须相同），再执行 `pnpm run demo:sync-accounts` 把测试账号和管理员账号同步到 PocketBase。正式客户环境不得开启该回退或注入演示账号。`DEMO_INVITE_CODE` 可留空；设置后注册还必须填写一致的邀请码。

## PM2 示例

```bash
pm2 start "pnpm run start" --name overseas-demo
pm2 save
```

## Nginx 示例

```nginx
server {
  server_name demo.example.com;

  location / {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 健康检查

```bash
curl https://demo.example.com/api/overseas/health
```

返回中包含 `demoMode` 和 `demoLimits`。

## 重置演示数据

```bash
pnpm run demo:reset
```

当前模板是占位模板，等行业信息确认后替换 `data/demo-templates.json` 即可。
