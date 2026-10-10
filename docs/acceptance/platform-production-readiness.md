# 平台生产接入准备（2026-10-10）

本次结果是代码审计、无 secret 模板和离线受控验证，不是生产授权或平台审批证据。没有读取或导出现有 OAuth 配置、账号 token；没有启动真实 OAuth、触发外发、付费请求或执行迁移。运行时准备与真实平台可用性必须分别验收。

## 操作清单

| 阶段 | 操作 | 可保存的证据 | 完成标准 |
| --- | --- | --- | --- |
| 配置责任人 | 确认 tenant、操作者、目标账号和 app 的归属；审阅 tenant app 到全局配置的 fallback 策略 | 内部证据编号，不记录 secret | 每个 tenant 的 app/账号关系明确 |
| 配置模板 | 按 [env 模板](../../fixtures/platform-production-readiness/shared.env.example)核对变量名；私密值仅进入密钥存储 | 配置是否存在、配置版本、管理员确认 | 未配置项不得替换为随意默认值 |
| Schema | 逐平台核对现有 migration、数据字段及加密方式 | schema 版本、部署环境核查结果 | 仅审计；本轮不执行 migration |
| Callback | 确认 PUBLIC_BASE_URL、反向代理、HTTPS 和逐条 callback URL；核对平台控制台的精确匹配 | URL、控制台配置证据编号 | 无通配猜测，无 production 域名假设 |
| OAuth 安全 | 审核 state 签名、过期、tenant/user/app 绑定与一次性消费 | 受控测试报告、待修复事项 | 签名和有效期不等于已经完成 durable nonce 消费 |
| 平台审批 | 核对 app 产品、权限 review、Business Verification 与 TikTok Direct Post audit | 平台批准记录及 app ID/版本 | 环境 flag、用户授权 scope 或 mock probe 均不能替代批准 |
| 账号授权 | 由账户责任人后续在批准窗口执行真实授权，核对返回身份与资产归属 | 脱敏身份、scope、有效期、证据编号 | 本轮不执行该操作 |
| Capability | 使用已批准账号核对真实读权限、发布或消息 capability | 同 tenant/account/native identity 的 probe 结果及有效期 | 历史缓存和 connected 状态不足以证明权限 |
| Receipt | 对原 attempt 保存初始化、容器/媒体/消息回执；未知结果只沿原记录对账 | attempt ID、公开平台 ID、验证报告 | 禁止伪造 receipt、由容器猜媒体、盲目重发 |
| 发布许可 | code gap 与外部证据全部完成后，由责任人批准具体生产验证动作 | 精确目标、内容、预算和批准编号 | 本文件不会自动授予发布权限 |

## 分平台清单与模板

- [Meta Social / Instagram Login](platform-meta-instagram-readiness.md)，[无 secret 模板](../../fixtures/platform-production-readiness/meta-instagram.json)。两套 IG OAuth 的 host、token 和 scope 不可混用。
- [TikTok Direct Post](platform-tiktok-readiness.md)，[无 secret 模板](../../fixtures/platform-production-readiness/tiktok.json)。本轮补充运行时 creator/attempt/receipt 安全；平台审核、产品 UX、真人授权仍是未完成门禁。
- [WhatsApp / Messenger / Instagram 消息账号](platform-messaging-readiness.md)，[无 secret 模板](../../fixtures/platform-production-readiness/messaging.json)。本轮修复 WhatsApp 路由、资产证明与逐条重验；Messenger 等剩余事项和真实平台授权仍需分别验收。

## 离线验证

从仓库根目录使用已有 Node 与 tsx 执行：

```sh
node scripts/platform-production-readiness.controlled.mjs
```

runner 只向子进程传递显式允许的环境变量，使用临时 OAuth/渠道配置路径与假测试密钥，不继承生产凭据、数据库配置、NODE_OPTIONS 或 dotenv。预加载 guard 拒绝 fetch、HTTP(S)、socket、TLS 与 DNS；测试使用纯函数、内存存储或假 provider。测试文件是固定允许列表，runner 不接受 URL、token 或发布参数。退出码 0 仅证明这些受控合同成立，不能证明真实账号授权或平台审批通过。

本轮 TikTok 运行链路的独立假 provider 集成测试另见 `server/publishing/tiktokDirectPostDurability.integration.test.ts`。其日志与完整 TypeScript 检查结果需随独立代码提交记录；文档/模板/测试准备提交与 TikTok runtime 提交分别保存。

## 本轮仍需跟踪的门禁

Meta signed-state fallback 的 durable nonce 消费尚未由生产路径证明；tenant app fallback 策略需明确。WhatsApp OAuth 已按前端实际路径 `/api/oauth/whatsapp` 挂到生产父路由，新增 app/token/WABA/phone 证明及逐条发送/读取校验；旧记录没有该证明时须重新授权。正式客户读取使用 `authorizedCustomerRead.ts`，只由当前资产的已验证消息重建客户内容；旧摘要、档案与草稿不返回，并在返回前重验授权及版本。Messenger 订阅 success 和实际授予权限证明仍需修复/验证。TikTok 每次查询 creator 信息与回执持久化不替代 creator 展示、无默认 privacy 选择、preview/edit、商业披露、music terms 和平台 audit。各分平台清单给出代码位置及官方来源，不通过 env 开关把这些门禁标成已完成。
