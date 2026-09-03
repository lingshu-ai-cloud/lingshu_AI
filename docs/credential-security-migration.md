# 凭据安全迁移与强制轮换

本版本停止保存、解密或向管理端返回客户密码。PocketBase 只保留认证所需的密码哈希；注册、登录和改密流程不会再把密码同步到 tenant 或 demo registry。

## 上线前迁移顺序

1. 在隔离且加密的介质中备份 PocketBase 和本地 `data/`，限制备份读取者并记录销毁期限。备份仅用于灾难恢复，禁止从中恢复密码展示功能。
2. 先部署 PocketBase hook，再运行 `npm run setup:pb`。setup 会：
   - 增加 invite claim 字段和单次邀请码索引；
   - 将 `users.tenantId`、`users.role` 迁移为必填字段；未知 legacy role 按最小权限迁为 `customer_service`；
   - 将 `WORKBENCH_ADMIN_EMAIL` 对应用户明确设为 `super_admin`；
   - 检测并阻止同一 tenant 的多个 `super_admin`；
   - 清空 legacy `registeredPasswordCipher`。
3. 启动应用前运行 `npm run test:credential-hardening`、`npm run test:storage-hardening` 和 `npm run lint`。`setup:pb -- --check` 必须无 schema drift。
4. 清理 `data/demo-account-registry.json` 及其备份中的 `password`、`rotationPassword`。运行时读取 registry 时也会自动移除这些字段。不要把清理前文件写回生产。

## 平台 OAuth 与账号 Token 迁移

1. 为 `CREDENTIAL_ENCRYPTION_KEY` 生成独立的 32 字节密钥，不得与 `TENANT_PLATFORM_APP_KEY`、数据库密码或其他签名密钥复用。格式与保管要求见 `docs/credential-encryption-key.md`。
2. `1788307205_encrypt_platform_credentials.js` 会清空无法认证的 legacy 明文和旧 `v1:` 密文，并把相关账号标记为 `expired` / `reconnect_required`。这是有意的 fail-closed 行为；迁移前先盘点需要重新授权的客户。
3. `data/oauth-config.json` 中的 legacy 明文不会再被读取。上线后由管理员重新录入全局应用 Secret；GET/status API 只返回 `configured` 和固定掩码。
4. 完成 Google、Meta、TikTok、WhatsApp 重连后，验证 PocketBase 中只存在 `cred:v1:` envelope，并销毁旧明文备份。不得通过脚本把未知旧值直接包成新密文。

## 强制轮换策略

凡是曾存在 `registeredPasswordCipher`、registry 明文密码或可预测的试用轮换密码的账号，都视为凭据已暴露，不能因为密文尚未泄漏而豁免。

1. 导出受影响邮箱清单后立即清空 recoverable 字段；清单不得包含密码或密文。
2. 通过 PocketBase 的一次性密码重置流程逐一使旧密码失效。不能完成重置的账号应禁用，不得继续使用旧密码兜底。
3. 注销/撤销受影响用户的现有认证会话，并确认旧密码、旧 token 都无法访问受保护 API。
4. 试用账号重新预配时，密码只能从部署 secret 注入（`DEMO_ACCOUNT_PASSWORDS_JSON`），不可写回 registry、日志或管理端响应。
5. 所有受影响账号完成重置并验证后，轮换或销毁旧 `REGISTRATION_CREDENTIAL_KEY`；该 key 不再用于运行时凭据恢复。

## 验收与回滚边界

- 并发提交同一邀请码时只能有一个 claim 成功；用户创建或 invite finalize 失败时，只有确认用户回滚成功才释放 claim，否则保持锁定并人工恢复。
- `GET /api/admin/demo-accounts` 的任意对象都不得包含 `password` 或 `rotationPassword`。
- legacy 明文和 `v1:` 密文传给兼容解密函数都必须返回空值。
- 回滚代码时也不得恢复密码展示/同步逻辑；若旧版本依赖该逻辑，应停止回滚并修复旧版本，而不是恢复 recoverable 凭据。
- 备份超过审计保留期后应安全销毁，并记录销毁时间与执行人。

## 中断注册的人工恢复

当 API 返回“邀请码已安全锁定”时，不要直接清空 claim。先按 tenant 检查 `users`：

- 已存在 `super_admin`：核对其邮箱与 `registrationClaimEmail`，再用当前 claim token 做 compare-and-set finalize，写入 `registrationInviteCode`/`registeredEmail` 并清空 claim。
- 不存在用户：确认 user create 已失败或孤儿用户已删除后，才可用当前 claim token compare-and-set 清空 `registrationClaimToken`、`registrationClaimedAt`、`registrationClaimEmail`。
- 状态无法确认：保持 claim，不复用邀请码。单 tenant 的 `super_admin` 唯一索引是最后一道并发门禁，不得删除或绕过。
