# 灵枢 AI 社媒平台官方 API 应用审核材料包（V1.1）

> 适用范围：灵枢 AI 现有社媒账号 OAuth、内容发布、账号内容读取、互动数据与评论管理能力。
> 当前提交范围：Meta（Facebook Page + Instagram Professional）与 Google/YouTube。TikTok Direct Post 和国内抖音官方发布暂不提交。
> 核对日期：2026-09-27。平台规则会变化，正式提交当天应再次核对官方控制台与文档。
> 说明：本文是产品与审核材料，不替代律师对隐私政策、服务条款、跨境数据和数据处理协议的审查。

---

## 1. 先给结论

### 1.1 不要为了审核去掉测试服登录

保留登录。应用审核方通常接受需要登录的 SaaS，正确做法是准备一个独立、稳定、权限受限的“审核租户”和审核账号，并在 Reviewer Instructions 中写清登录步骤。

不建议把整个测试服改成免登录，原因如下：

- 会让审核环境和真实产品不一致，录屏与实际流程不一致时容易被退回；
- 会暴露企业工作台、客户数据或可执行发布功能；
- 不能证明多租户隔离、用户主动授权和主动发布；
- Google 明确要求主页不能只有登录页，但这不等于应用本体不能登录。公开官网承担产品说明，工作台保留登录即可；
- TikTok 要求演示网站与提交的网站 URL 一致，因此应让审核员按正常路径登录真实审核环境，而不是展示临时静态假页面。

推荐结构：

| 用途 | URL | 是否登录 | 审核用途 |
| --- | --- | --- | --- |
| 公开产品主页 | `https://official.lingshu.site/` | 否 | 品牌、产品能力、法律链接 |
| 审核说明页 | `https://official.lingshu.site/integrations` | 否 | 解释各平台连接、用户控制、数据使用和删除方式 |
| 产品工作台 | `https://app.lingshu.site/` | 是 | 审核员登录并完成 OAuth、预览、确认和发布 |
| 隐私政策 | `https://official.lingshu.site/privacy` | 否 | 所有平台统一填写 |
| 用户协议（服务条款） | `https://official.lingshu.site/terms` | 否 | 所有平台统一填写 |
| 数据删除 | `https://official.lingshu.site/data-deletion` | 否 | Meta 等平台填写 |

审核租户应满足：

- 固定审核账号，不使用邀请码，不要求审核员联系销售后才能进入；
- 审核期内不启用产品自身的短信验证码、双重验证或 CAPTCHA；
- 仅包含虚构的演示企业与无敏感信息的演示素材；
- 只给审核所需菜单权限，不给超级管理员、客户运维或其他租户数据权限；
- 预置一条权属清晰、无水印、无第三方版权风险的短视频；
- 账号和密码至少覆盖预计审核周期，并安排人员每天检查审核邮箱和垃圾邮件；
- 登录后首次进入就能看到“渠道连接”，不要让审核员完成复杂的新手引导；
- 审核结束后轮换密码并清理审核期间产生的令牌与内容。

### 1.2 应用内必须加入隐私政策和用户/服务协议

必须。建议同时具备以下四项：

1. 登录页：未默认勾选的同意框；未勾选时登录按钮不可提交，同时保留隐私政策、用户协议、数据删除入口；
2. 注册页：未默认勾选的同意框，“我已阅读并同意《用户协议》和《隐私政策》”；
3. 工作台账号设置或页脚：长期可访问的隐私、条款、删除入口；
4. 每个平台连接前：就地说明将申请的数据、用途、撤销方式，并由用户主动点击“连接”。

当前源码已补齐 `app.lingshu.site/privacy`、`app.lingshu.site/terms` 和 `app.lingshu.site/data-deletion` 三个公开路由；登录和注册都要求用户主动勾选《用户协议》和《隐私政策》，复选框默认未勾选，未勾选时不能提交。平台控制台统一填写 `official.lingshu.site` 上的公开法律页面，产品内页面作为用户长期可访问入口。对应应用镜像已通过完整质量门禁和联机冒烟，但截至 2026-09-27 公网登录页仍是旧版本，尚未显示强制同意框；生产服务器只接受未提供给本次执行环境的授权公钥，因此在正式提交审核前必须完成生产切换并从公网复验。

### 1.3 不要靠“换词”隐藏真实能力

审核文本可以避开“批量生成、矩阵群发、自动铺量、无人值守”等高风险表述，但必须准确描述实际流程。推荐始终使用以下产品口径：

> 灵枢 AI 是面向企业内容团队的内容准备、审核与账号运营工作台。用户连接自己有权管理的账号，查看待发布内容，逐项确认目标账号、文案、可见范围和互动设置，并主动提交发布。系统展示平台返回的处理状态和该用户自有内容的表现数据。用户可随时断开授权并申请删除数据。

不得在审核材料中声称“每次发布都由用户主动确认”，但审核版本实际上仍可无人值守定时发布或一次点击向多个账号群发。若保留这类能力，应按平台真实规则单独说明、取得所需权限，并在未获批前对相应平台服务端关闭，而不只是隐藏按钮。

---

## 2. 当前状态与提交前阻断项

| 状态 | 事项 | 审核前动作 |
| --- | --- | --- |
| 提交阻断：代码与镜像已验证，生产未生效 | 应用公开用户协议、登录页/注册页强制同意与长期法律入口 | 生产切换后匿名访问三个公开路由，并验证未勾选不能登录或注册；当前公网登录页仍不可提交审核 |
| 已部署并公网验证 | 官网隐私政策缺少 Google/YouTube、TikTok 与抖音说明 | 已检查正文、Google Limited Use 声明和公开路由 |
| 官网已部署，应用待生产切换 | 官网与产品支持邮箱不一致 | 源码已统一为 `support@lingshu.ai`；提交前确认邮箱可稳定收信，并复验应用公网版本 |
| 已部署并公网验证 | 官网缺少统一的平台集成与用户控制说明 | 已增加 `/integrations` 公开页面，并公开各平台当前能力边界 |
| 官网已部署，应用待生产切换 | 官网与发布页存在“规模化分发、自动发布”等易误解表述 | 官网已改为平台适配、人工复核和用户确认；应用发布页随已验证镜像一并等待生产切换 |
| 本轮不提交，已服务端关闭 | TikTok Direct Post UX 尚不满足正式审核要求 | 默认不申请 `video.publish`，前端不允许选择 TikTok 直发目标，服务端拒绝直发；后续独立整改和审核 |
| 已修复，待 OAuth 实测 | OAuth 默认权限多于首期场景所需权限 | Meta 按 Facebook/Instagram 分别只请求账号读取与发布权限；私信、评论、洞察、Webhook、商业资产、广告与 WhatsApp 权限不进入本轮 OAuth |
| P1 | TikTok 官方不接受仅服务内部团队或只管理自有账号的上传工具 | 审核材料和真实产品都应体现面向外部企业客户/创作者，每位用户授权自己的账号并拥有完整控制权 |
| P1 | 抖音代码已有能力门禁与适配器骨架，但未见完整生产 OAuth、真实发布和审核演示链路 | 暂不声称已支持官方发布；先以发布包为正式能力，完成真实 E2E 后再申请 |
| 已部署并公网验证 | 官网首页有“规模化创作、多平台分发”等容易引起滥用疑虑的表述 | 已改为内容创作、平台适配和人工确认，并保留真实能力边界；旧 `/stitch` 原型已从发布产物移除 |

---

## 3. 统一主档信息

以下内容应在各平台后台、官网、隐私政策、录屏和应用 UI 中保持一致。

| 字段 | 建议填写 |
| --- | --- |
| App Name | `Lingshu AI`（英文控制台）／`灵枢 AI`（中文控制台） |
| Legal Entity | `灵小枢（杭州）科技有限公司` |
| Product Homepage | `https://official.lingshu.site/` |
| Web Application URL | `https://app.lingshu.site/` |
| Platform Integration Page | `https://official.lingshu.site/integrations` |
| Privacy Policy | `https://official.lingshu.site/privacy` |
| Terms of Service | `https://official.lingshu.site/terms` |
| Data Deletion | `https://official.lingshu.site/data-deletion` |
| Support Email | `support@lingshu.ai` |
| Developer Contact Email | `[公司长期维护邮箱，至少两人可接收]` |
| Category | `Business / Productivity / Content Creation`（按平台可选项择一） |
| Target Users | `Business content teams and authorized account managers` |
| Business Model | `Subscription SaaS for business users` |
| Countries/Regions | `[按真实开放地区填写，不为审核虚构]` |
| App Logo | 正方形 PNG，建议 1024×1024；Google 另准备 120×120；无平台商标、无“官方”字样 |

### 3.1 一句话描述（英文）

> Lingshu AI is a content operations workspace where authorized business users prepare, review, and publish their own content to social accounts they manage.

### 3.2 短描述（英文）

> Lingshu AI helps business content teams prepare original marketing content, review platform-specific details, connect accounts through official OAuth, and publish only after an authorized user confirms the destination and settings. Users can also view performance data for their own connected accounts and disconnect access at any time.

### 3.3 长描述（英文）

> Lingshu AI is a subscription workspace for business content teams. A user signs in to a private company workspace and connects only social accounts that the user is authorized to manage through the platform's official OAuth flow. Inside the publishing workspace, the user selects prepared content, reviews the video and caption, confirms the destination account and platform-specific settings, and explicitly submits the post. The application then displays the processing result returned by the platform. Where separately authorized, users can view profile information, their own published content, comments, and performance metrics for operational reporting. Lingshu AI does not ask for social account passwords, does not publish without the user's instruction, does not sell platform data, and allows users to disconnect an account and request deletion of stored data.

### 3.4 中文产品说明

> 灵枢 AI 是面向企业内容团队的内容运营工作台。用户登录企业空间后，通过平台官方 OAuth 连接自己有权管理的账号，在发布前查看视频与文案、确认目标账号及平台设置，并主动提交。平台返回处理结果后，灵枢 AI 展示发布状态。本轮 Meta 审核不接入私信、评论、洞察、广告、WhatsApp 或额外 Webhook。灵枢 AI 不索取社媒账号密码，不出售平台数据，用户可随时断开授权并申请删除已保存数据。

### 3.5 通用数据安全说明（英文）

> OAuth access and refresh tokens are stored server-side and protected at rest. Tokens are never exposed in the browser after connection and are not included in normal API responses. Access is isolated by tenant and role. We use TLS in transit, access controls, audit logging, and least-privilege access. A user can disconnect a platform account at any time. After a verified deletion request, we delete or de-identify the relevant application data according to our published deletion process, subject only to limited legal, security, and backup retention requirements.

仅在以上措施与真实部署一致时使用。审核前应由工程负责人确认“静态加密、密钥管理、备份轮换、日志脱敏、租户隔离”的生产实现，不应仅凭代码中存在加密函数就作绝对承诺。

### 3.6 通用审核员登录说明（英文，可复制）

> **Review URL:** https://app.lingshu.site/
> **Test email:** [REVIEWER_EMAIL]
> **Test password:** [REVIEWER_PASSWORD]
>
> 1. Open the Review URL and sign in with the credentials above. No invitation code or application-level two-factor authentication is required for this review account.
> 2. In the left navigation, open **Integrations / Channel Connections**.
> 3. Select **[PLATFORM]** and click **Connect**. Complete the official authorization screen.
> 4. Return to Lingshu AI and confirm that the connected account name is shown.
> 5. Open **Publishing**, select the prepared review video named **[ASSET_NAME]**, review the preview and caption, select the connected account and the available platform settings, then click **[EXACT_BUTTON_LABEL]**.
> 6. The result page shows the platform processing status and receipt. If review of read permissions is required, open **Account Activity / Performance** to view only the connected user's content and metrics.
> 7. To revoke access, return to **Integrations**, open the connected account menu, and click **Disconnect**. Data deletion instructions are publicly available at https://official.lingshu.site/data-deletion.
>
> Please contact support@lingshu.ai if the review account or prepared asset needs to be reset. The review account contains only synthetic demonstration data.

提交前必须把 `[REVIEWER_EMAIL]`、`[REVIEWER_PASSWORD]`、`[PLATFORM]`、`[ASSET_NAME]` 和 `[EXACT_BUTTON_LABEL]` 替换成真实审核环境值。保留任何占位符、让审核员自行注册或要求审核员联系销售获取邀请码，都会显著增加退回概率。

### 3.7 本材料未合并提交的能力

以下能力不要为了“看起来全”而塞进首轮发布审核：

| 能力 | 处理方式 |
| --- | --- |
| WhatsApp Business 消息 | 属于 Meta 的独立产品、权限、业务验证、号码与消息模板流程；单独准备消息收发、用户发起会话、Webhook、退订和数据删除材料 |
| Meta / TikTok / Google Ads | 属于广告 API 与广告账户访问审核；自然内容发布获批不等于获得广告管理资格，建议独立应用或独立审核批次 |
| Pinterest | 当前主链路未实现；完成 OAuth、Pins 创建、用户确认和真实 E2E 后再按同一模板补充 |
| X、LinkedIn、微博、快手、Bilibili、小红书、微信视频号 | 当前仓库没有可提交的官方发布闭环；先确认是否对当前主体和应用类型开放 API，再实施和申请，不能只准备文案 |

未来新增平台时，复制本材料的结构即可：公开页面 → 最小 Scope → 逐项理由 → 审核账号 → 完整 OAuth → 用户可见控制 → 单项录屏 → 撤权与删除。

### 3.8 官方 API 申请直达入口

| 平台 | 直接入口 | 本轮动作 |
| --- | --- | --- |
| Meta / Facebook / Instagram | [Meta for Developers — My Apps](https://developers.facebook.com/apps/) | 创建或打开生产应用，配置 Facebook Login、App Review、Business Verification 和数据删除 |
| Google / YouTube | [Google Auth Platform](https://console.cloud.google.com/auth/overview) · [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) | 配置品牌、Audience、Data Access、OAuth 客户端并提交验证 |
| TikTok | [TikTok for Developers — Manage apps](https://developers.tiktok.com/apps/) | 本轮只配置 Login Kit 的 `user.info.basic`；不要申请 Direct Post |
| 国内抖音 | [抖音开放平台控制台](https://developer.open-douyin.com/console/) | 创建“网站应用”；当前保留发布包，真实投稿闭环完成后再申请能力 |

以上入口需要登录对应平台账号。若登录后落到首页，按“控制台 / My Apps / Manage apps”进入应用列表；不要使用搜索广告或第三方代办入口。

---

## 4. 权限申请策略：分阶段，不一次全要

当前代码按首期场景固定请求最小权限：Meta 仅请求对应平台的账号发现、读取基础主页信息与发布权限；YouTube 仅请求 `youtube.upload` 和 `youtube.readonly`；TikTok 仅请求 `user.info.basic`。Meta 私信、评论、洞察、Webhook、商业资产、广告和 WhatsApp 权限不会因旧环境开关而进入本轮 OAuth，后续如需启用必须另建审核批次并修改代码、材料与录屏。

### 4.1 建议分期

| 阶段 | 用户可见能力 | 权限原则 |
| --- | --- | --- |
| A：连接与发布 | 连接账号、选择目标、预览、确认、发布、查看回执 | 只申请身份/账号发现和发布权限 |
| B：自有内容与指标 | 查看该账号自己的内容和表现 | 增加只读内容/洞察权限 |
| C：评论管理 | 读取并由用户确认回复评论 | 增加评论读写权限，单独录屏 |
| D：广告 | 广告账户、计划、投放、预算 | 使用独立应用或独立审核批次，不与自然内容发布混在一次说明中 |

### 4.2 审核文案的安全表达

使用：

- `user-initiated publishing`
- `explicit user confirmation`
- `accounts the user is authorized to manage`
- `original or properly licensed content`
- `review and preview before submission`
- `platform-returned processing status`
- `disconnect and delete`

避免：

- `bulk publishing`、`mass posting`、`one-click posting to hundreds of accounts`
- `fully automated posting`、`unattended posting`
- `scrape competitors`、`copy viral content`
- `account farming`、`traffic matrix`、`engagement automation`
- `guaranteed growth`、`guaranteed viral content`

---

## 5. Meta：Facebook Page + Instagram Professional

### 5.1 后台字段

| 字段 | 填写内容 |
| --- | --- |
| App name | `Lingshu AI` |
| App type/use case | `Business`；用于企业内容团队连接其有权管理的 Facebook Page 与 Instagram Professional Account |
| App domains | `lingshu.site` |
| Website URL | `https://app.lingshu.site/` |
| Privacy Policy URL | `https://official.lingshu.site/privacy` |
| Terms URL | `https://official.lingshu.site/terms` |
| User data deletion | `https://official.lingshu.site/data-deletion`；若后台要求 callback，另实现可验证的 deletion callback |
| Facebook OAuth callback | `https://app.lingshu.site/api/overseas/social/oauth/facebook/callback` |
| Instagram OAuth callback | `https://app.lingshu.site/api/overseas/social/oauth/instagram/callback` |
| Category | `Business and Pages` 或控制台最接近选项 |

### 5.2 Meta 通用 Use Case（英文）

> Lingshu AI allows an authenticated business user to connect Facebook Pages and Instagram professional accounts that the user is authorized to manage. The user selects a prepared video, reviews the preview and caption, chooses one connected destination, and explicitly submits the content. Lingshu AI uses the granted permissions only to identify the selected account, perform the user-requested publication, and display the resulting status. This submission does not request messaging, comments, insights, ads, WhatsApp, business asset, or webhook permissions. We do not request Facebook or Instagram passwords, publish without user instruction, sell Platform Data, or use Platform Data for unrelated advertising profiles.

### 5.3 建议首批权限与逐项理由

只保留真实流程需要的权限。当前产品的 Facebook 入口使用 Facebook Login，Instagram 入口使用 Instagram Login；本轮分别提交前三项与后两项，不同时申请旧的 Page 绑定型 Instagram 权限。

| Permission | 可复制英文理由 | 录屏必须出现 |
| --- | --- | --- |
| `pages_show_list` | `We use pages_show_list to display the Facebook Pages that the signed-in user is authorized to manage, so the user can select the correct Page to connect to the Lingshu AI workspace.` | OAuth 后列出可管理主页，用户主动选择 |
| `pages_read_engagement` | `We use pages_read_engagement to read the selected Page's basic profile and content metadata needed to identify the Page in the user's publishing workflow.` | 主页名称、头像与用户选择的目标主页 |
| `pages_manage_posts` | `We use pages_manage_posts only when an authorized user previews a prepared video and explicitly clicks the publish button for the selected Facebook Page. The permission is not used to publish without user instruction.` | 视频预览、目标主页、确认弹窗、点击发布、回执 |
| `instagram_business_basic` | `We use instagram_business_basic to identify and display the Instagram professional account that the signed-in user chooses to connect.` | Instagram Login 后显示专业账号名称和头像 |
| `instagram_business_content_publish` | `We use instagram_business_content_publish only after an authorized user reviews the media and caption, selects the connected Instagram professional account, and explicitly submits the post.` | 预览、账号、文案、主动确认、处理状态 |

本轮不要在 Meta 后台添加 `pages_messaging`、`pages_manage_metadata`、`pages_read_user_content`、`instagram_business_manage_messages`、`instagram_manage_comments`、`read_insights`、`instagram_manage_insights`、`business_management`、任何 Ads 权限或 WhatsApp 权限。

### 5.4 Reviewer Notes（英文，可复制）

> The requested permissions are used only for assets selected by the authenticated user. To review the publishing flow, sign in to the Lingshu AI review workspace, open Integrations, connect Facebook or Instagram through the official Meta authorization screen, and select an eligible Page or professional account. Then open Publishing, choose the prepared review video, confirm the destination and caption, and click the final publish button. The app displays the provider status after submission. No social account password is collected. The user can disconnect the account from Integrations, and public deletion instructions are available at https://official.lingshu.site/data-deletion.

### 5.5 Meta 录屏脚本（每个权限组合单独录制，2–4 分钟）

1. 浏览器地址栏展示 `https://official.lingshu.site/`，打开隐私政策、用户协议、数据删除页。
2. 打开 `https://app.lingshu.site/`，使用审核账号登录。
3. 进入“渠道连接”，点击 Facebook 或 Instagram 的“连接”。
4. 完整展示 Meta 授权页、应用名和请求权限，不剪掉权限确认画面。
5. 返回灵枢 AI，展示连接的 Page/专业账号名称；用鼠标指出用户选择的是哪个资产。
6. 打开已准备的视频，展示预览、标题/文案、目标账号和最后确认界面。
7. 用户主动点击一次最终发布按钮；展示“平台处理中”或平台回执，不把“请求已接受”误说成“已经公开发布”。
8. 如申请洞察权限，进入“内容表现”，展示数据只来自刚连接的账号。
9. 如申请评论权限，进入“账号动态”，展示一条评论；输入或确认回复后再点击发送。
10. 回到“渠道连接”，展示“断开连接”；最后再次展示数据删除 URL。

录屏旁白重点：`The user remains in control at every step. Lingshu AI accesses only the account selected by the user and publishes only after explicit confirmation.`

---

## 6. TikTok：暂缓 Direct Post 审核

> 本轮不提交 TikTok Direct Post，不申请或扩大 `video.publish` 的正式审核范围，也不录制 Direct Post 审核视频。以下内容仅作为后续整改与独立审核清单保留，不能复制到本轮 Meta 或 Google/YouTube 提交材料中。

### 6.1 提交前必要产品改造

TikTok Direct Post 审核不能只靠文案。发布页必须真实满足官方 Content Sharing Guidelines：

- 调用 `/v2/post/publish/creator_info/query/` 获取最新创作者信息；
- 展示创作者昵称，让用户明确知道发到哪个账号；
- 按返回值检查当下是否可发和视频最大时长；
- 展示视频预览；
- 可见范围选项完全来自 API 返回值，用户必须手动选择，不得设置默认值；
- 评论、Duet、Stitch 的可用性遵从 API；可选项不得默认勾选；
- 提供商业内容设置（自有品牌/品牌合作）及对应声明；
- AI 生成或显著 AI 编辑内容按真实情况传递 `is_aigc` 并向用户说明；
- 在最终按钮旁展示发布声明并取得明确同意；
- 不在视频上添加灵枢品牌水印、推广链接或平台不允许的宣传元素；
- 每次提交仅针对用户明确选择的 TikTok 账号和内容；
- 未通过 audit 的客户端只按私密可见测试，不尝试绕过限制。

### 6.2 后台字段

| 字段 | 填写内容 |
| --- | --- |
| App name | `Lingshu AI` |
| Category | `Content Creation` 或最接近选项 |
| Web URL | `https://app.lingshu.site/` |
| Terms URL | `https://official.lingshu.site/terms` |
| Privacy URL | `https://official.lingshu.site/privacy` |
| Redirect URI | `https://app.lingshu.site/api/overseas/social/oauth/tiktok/callback` |
| Products（当前批次） | `Login Kit` |
| 当前 Scopes | `user.info.basic` |
| 后续 Direct Post 独立批次 | 完成第 6.1 节全部交互和 Sandbox E2E 后，再添加 `Content Posting API` 与 `video.publish` |
| 后续只读 Scopes | `video.list`；只有界面真实展示时再申请。`user.info.profile`、`user.info.stats` 同理 |
| URL ownership | 验证 Web URL、Terms、Privacy；如使用 `PULL_FROM_URL`，同时验证媒体 URL 的域名或 URL prefix |

### 6.3 TikTok 产品用途（英文，可复制）

> Lingshu AI provides a user-controlled “Post to TikTok” experience for business creators and authorized content managers. The user connects the user's own TikTok account through Login Kit. Before a post is submitted, Lingshu AI retrieves the latest creator information, displays the destination creator, previews the selected original or properly licensed video, and requires the user to choose the available privacy and interaction settings. The user reviews the caption and applicable commercial-content or AI-generated-content disclosures, accepts the posting notice, and explicitly clicks the final Post button. Lingshu AI then sends that single user-confirmed item and displays TikTok's processing status. The app is a customer-facing SaaS product and is not limited to accounts owned or operated by our internal team.

### 6.4 Scope 理由（英文）

`user.info.basic`：

> We use user.info.basic to display the connected creator's avatar and display name on the TikTok publishing screen, so the user can verify the destination account before posting.

`video.publish`：

> We use video.publish to submit one video selected and reviewed by the authorized user. Before submission, the user sees a preview, enters or reviews the caption, manually selects an available privacy option, configures the available interaction settings, reviews applicable disclosures, and gives explicit consent by clicking the final Post button.

`video.list`（第二批才申请）：

> We use video.list to show the authorized user a list of the user's own recent TikTok videos in the Account Activity view, including the status of content submitted from Lingshu AI. We do not use this permission to copy or republish arbitrary third-party content.

### 6.5 TikTok Reviewer Instructions（英文，可复制）

> Sign in at https://app.lingshu.site/ with the review credentials. Open Integrations and select TikTok > Connect. Complete Login Kit in the TikTok sandbox account. After returning to Lingshu AI, open Publishing and select the prepared video “[ASSET_NAME].” The publishing screen displays the connected creator name and the available settings returned by TikTok. Manually choose a privacy option, review the interaction and content-disclosure settings, check the posting consent, and click the final Post to TikTok button. The result screen displays TikTok's processing receipt/status. The prepared asset is original demonstration content owned by the applicant and contains no third-party watermark.

### 6.6 TikTok 录屏脚本（建议 3–5 分钟）

1. 从地址栏展示 `app.lingshu.site`，登录 TikTok Developer Portal 的 Sandbox 对应审核账号。
2. 打开渠道连接并点击 TikTok“连接”。
3. 完整展示 Login Kit 授权页面与 Scope，然后返回应用。
4. 进入 TikTok 发布页，展示实时读取到的头像/昵称。
5. 展示原始演示视频预览，说明内容权属；视频中不要有灵枢水印或其他平台水印。
6. 展示标题输入；手动打开可见范围下拉框并选择一项，证明没有默认值。
7. 展示评论、Duet、Stitch；说明禁用项来自 TikTok，所有可选项初始未勾选。
8. 按素材真实情况展示商业内容和 AIGC 选项；读出相应声明。
9. 勾选发布前同意，主动点击最终发布。
10. 展示 `publish_id` 对应的处理中状态，再展示状态查询结果；不要把异步接收误报为公开成功。
11. 回到连接页展示断开入口。

---

## 7. Google / YouTube OAuth

### 7.1 后台字段

| 字段 | 填写内容 |
| --- | --- |
| App name | `Lingshu AI` |
| User support email | `support@lingshu.ai` |
| App logo | 120×120 方形品牌图标，文件不超过 Google 当前限制 |
| Homepage | `https://official.lingshu.site/` |
| Privacy Policy | `https://official.lingshu.site/privacy` |
| Terms of Service | `https://official.lingshu.site/terms` |
| Authorized domain | `lingshu.site` |
| Redirect URI | `https://app.lingshu.site/api/overseas/youtube/oauth/callback` |
| Developer contacts | `[至少两个长期维护邮箱]` |
| Audience | `External` |

需由 Google Cloud 项目 Owner/Editor 在 Search Console 验证 `lingshu.site` 所有权。开发/测试/生产应使用不同项目；只把生产项目提交验证。

### 7.2 当前 Scope 与建议拆分

当前代码请求：

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/youtube.force-ssl`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

建议首次只在发布、频道识别和发布结果核对确实需要时申请前两项。`youtube.force-ssl` 用于评论等写操作，`yt-analytics.readonly` 用于分析，应在相应功能完整可见且能逐项录屏后第二批提交。最终分类以 Google 控制台在提交时显示的 sensitive/restricted 标记为准，不要根据旧文档猜测。

### 7.3 Google App Purpose（英文，可复制）

> Lingshu AI is a content operations workspace for business teams. A signed-in user connects a YouTube channel through Google OAuth, selects a prepared video, reviews the title, description, audience setting and visibility, and explicitly starts the upload. Lingshu AI uses Google user data only to provide these visible user-facing features for the connected channel. Where separately authorized, the application displays the user's own channel content, comments, and analytics. Google user data is not sold, used for advertising profiles, or used to train generalized AI models without separate explicit consent.

### 7.4 Scope Justifications（英文，可复制）

`youtube.upload`：

> Lingshu AI uses youtube.upload when the authenticated user selects a video in the Publishing workspace, reviews the title, description, audience and visibility settings, selects the connected channel, and explicitly clicks Upload. A narrower scope cannot upload the user-confirmed video to the user's YouTube channel.

`youtube.readonly`：

> Lingshu AI uses youtube.readonly to identify the channel authorized by the user and to display the user's own videos and upload status in the Account Activity view. This lets the user verify the destination channel and reconcile content submitted through Lingshu AI. The application does not use this scope to collect unrelated channels or third-party private data.

`youtube.force-ssl`（第二批）：

> Lingshu AI uses youtube.force-ssl to display comments on the authorized user's own videos and to submit a reply only after an authorized user writes or approves that reply in the Account Activity view. A read-only scope cannot perform the user-requested reply action.

`yt-analytics.readonly`（第二批）：

> Lingshu AI uses yt-analytics.readonly to display channel and video performance metrics for the user's own connected channel in the Performance view. The data is shown only to authorized members of that user's company workspace and is not used for advertising profiles or sold to third parties.

### 7.5 Google Limited Use 披露（应加入隐私政策，英文原句可用）

> Lingshu AI's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

同时用普通语言分别说明：访问哪些 Google 数据、用于哪个界面、是否共享、保存多久、如何撤销、如何删除。不要只放这一句而没有具体披露。

### 7.6 Google 录屏脚本（建议 3–5 分钟）

1. 地址栏展示公开官网，打开与 OAuth consent screen 完全相同的隐私政策 URL。
2. 打开工作台并登录审核账号。
3. 进入 YouTube 连接，点击“连接”。
4. 把 Google Consent Screen 左下角语言切换为 English；完整展示应用名和本次申请的每一个 Scope。
5. 同意后返回应用，展示频道名称，证明用户知道连接了哪个频道。
6. 进入发布页，展示视频预览、标题、描述、是否面向儿童、可见范围与目标频道。
7. 用户主动点击上传，展示处理中与最终视频 ID/状态。
8. 若申请 `youtube.readonly`，打开“账号动态”展示该频道自己的视频。
9. 若申请 `youtube.force-ssl`，展示评论读取及用户主动发送回复。
10. 若申请 Analytics，展示指标页并指出它只对应已连接频道。
11. 展示断开连接和数据删除说明。

---

## 8. 国内抖音开放平台

### 8.1 当前建议

现阶段先保留“抖音发布包 + 用户到抖音端手动确认发布”作为正式产品能力。代码中虽然已有 `douyin_cn` 适配器、`video.create.bind` 能力门禁和审核状态字段，但在完成生产 OAuth、Token 生命周期、官方真实投稿、回执对账、审核 UI 和真实账号 E2E 前，不应提交“网站应用官方发布已完成”的审核材料。

抖音不同应用类型、能力和开放范围可能不同。创建应用时必须按实际形态选择“网站应用”，只申请控制台对该类型实际开放的能力；不能把移动应用 SDK 投稿文案直接用于网站应用。

### 8.2 应用简介（中文，可复制）

> 灵枢 AI 是面向企业内容团队的内容准备与运营工作台。用户在企业空间中整理自有或已获授权的图片、视频和文案，完成预览与人工复核后，可生成符合抖音发布要求的发布包；在对应官方能力获批并完成用户授权后，用户可选择自己有权管理的抖音账号，确认作品信息并主动发起投稿。系统不索取抖音账号密码，不抓取非授权账号数据，不复制搬运第三方内容。

### 8.3 能力申请理由（中文，可复制，待真实链路完成后使用）

> 申请“发布内容到抖音”能力，用于向已授权用户提供其自有内容的投稿入口。用户先在灵枢 AI 中查看视频预览、核对标题和目标账号，确认素材权属及平台规则后主动提交。系统仅处理本次用户选择的作品，保存平台返回的任务状态或作品标识用于向用户展示结果。用户可撤销授权，未获授权、授权失效或应用审核未通过时，服务端不会调用正式投稿能力。

### 8.4 抖音审核录屏脚本（真实能力完成后）

1. 展示官网、运营主体、隐私政策、用户协议和数据删除入口。
2. 登录审核租户，进入抖音渠道连接。
3. 完整展示抖音官方授权页、授权主体和申请权限。
4. 返回应用，展示已授权抖音账号，明确国内抖音与 TikTok 国际版完全分离。
5. 打开一条权属清晰的演示作品，展示预览、文案、封面和平台规格检查。
6. 展示用户人工确认与最终投稿按钮；不得出现默认多账号群发。
7. 展示平台回执和后续状态查询；没有最终作品 ID/公开链接时只显示“处理中/待核对”。
8. 展示撤销授权和删除数据入口。

---

## 9. 审核视频通用制作规范

- 使用桌面浏览器 1920×1080 或 1440×900，缩放 100%，文字清晰；
- 全程保留地址栏，以证明域名；不要展示浏览器密码管理器、Secret、Token、Cookie 或开发者工具；
- 使用与提交完全一致的生产品牌、域名、按钮名和 Scope；
- 第一次审核优先用平台 Sandbox/Test User，按各平台要求操作；
- 每个申请权限都必须在 UI 中有一个清晰、可见、可操作的对应功能；
- 不剪掉 OAuth consent screen；Google 的演示画面按官方要求切成 English；
- 鼠标移动慢，点击前停顿 1 秒，旁白明确“为什么需要这个权限”；
- 发布素材应为公司自制，准备权属声明、原始工程或拍摄文件以备追问；
- 不展示真实客户数据、真实私信、电话号码、订单或访问令牌；
- 对异步平台状态准确表述：“平台已接收，处理中”，直到读回最终成功；
- 上传无字幕版录屏和一份英文字幕版更稳妥；TikTok 可按后台要求上传最多允许数量的视频，将 Login、Direct Post、Display API 分开会更清楚；
- 视频文件名建议：`lingshu-[platform]-[permission-or-product]-review-YYYYMMDD.mp4`。

### 9.1 通用英文旁白开场

> This video demonstrates the production web application submitted for review. The address bar shows app.lingshu.site. I will sign in to a dedicated review workspace containing only synthetic data, connect an account through the platform's official authorization flow, and demonstrate how an authorized user reviews and explicitly submits one piece of content.

### 9.2 通用英文旁白结尾

> The user can disconnect the account from the Integrations page at any time. Our privacy policy, terms of service, and data deletion instructions are publicly accessible without signing in. Lingshu AI does not request the user's social account password and does not publish without the user's explicit instruction.

---

## 10. 隐私政策必须补充的内容

官网现有隐私政策的主体、Meta 数据、保存期限、安全措施和权利章节基础较好。审核前至少新增以下内容：

### 10.1 Google/YouTube 数据章节

应明确列出：

- 频道标识、频道名称、用户自己的视频及发布状态；
- 在相应授权下读取的评论、频道/视频分析指标；
- OAuth access token/refresh token；
- 每类数据对应的界面和用途；
- Google Limited Use 声明；
- 不出售、不用于广告画像、不在没有另行明确同意时用于通用 AI 模型训练；
- 撤权路径和删除流程。

### 10.2 TikTok 数据章节

应明确列出：

- open_id、头像、昵称和授权范围；
- 用户自己的视频元数据、投稿状态和表现数据（仅在实际申请时写）；
- 发布时用户选择的标题、隐私、互动、商业内容和 AIGC 设置；
- Token 保存与撤销；
- 不搬运第三方内容、不进行未授权发布。

### 10.3 抖音数据章节

在正式官方接口上线时再加入，准确列出用户标识、账号信息、投稿内容、回执、作品数据和保存期限。若当前只有发布包，应直接写“发布包由用户下载后在抖音端自行确认发布”，不要写成已有官方直发。

### 10.4 AI 与平台数据

应清楚区分：

- 用户主动上传用于内容制作的素材；
- 从平台 API 获得的账号/内容/评论/指标数据；
- 哪些数据可能发送给 AI 服务商；
- 默认是否用于模型训练；
- 企业客户如何选择关闭或限制 AI 处理。

审核最稳妥的口径是：平台 API 获取的私信、评论、未公开内容或用户数据，不用于训练面向其他客户的通用模型；若未来确有个性化训练，必须取得独立、明确、可撤回的同意，并按平台要求在产品与录屏中展示。

---

## 11. 用户协议与产品内同意文本

### 11.1 登录与注册同意文本

> 我已阅读并同意《用户协议》和《隐私政策》。注册时，我同时确认有权代表所属企业创建和使用本账号。

登录和注册复选框都不得默认勾选；未勾选时不得提交登录或注册请求。

### 11.2 平台连接前说明

> 连接后，灵枢 AI 将在你授权的范围内读取所选账号的基本信息，并仅为你在工作台中启用的发布、内容查看、评论或数据分析功能处理相关数据。灵枢 AI 不会索取你的平台密码。你可以随时在“渠道连接”中断开账号，也可以在平台官网撤销授权。

### 11.3 发布前确认

> 我已核对目标账号、内容预览、文案和平台设置，确认对素材拥有使用权，并同意将本条内容提交至所选平台。平台可能进行处理和合规审核，最终状态以平台返回结果为准。

### 11.4 AIGC 提醒

> 如内容属于平台要求披露的 AI 生成或显著 AI 编辑内容，请开启相应标识。你应确保披露选择与内容实际情况一致。

### 11.5 断开授权说明

> 断开后，灵枢 AI 将停止使用该授权访问平台。平台上的既有内容不会因此自动删除；如需删除灵枢 AI 已保存的数据，请按照《用户数据删除说明》提交请求。

---

## 12. 除应用审核外还需准备的材料

### 12.1 公司与品牌

- 营业执照、统一社会信用代码、注册地址、公司电话；
- 域名所有权、ICP备案/适用的网站合规信息；
- 公司邮箱域名和可接收平台邮件的支持邮箱；
- 商标或品牌使用证明（如有）；
- 1024×1024、512×512、120×120 Logo；
- 官网与应用的品牌名、主体和联系方式一致。

### 12.2 安全与隐私

- 数据流程图：用户浏览器 → 灵枢服务 → 各平台 API → 存储/日志；
- 数据清单：字段、来源、用途、存储位置、加密、保存期限、删除方式；
- Token 加密与轮换说明，Secret 只在服务端保存；
- 多租户隔离和角色权限说明；
- 生产日志脱敏检查，禁止记录 access token、refresh token、授权码；
- 删除请求台账、身份核验、30 日处理目标和备份轮换说明；
- 安全事件响应联系人与流程；
- 子处理商清单和跨境数据说明；
- 企业客户数据处理协议（DPA）模板；
- 若 Google 最终将某 Scope 判定为 restricted，准备第三方安全评估预算与周期；不要在控制台确认前预判。

### 12.3 审核运营

- 每个平台一份 Scope—页面—接口—录屏时间点对照表；
- 审核账号、重置人、有效期、测试资产 ID；
- 一套英文截图和一套中文内部操作截图；
- 原始演示视频权属证明；
- 平台审核问答负责人，保证 1 个工作日内回复；
- 版本冻结：审核期间不要改 App 名、Logo、域名、Redirect URI 或 Scope；
- 审核通过后再按租户灰度，先用公司自有真实账号完成 E2E；
- 平台撤权、Token 过期、发布失败、异步结果未知的告警与人工对账流程。

### 12.4 技术验收

- OAuth `state` 一次性、短时有效并绑定用户/租户/平台；
- Redirect URI 与后台逐字一致；
- Token 刷新互斥，防止并发覆盖；
- Scope 不足时 fail closed，不继续调用发布接口；
- 未获审核、未过真实 E2E 或账号不适格时，服务端 capability 为 false；
- 所有发布都有用户、租户、内容版本、目标账号、时间和平台回执审计记录；
- 平台只返回“已接收”时不得在 UI 标记“已发布”；
- 断开账号后停止刷新和后台任务；
- 删除请求能覆盖 Token、账号关联、同步数据、内容副本和派生索引；
- 审核环境不能访问真实客户租户。

---

## 13. 推荐提交顺序

1. **当前首要阻断：**将已通过镜像冒烟的应用版本切换到生产，验证公司名、应用名、域名、`support@lingshu.ai`、产品内条款入口以及登录/注册强制同意。
2. 官网隐私政策与 `/integrations` 平台集成说明页已部署并完成公网验证；提交当天再做一次可用性检查。
3. 建立审核租户、审核账号、演示素材和权限最小化开关。
4. 先做 Meta 的“连接 + 单账号用户确认发布”，评论和洞察后置。
5. 做 Google/YouTube 品牌验证，再提交实际需要的最小 Scope；上传演示视频。
6. 本轮跳过 TikTok Direct Post；以后完成全部必需 UX 和 Sandbox E2E 后再建立独立审核批次，在此之前不要递交半成品录屏。
7. 国内抖音先维持发布包；确认网站应用可申请能力、完成真实接口与 E2E 后独立提交。
8. 广告 API、WhatsApp 消息、评论写入等高权限能力分别建审核批次，不要与首轮自然内容发布混交。

---

## 14. 提交前一页核对表

- [x] 官网不是只有登录页，能清楚说明产品功能；
- [ ] 官网、应用、隐私、条款、删除页都可匿名访问且返回真实内容；
- [ ] 公司名、App 名、Logo、邮箱、域名在所有位置一致；
- [ ] `lingshu.site` 域名所有权已验证；
- [ ] 应用内隐私政策和用户协议长期可访问；
- [ ] 登录与注册同意框默认未勾选，未勾选不能提交；
- [ ] 审核账号无需邀请码，不受 CAPTCHA/产品 2FA 阻断；
- [ ] 审核租户无真实客户数据；
- [ ] 每个 Scope 都有已实现 UI、真实接口和录屏证据；
- [ ] 未实现或“未来可能用”的 Scope 已删除；
- [ ] 发布前显示目标账号、预览、文案、设置和最终确认；
- [x] 本轮提交的产品与 Scope 中不包含 TikTok Direct Post；
- [ ] 视频、封面、音乐和商标权属清楚；
- [ ] 没有“群发、批量铺量、搬运、自动养号”等审核文案或实际违规流程；
- [ ] 没有把平台“已接收”误写成“已发布”；
- [ ] 断开授权与数据删除均可执行；
- [ ] 审核期间有人员查看平台邮件并及时回复；
- [ ] 审核材料描述与生产应用真实行为一致。

---

## 15. 官方参考资料

### Google

- [OAuth Verification Requirements](https://support.google.com/cloud/answer/13464321)
- [Submitting your app for verification](https://support.google.com/cloud/answer/13461325)
- [When verification is not needed](https://support.google.com/cloud/answer/13464323)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)

### TikTok

- [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines)
- [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [Content Posting API — Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [Register Your App and Verify URL Ownership](https://developers.tiktok.com/docs/en/getting-started-create-an-app)

### Meta

- [App Review](https://developers.facebook.com/docs/app-review/)
- [App Review Submission Guide](https://developers.facebook.com/docs/app-review/submission-guide/)
- [Business Verification](https://developers.facebook.com/docs/development/release/business-verification/)
- [User Data Deletion](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/)

### 抖音

- [应用概述](https://developer.open-douyin.com/docs/resource/zh-CN/developer/introduction/apps)
- [能力概览](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/common-solution)
- [抖音发布能力使用规范](https://developer.open-douyin.com/docs/resource/zh-CN/dop/operation-standard/platform-capabilities/useclue)
