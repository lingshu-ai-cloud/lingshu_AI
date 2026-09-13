# 广告平台执行接入

## 当前可执行范围

- Meta：OAuth 授权发现账户，或开发者令牌验证连接；账户与 campaign 读取；网站视频引流与有效视频观看广告完整暂停创建；启用、暂停和广告组日预算调整；平台读回与未知结果对账。
- Meta 创建按任务渠道限制 Facebook / Instagram；按排期设置 start_time / end_time；campaign spend_cap 使用任务总预算。平台计费存在延迟，spend_cap 不是即时扣费保证。
- Meta 支持 USD / CNY，必须与任务币种一致；两者预算偏移均为 100（美分 / 分）。TikTok、Google 执行仍要求任务与账户均为 USD。
- TikTok：访问令牌验证账户、读取 campaign；人工创建 VIDEO_VIEWS / ENGAGED_VIEW / CPV 的 Spark 视频广告，TT_USER 身份与既有可推广帖子必填；支持完整暂停创建、启停、未知状态对账。尚不支持审批和自动执行。
- Google：访问令牌验证账户、读取 campaign；人工创建 YouTube-only Demand Gen / Target CPA 转化广告，必须引用账户已有视频和 Logo 资产；完整原子暂停创建、启停、对账；任务绝对排期转换为账户本地时间。标准 Video 类型为 API 只读，不以 Demand Gen 替换视频观看目标。尚不支持审批和自动执行。
- 每任务限制一个已创建或待核对 campaign。跨平台预算拆分、平台导入计划接管、素材上传、令牌刷新尚未实现。
- Meta API 调用已通过模拟传输和本地持久化测试，未通过真实广告账户验收。

## 配置

`META_ADS_API_VERSION` 必填，例如部署时核验仍受支持的 Graph 版本；不内置未经核实的默认版本。

OAuth 另需 `META_ADS_APP_ID`、`META_ADS_APP_SECRET`、`META_ADS_REDIRECT_URI`。固定回调地址为 `{站点}/api/overseas/platform-ads/oauth/meta/callback`，需登记到 Meta 应用。申请 `ads_read,ads_management` 及对应生产访问权限。应用密钥保留服务端，授权令牌加密入库。

`GOOGLE_ADS_API_VERSION` 必填；如经过经理账户访问，配置 `GOOGLE_ADS_LOGIN_CUSTOMER_ID`。Google Ads API 自 2026-09-09 起以 OAuth 所属 Cloud 项目的访问等级鉴权，本实现不再要求或发送 developer-token。

生产使用现有 `TENANT_PLATFORM_APP_KEY` 加密令牌。任务锁是当前部署文件系统上的原子目录锁，多主机部署须先替换为共享事务/锁。

## 已核验官方来源（2026-09-12）

- Meta 官方 SDK：https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/README.md
- Meta AdSet 字段与枚举：https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py
- Meta 币种偏移：https://developers.facebook.com/documentation/ads-commerce/marketing-api/currencies （主 agent 在 Chrome 核验 USD / CNY 偏移均为 100）
- Meta 官方 Marketing API 参考页读取遇到 HTTP 429，实际参数组合须通过目标账户验证。
- TikTok advertiser info v1.3：https://ads.tiktok.com/gateway/docs/index?doc_id=1739593083610113
- TikTok adgroup create：https://business-api.tiktok.com/gateway/docs/index?doc_id=1739499616346114 。当前 VIDEO_VIEWS 应使用 ENGAGED_VIEW 或 ENGAGED_VIEW_FIFTEEN，VIDEO_VIEW 优化目标已废弃；对应计费 CPV。
- Google Cloud 项目鉴权变更：https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- Google REST 查询：https://developers.google.com/google-ads/api/rest/common/search
- Google Demand Gen 创建：https://developers.google.com/google-ads/api/docs/demand-gen/create-campaign
- Google 总预算：https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview

## 测试

`npx tsx server/platformAds/metaAdapter.test.ts`

`npx tsx server/platformAds/execution.test.ts`

`npx tsx server/platformAds/oauth.test.ts`

`npx tsx server/platformAds/tiktokExecutionAdapter.test.ts`

`npx tsx server/platformAds/googleExecutionAdapter.test.ts`

`npx tsx server/platformAds/currencyExecution.test.ts`

测试不会发起真实广告平台写入。
