# 企业人物资产：HeyGen 接入与验收

日期：2026-09-15。实施目录：`lingshu-director-integration`。仅本地开发，未部署。

## 用户入口

- 企业知识库 → 社媒策略 → 企业出镜设置 → 添加企业人物。
- 镜头编辑 → 新增人物。两个入口共用同一个页内管理弹窗。
- 创建：名称、照片或视频、声音、使用授权、费用确认 → 保存异步任务 → 本人授权 → 刷新状态 → 预览并添加到企业。
- 导入：公共人物库（分页），或已明确绑定的企业专属 HeyGen 账号人物；不再要求用户复制人物或声音 ID。
- 已添加人物继续使用原有 `ProductionDefaults`，镜头生成接口保持兼容。新导入人物的透明视频能力默认为未核验。

## 真实验证和未验证部分

已通过：

- 使用现有本机 HeyGen 密钥读取公共人物：首批 50 条，均有预览；支持下一页。
- 读取公共声音：首批 100 条，支持下一页。本次返回的声音没有试听 URL，页面提示暂无试听样本。
- 上传一张程序生成的 32×32 纯色 PNG，成功获得资产 ID；随后通过官方删除接口清理该测试资产，HTTP 200。没有上传用户照片、声音或其他个人素材。
- 本地隔离页面使用真实公共人物预览数据验证打开弹窗、列表选择、预览确认、导入和默认人物回显；保存操作只写入测试内存。临时页面已清理。
- 接口模拟测试覆盖照片创建、授权状态、导入、分页、跨企业访问拦截、存储失败、重复请求、请求结果未知、预算阻断及错误信息脱敏。
- 原有数字人镜头回归测试、TypeScript 检查及本地构建。

未进行付费真人训练，也未代替本人完成授权。创建和直接提交授权视频的账号权限仍以真实素材提交后的供应商响应为准。

当前本地已配置密钥；**人物付费创建尚未启用**，需要管理员核对预算并配置下述创建开关。未复制旧验收任务的预算或重置旧账本。

## 服务端配置

密钥保存在被 Git 忽略的 `.env.local`，仅服务端读取，文件权限 0600。

| 配置 | 作用 |
| --- | --- |
| `HEYGEN_API_KEY` | 人物、声音和素材接口凭据 |
| `HEYGEN_GENERATION_ENABLED=true` | 允许付费创建；同时仍受预算和用户确认限制 |
| `STUDIO_PAID_BUDGET_CNY` | 当前预算账本总额，沿用现有规则，不能重置历史费用 |
| `STUDIO_PAID_OPENING_USED_CNY` | 已核对的期初费用 |
| `STUDIO_HEYGEN_RESERVE_CNY`、`STUDIO_ASR_RESERVE_CNY` | 现有公共预算配置所需的其他操作预留 |
| `STUDIO_HEYGEN_AVATAR_RESERVE_CNY` | 每次人物训练独立预留金额；必须显式设置，不能用普通镜头预留估算训练费用 |
| `HEYGEN_DIRECT_CONSENT_ENABLED=true` | 仅在 HeyGen 已批准 Enterprise API 直接提交授权视频权限后启用 |
| `HEYGEN_PRIVATE_ASSET_TENANT_ID` | 可选。仅用于归属明确、专属一个企业的 HeyGen 账号；匹配的已鉴权企业可导入该账号的私有人物。设置后，其他企业不能使用该账号创建人物。共享平台账号不要设置此项 |

预算预留是本地调用准入控制，不是 HeyGen 的最终报价或扣款上限。管理员需要根据实际套餐核对预留金额。

普通账号的本人授权使用官方验证链接，有效期 24 小时；页面可重新获取链接。不能以使用授权勾选框代替供应商的本人验证。直接上传授权视频是 Enterprise API 特殊权限，默认关闭。

## 数据和恢复

- 新表 `studio_presenter_assets`：`tenant_id`、`kind`、`request_id`、`payload`。上传记录与人物创建任务分开标识；不保存素材二进制或密钥。
- 迁移：`pb_migrations/1790208002_create_studio_presenter_assets.js`。仅本机 `localhost:8091` 已创建这张表，未修改远程数据库。
- 唯一索引约束同一企业、任务类型和请求标识；文件锁串行化同企业提交。
- 先保存任务、预留预算，再调用创建接口。相同请求返回原任务；相同素材的未失败任务阻止重复创建。
- 无法确定供应商是否已接受任务时保留 `uncertain`；刷新不重新创建。没有返回供应商人物组 ID 的请求需要管理员核对供应商原任务和账单。
- 有供应商人物组 ID 时刷新读取原人物组和形象。训练和本人授权均完成后才允许导入到企业。
- 导入时在企业默认设置锁内合并最新人物列表，相同人物和声音组合不重复添加。
- 当前最多保留并展示每企业 100 个人物创建任务、50 个可用人物。

## 官方接口依据

- [创建人物](https://developers.heygen.com/reference/create-avatar)：`POST /v3/avatars`，`photo` / `digital_twin`，文件使用已上传的 `asset_id`。
- [人物授权](https://developers.heygen.com/reference/create-avatar-consent)：`POST /v3/avatars/{group_id}/consent`；预录授权视频受 Enterprise API 权限限制。
- [人物形象列表](https://developers.heygen.com/reference/list-avatar-looks)：形象 ID 用于后续视频生成；支持 ownership 和分页。
- [声音列表](https://developers.heygen.com/reference/list-voices)。
- [素材上传](https://developers.heygen.com/reference/upload-asset)：代理上传上限 32MB。

## 验证命令

```sh
pnpm exec tsx --test server/routes/presenterAssets.test.ts server/routes/production.test.ts server/lib/studioPaidBudget.test.ts src/lib/shotProduction.test.ts src/components/ShotProductionPanel.test.tsx
pnpm exec tsc --noEmit
pnpm run build
```
