# 平台生产接入准备（2026-10-10）

本次结果是代码审计、无 secret 模板和离线受控验证，不是生产授权或平台审批证据。没有读取或导出现有 OAuth 配置、账号 token；没有启动真实 OAuth、触发外发、付费请求或执行迁移。运行时准备与真实平台可用性必须分别验收。

## 操作清单

| 阶段 | 操作 | 可保存的证据 | 完成标准 |
| --- | --- | --- | --- |
| 配置责任人 | 确认 tenant、操作者、目标账号和 app 的归属；核对 tenant app 完整性；租户调用禁止回退到全局 app | 内部证据编号，不记录 secret | 每个 tenant 的 app/账号关系明确 |
| 配置模板 | 按 [env 模板](../../fixtures/platform-production-readiness/shared.env.example)核对变量名；私密值仅进入密钥存储 | 配置是否存在、配置版本、管理员确认 | 未配置项不得替换为随意默认值 |
| Schema | 逐平台核对现有 migration、数据字段及加密方式 | schema 版本、部署环境核查结果 | 仅审计；本轮不执行 migration |
| Callback | 确认 PUBLIC_BASE_URL、反向代理、HTTPS 和逐条 callback URL；核对平台控制台的精确匹配 | URL、控制台配置证据编号 | 无通配猜测，无 production 域名假设 |
| OAuth 安全 | 审核 state 签名、过期、tenant/user/app 绑定与一次性消费 | 受控测试报告、待修复事项 | 正式 social callback 在交换前原子消费持久 nonce；生产存储缺少唯一原子约束则拒绝 |
| 平台审批 | 核对 app 产品、权限 review、Business Verification 与 TikTok Direct Post audit | 平台批准记录及 app ID/版本 | 环境 flag、用户授权 scope 或 mock probe 均不能替代批准 |
| 账号授权 | 由账户责任人后续在批准窗口执行真实授权，核对返回身份与资产归属 | 脱敏身份、scope、有效期、证据编号 | 本轮不执行该操作 |
| Capability | 使用已批准账号核对真实读权限、发布或消息 capability | 同 tenant/account/native identity 的 probe 结果及有效期 | 历史缓存和 connected 状态不足以证明权限 |
| Receipt | 对原 attempt 保存初始化、容器/媒体/消息回执；未知结果只沿原记录对账 | attempt ID、公开平台 ID、验证报告 | 禁止伪造 receipt、由容器猜媒体、盲目重发 |
| 发布许可 | code gap 与外部证据全部完成后，由责任人批准具体生产验证动作 | 精确目标、内容、预算和批准编号 | 本文件不会自动授予发布权限 |

## 分平台清单与模板

- [Meta Social / Instagram Login](platform-meta-instagram-readiness.md)，[无 secret 模板](../../fixtures/platform-production-readiness/meta-instagram.json)。两套 IG OAuth 的 host、token 和 scope 不可混用。
- [TikTok Direct Post](platform-tiktok-readiness.md)，[无 secret 模板](../../fixtures/platform-production-readiness/tiktok.json)。本轮补充运行时 creator/attempt/receipt 安全；平台审核和真人授权仍是外部门禁；内部正式审批 UX 已接线。
- [WhatsApp / Messenger / Instagram 消息账号](platform-messaging-readiness.md)，[无 secret 模板](../../fixtures/platform-production-readiness/messaging.json)。本轮修复 WhatsApp 路由、资产证明与逐条重验；Messenger 已核验实际 grants、Page 身份及订阅回读；真实平台授权仍需独立验收。

## 离线验证

从仓库根目录使用已有 Node 与 tsx 执行：

```sh
node scripts/platform-production-readiness.controlled.mjs
```

runner 只向子进程传递显式允许的环境变量，使用临时 OAuth/渠道配置路径与假测试密钥，不继承生产凭据、数据库配置、NODE_OPTIONS 或 dotenv。预加载 guard 拒绝 fetch、HTTP(S)、socket、TLS 与 DNS；测试使用纯函数、内存存储或假 provider。测试文件是固定允许列表，runner 不接受 URL、token 或发布参数。退出码 0 仅证明这些受控合同成立，不能证明真实账号授权或平台审批通过。

本轮 TikTok 运行链路的独立假 provider 集成测试另见 `server/publishing/tiktokDirectPostDurability.integration.test.ts`。其日志与完整 TypeScript 检查结果需随独立代码提交记录；文档/模板/测试准备提交与 TikTok runtime 提交分别保存。

## 内部已关闭与外部待办

| 项目 | 内部合同与受控结果 | 外部待办 |
| --- | --- | --- |
| OAuth nonce | 先持久发行，再一次性消费；并发与重启重放拒绝；绑定 tenant/user/platform/app 凭据与精确 callback URI | 真实账号 OAuth grant（本轮不执行） |
| OAuth fallback | tenant app 缺失、重复、不完整一律拒绝；生产 callback 不借用 Host/Forwarded header | 真实 app 审核与账号 grant |
| Messenger grants/资产 | 读取 debug_token 实际 scopes、PAGE/app/native Page；订阅 success=true 且回读本 app 的 fields；短期证明绑定 tenant/account/Page/token；读取与发送拒绝旧 seed 或漂移证明 | App Review/Business Verification、真实 Page grants、账户管理员授权 |
| TikTok 审批 UX | 正式外部视频审批页读取最新 creator；隐私无默认、互动默认关闭并受账号限制；商业披露、音乐声明及明确授权；创建前预览编辑；choices 与 creator HMAC 纳入审批 hash，创建/审批/发布前重验 | Direct Post 平台 audit、真实 creator 授权、平台对提交的产品审核材料验收 |

WhatsApp 已按前端实际路径 `/api/oauth/whatsapp` 挂载，旧账号缺资产证明须重新授权。读取仅返回当前已验证消息投影；发送逐条重验。Messenger 旧记录只有 `messengerSubscribed=true` 或请求 scope 时不会获得能力，证明过期需执行受鉴权的只读能力刷新并验证实际 grants，不能自动重新订阅或发送。

真实账号授权、平台审核及真实端到端验收保持未完成；本轮受控通过不授予生产授权。TikTok 未开放的 URL pull 模式和自动 token 刷新列为非启用能力：当前已实现的 FILE_UPLOAD 路径仍受平台 audit 门禁，失效 token 拒绝并需要由用户重新授权，不把未实现能力当作已批准功能。
