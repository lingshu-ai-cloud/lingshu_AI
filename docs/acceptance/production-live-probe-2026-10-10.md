# 生产环境只读连通性复核（2026-10-10）

候选代码：`9a441eaa00899e190a3b6866d485ef12c53e14b3`。本次仅执行无认证 GET 和无凭据 SSH 握手检查；未登录、未读取服务器文件、未连接数据库或队列、未触发 worker、迁移、发布、消息或部署。

## 公网结果

| 目标 | 结果 | 结论 |
| --- | --- | --- |
| `https://app.lingshu.site/` | HTTP 200，HTML | 公网页面可访问。 |
| `https://app.lingshu.site/api/overseas/health` | HTTP 200，JSON；service=`overseas-marketing-agent` | 只能证明现网旧服务存活。 |
| `https://app.lingshu.site/api/overseas/ready` | HTTP 200，但返回与首页相同的 HTML | 当前公网服务没有暴露候选代码定义的 JSON readiness 探针；该 200 不能作为 ready。 |

候选源码在 `server/index.ts` 明确定义 `/api/overseas/ready` 为运行依赖检查接口。公网路径落入 SPA HTML fallback，证明现网不在本候选验收状态，不能用 `/health` 的 200 替代。

## SSH 结果

仓库唯一明确记录的目标为 `root@43.159.41.222:22`。严格 known-host、BatchMode、8 秒超时并只执行 `true` 的握手检查结果：

```text
Connection timed out during banner exchange
Connection to 43.159.41.222 port 22 timed out
```

因此无法按仓库规定进入交互式 SSH、核对远端 checkout、运行只读基础设施预检或执行 `bash deploy/update.sh`。没有尝试修改 known_hosts、改端口、使用密码、密钥或替代部署路径。

## 当前阻断

继续生产接入需要可达的 Ubuntu SSH 主机、端口和用户名；凭据只在交互式终端输入。进入服务器后仍必须先核远端 origin、分支、HEAD、工作树、备份、PostgreSQL、Redis/BullMQ、PB 身份依赖、对象存储、平台 OAuth/审批和六类真实运行证据。任何一项不满足都不得把候选标记为生产 ready。
