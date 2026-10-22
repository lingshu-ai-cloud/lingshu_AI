# Meta 本地暂停创建验收记录

时间：2026-10-22，Asia/Shanghai。功能分支：`feature/platform-ads-meta-workspace-20261022`。

## 计划创编审计与三页联通（本轮增量）

- 起点 `e5a38e96086a0dd8ee69d49e0ee102585754c249`，工作区干净。继续在独立分支、5187 / 8890 / 8891 开发；真实测试只有 GET，不重复创建、不改账单、不启动广告、不更改现有任务或原始回执，也未合并或推送。
- 修复执行端只查最近 200 条回执的问题：重复创建/未知操作保护现在扫描完整历史。新增超过 200 条失败记录掩盖旧 UNKNOWN 的回归，确认不产生供应商写入。
- Meta 创建前检查实时账户 ID、币种、可用状态、平台最低限额；USD/CNY 预算最多两位小数，不静默四舍五入。补齐执行端结束时间必须晚于开始时间、非空 Meta 渠道检查；既有暂停发布策略仍生效。
- 新创建回执只有在四层资源 ID/归属/父子关系、三层 PAUSED、目标/优化/目的地/计费、系列 spend_cap、广告组 daily_budget、主页/视频/CTA、国家/平台版位和指定排期读回一致后才能 VERIFIED。差异保留 UNKNOWN 与已有资源，阻止重建。模拟测试故意让视频读回错误，证明只创建一次、之后重试不重建。没有为测试调用真实创建。
- 四层读回复用 `metaPlanReadback`，同时供素材/数据的既有资源核验使用。计划页新增只读 `tasks/:id/meta-audit`：当前事实与创建历史分离；ThruPlay 的 post_execution 映射不冒充创建时绑定。`connections/:id/meta-setup` 返回账户实时币种/时区/最低预算及主体已授权主页，不返回 Page/access token；主页列表可读不等于可以创建。
- 创编新增已授权主页选择和明确的手动 ID 降级；账户切换清空旧主页、视频、封面和落地页；同币种且 connected 才可选。绑定素材使用现有平台封面，非草稿不提供“用于本次创建”；已有创建/未知结果禁止前端再新建。同配置的网络错误重试复用请求 ID；仅明确成功/失败后释放。视频观看明确 ON_VIDEO，不宣称落地页被用于该目标。
- 计划详情可带当前 taskId 跳往投放数据（实际按该计划过滤资源与 KPI）和素材库（按计划查找其真实视频），两页仍可清除范围查看其他授权资源。Meta 详情不再并排调用旧 UTC 统计与新原生统计，避免同页口径分叉。
- 21:33:43 / 21:33:47（Asia/Shanghai）真实核对两条原沙盒计划，检查项全部一致：CNY、Asia/Shanghai、系列限额 500、日预算 50、主页 1323567870837055、视频 1580768800024852、Facebook / US。网站访问为 OUTCOME_TRAFFIC / LINK_CLICKS / WEBSITE，ThruPlay 为 OUTCOME_ENGAGEMENT / THRUPLAY / ON_VIDEO；计费均 IMPRESSIONS，三层 PAUSED、广告 PENDING_REVIEW。原执行 ID / 文件 SHA 与前两节一致。
- 21:33 的 Meta setup 真实返回账户状态 1、最低系列限额 CNY 500、最低日预算 CNY 6.72；所选主页仅返回 ID 与 ADVERTISE，未返回名称，界面不编造主页名。当前真实验收版位为 Facebook，未新建 Instagram 广告或验收实际消耗、审核通过。
- 字段对照 [Meta Campaign 官方 SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py)、[Ad Set 官方 SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py)。spend_cap / daily_budget / lifetime_budget 不混用；传给 Meta 的预算为该币种最小单位，页面显示主单位。
- 浏览器从 ThruPlay 计划进入投放数据，21:40 返回该计划 1/1 资源范围的真实空报告；进入素材管理定位同一平台视频（共享素材仍如实显示两条广告关联）。已有计划的创建入口禁用，未触发任何真实执行。
- 最终回归：39 个投流测试文件通过，TypeScript 无错误，架构检查 2241 个生产 TypeScript 文件通过，构建通过，Studio 分包 497093 / 500000 字节，`git diff --check` 通过。新增创建校验使用模拟供应商验证；本轮真实平台验证仅覆盖已有暂停资源的读取，不宣称新增创建、审核通过、消耗归因或生产上线验收完成。

## 投放数据页 Meta 原生报表接通（本轮增量）

- 开发起点 `02024f56ec9bdc813b9594f9f4070866cb1ca8b3`，干净工作区；继续使用前端 5187、后端 8890、隔离数据库 8891。本轮全部 Meta 请求为 GET，没有创建/上传/激活/改预算/改账单请求，没有新应用、迁移、合并或推送。
- `AdPerformanceOverview` 替换旧 UTC 本地切片与模拟询盘/成交漏斗，复用 Ant Select/RangePicker/Table/Collapse、共享 `LsMetricStrip` 与 Chart.js `LsDataChart`。提供账户、Campaign/Ad Set/Ad 层级、今天/近 7/30 天/自定义最多 93 天、本页搜索、自定义 13 个指标列、来源时间和 CSV 导出。宽表只在表格内部滚动，不撑宽指标带或页面。
- 新增只读 GET `performance/:executionId`，复用现有 VERIFIED 回执、资源四层归属核对、账户凭据和 Meta 适配器。开始/结束日期真正传入 Meta `time_range`；预设日期基于 Meta 账户 `timezone_name`，金额采用 `currency` 的主单位，不自行转汇、不与预算分单位混用。
- 每个资源分别请求所选日期窗口汇总与逐日 Insights；汇总的 CPM、CPC、CTR、链接点击率、单次链接点击/ThruPlay 成本、reach/frequency 直接用原字段，不平均日比率或相加去重人数。`clicks`、`inline_link_clicks`、`video_thruplay_watched_actions.video_view` 分列，不泛称询盘或同一种转化。
- 查询显式指定 `action_report_time=impression`、`use_unified_attribution_setting=true`。展示关联广告组实际返回的 `attribution_spec`；此次沙盒未返回窗口，明确“未返回，不推断”，不擅自填 7 天点击/1 天浏览。Campaign 不把一个关联广告组的优化目标宣称为整个系列统一结果口径。
- 总览只对同账户/币种/时区/日期/层级的去重资源加总花费、展示、全部点击和链接点击；任何资源或字段未返回时该项不冒充完整总额。明确是本地计划范围，不是完整账户总账。空报告与请求失败分别计数，不填零、不画假趋势、不计算未经归因的 ROAS。
- 字段核对来源：[Meta 官方 Business SDK AdsInsights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)。同时用现有沙盒真实查询验证这些字段/参数被 Meta 接受；空数据不等于已验证真实非零归因/成本。
- 20:15:45–50：两条 Campaign 原生汇总和日 Insights 成功；20:16:59–20:17:00：两条 Ad Set 原生报告成功，目标 LINK_CLICKS / THRUPLAY。20:21:39–40：两条 Ad 原生报告成功。均 CNY / Asia/Shanghai，窗口 2026-10-16 至 2026-10-22，totals=null、daily=[]；广告 PAUSED / PENDING_REVIEW、issues=[]，不是 0 消耗或审核通过的证据。
- 20:23:51 在页面将近 7 天切换为“今天（账户时区）”，两份新报告均返回窗口 2026-10-22 至 2026-10-22；不是在旧 7 天响应上仅做前端过滤。
- 广告层级首次读取曾出现网络超时，界面显示读取失败而非空报告；后续受控只读复核和页面刷新成功。单次失败不盲重试，60 秒报告缓存与并发合并复用现有公共读模型缓存；账户公共元数据缓存 5 分钟，不缓存凭据。
- 本轮定向与领域回归 39 个文件通过，覆盖三层正确资源路径、账户时区/日期边界、原生比率与真零/空值、缓存、不改平台、租户鉴权、查询校验及跨币种/时区/重复资源汇总边界。TypeScript、架构检查（2237 文件）、构建与 Studio 分包预算通过；无生产部署或真实消耗验收。

## 素材一级页接通（本轮增量）

- 开发起点 `86cee777926a38c7ec4a1b27102263008700e00d`。仍使用功能分支、前端 5187、后端 8890、PocketBase 8891；未合并、推送、部署或修改基线。
- `adsCreatives` 已替换占位页和模拟效果表，复用 Ant Design、共享媒体状态框、渐进图片和瀑布流。支持真实账户筛选、本页搜索、平台封面、鉴权原片播放、计划关联及广告级报告；读取失败有重试与旧报告采集时间。
- 新增 GET `creative-library`、`creative-library/:executionId/report`、`creatives/:id/platform-preview`、`creatives/:id/media`；仅本地写入的 POST `tasks/:taskId/creatives/attach-existing`。均经过现有身份/租户边界，映射写入继续使用计划锁和管理员权限。
- 沙盒视频沿用 `1580768800024852`，原片 17790 字节、6 秒、720×1280；鉴权视频响应 SHA-256 与冻结版本一致。没有重新上传视频、创建广告或新建 Meta 应用。
- Traffic 原绑定 `6ea7e378c2725b2` 保留；ThruPlay 新本地绑定 `39945353eb7df65` 只补投放后映射。平台四层归属、同账户/视频、上传 SHA 回执、三层 PAUSED 均核对后才写入。本地计划版本仍为 Traffic 2、ThruPlay 1，原执行回执不改写；补映射操作不产生 Meta 写请求。
- 素材库按账户、文件 SHA 和平台视频去重：沙盒一条视频关联两条已核验广告；真实账户的另一视频独立展示，不跨账户混算。
- 2026-10-22 19:58:40–41（Asia/Shanghai）页面已读回两条 Ad：配置 PAUSED、有效 PENDING_REVIEW、无 issues_info。报告按各自 Ad ID 读取，目标分别为 Meta ThruPlay、链接点击，CNY / Asia/Shanghai，窗口 2026-10-16 至 2026-10-22。两份 Insights 均为空，花费、展示、点击、结果和单次成本均为 null，页面为“—”，不是零或虚构询盘/ROI。
- 20:00 复核时出现 Meta `4 / 1504022` 应用限流；保留此前成功报告并显示刷新失败，不宣称持续刷新无阻塞。新增公共读模型的租户隔离、并发合并与有界短缓存：报告 60 秒、封面 5 分钟，保留真实采集时间，不缓存令牌、不用缓存授权任何写操作。补映射始终重新检查平台，不走状态缓存。
- 本轮模拟回归：39 个投流测试文件通过，新增映射幂等/不改原计划和回执/跨租户拒绝/账户及视频不匹配拒绝/非暂停拒绝、广告级空值与真零及正值口径、只读 Meta 请求、路由鉴权、媒体与占位页替换契约、缓存隔离/过期/容量/并发测试。
- 本轮真实验证限于已有暂停广告、素材映射、视频播放及只读数据回流；没有实际消耗、审核通过或生产上线证据。没有修改账单。
- 素材接通代码提交 `1f7099042804f4fd0f5704b2b03e26cbb20dcc08`。从该提交重启独立前后端后，版本提示消除；20:04:32 两条广告报告再次成功返回，仍为 PAUSED / PENDING_REVIEW、空 Insights，无新增平台资源。后续仅修正长计划名挤压报告列的展示布局。

## 当前结论（后续修复覆盖早期阻塞判断）

- 沙盒网站访问、ThruPlay 两条链路已创建完整 Campaign–Ad Set–Creative–Ad 并从 Meta 读回，两个产品回执均 VERIFIED。
- 根因不是缺少 ADVERTISE 授权：沙盒主体 `/me/accounts?fields=id,name,tasks` 返回所选主页及 `ADVERTISE`。账户主体令牌无法处理该主页的未发布帖子；从已授权主页读取的 Page 令牌可以。无需新增权限、把主页加入业务组合或修改账单。
- 适配器保留账户令牌用于 Campaign / Ad Set，Creative / Ad 使用所选主页的现有 Page 令牌。主页令牌只在内存中使用，不写日志、运行证据或公共接口；取得主页令牌失败会在创建层级资源前阻断。
- 网站访问恢复沿用原 Campaign / Ad Set，只补缺失的 Creative / Ad；后续修复广告访问身份只更新原 Ad ID，不创建替代广告。全部状态变更有租约及持久化检查点，未知结果禁止盲重试。
- 2026-10-22T11:31:11Z 最后读回：两条 Campaign / Ad Set 的 status、effective_status 均 PAUSED；两条 Ad 的 status 为 PAUSED、effective_status 为 PENDING_REVIEW，未再返回 issues_info 硬错误。配置暂停与平台审核是两个不同口径，不宣称广告审核或实际投放通过。

| 链路 | 本地计划 / 回执 | Campaign | Ad Set | Creative | Ad |
| --- | --- | --- | --- | --- | --- |
| 网站访问 | giln3kkz95vbzll / o8lfx4eqm6rdzc8 | 120330001417553916 | 120330001417554616 | 1697432008701811 | 120330001417556516 |
| ThruPlay | nop5swob5wcwnv7 / k3oqazyd73ovlil | 120330001417556916 | 120330001417557816 | 1109795838074237 | 120330001417559616 |

两条链路均 CNY 500 系列限额、CNY 50 日预算；网站访问为 OUTCOME_TRAFFIC / LINK_CLICKS / WEBSITE，观看为 OUTCOME_ENGAGEMENT / THRUPLAY / ON_VIDEO，均按 IMPRESSIONS 计费。读回核对账户归属、层级关联、主页、视频、落地页及预算单位；只限沙盒暂停创建验收。

## 隔离运行环境

- 前端 `127.0.0.1:5187`，后端 `127.0.0.1:8890`，独立 PocketBase `127.0.0.1:8891`。
- 全部仓库迁移只应用于新建的 `tmp/platform-ads-live/pb_data`，没有操作基线或生产数据库。
- 广告 16 个集合只读结构检查通过；共享任务锁唯一索引存在，实际获取、续租及释放通过。
- `PLATFORM_ADS_RELEASE_MODE=paused_only`，自动投放关闭，JSON 回退关闭。
- 用户已明确授权五项权限重新签发、真实创建和读回；测试广告必须暂停。令牌经产品账户连接接口加密保存。应用 OAuth 回调配置未设置，本次采用产品已有的令牌连接方式。

## 真实平台证据

- 应用：`2204714410308727`（Lingshu Ads Integration）。
- 真实账户：`1306761139191078`，CNY，Asia/Shanghai，平台账户状态 1。
- 五项权限均返回 granted：ads_read、ads_management、pages_show_list、pages_read_engagement、pages_manage_ads。
- 主页：`1323567870837055`（Ads Integration Test Lab），返回 ADVERTISE 等任务权限。
- 原创六秒测试视频通过产品成片绑定、上传和状态核对：`1838938007302283`，平台返回 ready；SHA-256 `558a360f67bd67577f88ab10996c24edfb8a48daf982e618efe7bf9e7c8a96ac`。
- 账户返回最低系列花费限额 50000 分（CNY 500.00）、最低日预算 672 分（CNY 6.72）。测试采用系列限额 CNY 500、日预算 CNY 50。
- 网站访问计划：`y951p1yaw2mxipp`。首次 CNY 100 预算被平台拒绝，无资源产生；更正后复用了同一平台视频，没有重新上传。
- 创建回执：`qwbe9zv1b7bic0l`，请求 `meta_live_traffic_create_20261022_retry2`。
- Campaign：`120254941289710440`，读回 status/effective_status 均 PAUSED，OUTCOME_TRAFFIC，spend_cap 50000 分。
- Ad Set：`120254941289950440`，读回 status/effective_status 均 PAUSED，LINK_CLICKS、IMPRESSIONS、WEBSITE，daily_budget 5000 分。
- Creative：`1420014263002517`，读回主页、视频、LEARN_MORE 和落地页关联与提交一致。
- Ad 创建被 Meta 拒绝：错误 100 / 1359188，要求账户添加有效支付方式。没有 Ad ID，回执保留 UNKNOWN（部分资源已创建），不可声称完整创建成功。
- 账户结构同步读回：Campaign 1、Ad Set 1、Ad 0。
- 备用沙盒账户 `1640686001100669` 不接受上述普通用户令牌（权限错误 200）；用户确认后已生成专用长期沙盒令牌，通过产品连接接口加密保存，连接 `yxk6qrpsfiodjxb`。平台确认 CNY / Asia/Shanghai / account_status 1。

## 沙盒验收与当前恢复点

- 与真实账户分别保存 `tmp/platform-ads-live/sandbox-run.json`，请求使用 `_sandbox` 后缀；接受脚本只允许本次授权的两个账户。
- 独立素材绑定 `6ea7e378c2725b2`，平台视频 `1580768800024852`，真实上传并转码为 ready，缩略图可读。
- 计划 `giln3kkz95vbzll`，回执 `o8lfx4eqm6rdzc8`，请求 `meta_live_traffic_create_20261022_sandbox`。
- Campaign `120330001417553916`、Ad Set `120330001417554616` 已持久化且读回 status 均为 PAUSED；OUTCOME_TRAFFIC / LINK_CLICKS / IMPRESSIONS / WEBSITE，限额 50000 分、日预算 5000 分。
- Creative 创建被 Meta 拒绝：10 / 1341012，缺少主页访问权限；无 Creative / Ad ID，保留 UNKNOWN，不重提创建。
- 用户确认重新关联后，已在官方“更新沙盒广告账户”窗口对同一主页提交“关联”和“更新”；随后尝试移除旧关联并保存以重建关联，但刷新后平台仍显示同一主页 ID，并未呈现无关联状态，不能声称平台完成了底层权限重置。主页未删除，令牌未撤销，账单未修改。
- 沙盒令牌读取 `me` 返回主体 `122104327749469294`（Sandbox Ad Account Owner），并非真实账户的 Lucy Chang。`me/permissions` 包含 granted 的 ads_management、pages_read_engagement、pages_manage_metadata、pages_read_user_content、pages_manage_ads 和 public_profile。
- 沙盒主页 `id,name` 只返回 id；`promote_pages` 返回空列表。但真实账户的同一接口也返回空列表，因此空列表本身不是“没有主页广告权限”的充分判据，不能据此新增产品硬门禁。
- 2026-10-22T11:10:32Z，使用官方 SDK 支持的 `execution_options=["validate_only"]` 重新验证原素材参数，不创建任何资源：沙盒仍返回 10 / 1341012。2026-10-22T11:12:12Z，真实账户的同类已保存参数返回 `{ "success": true }`，只能证明素材参数验证通过，不能视为 Ad 创建或支付条件通过。
- 2026-10-22T11:11:59Z，沙盒 Campaign / Ad Set 再次读回 status 和 effective_status 均 PAUSED；无 Creative / Ad ID。未重提创建，未尝试 ThruPlay 新建。
- 只读检查应用关联业务组合 `3124707611058974`（Robert）的主页资产页显示“未添加任何公共主页”。业务组合共享访问申请仅查看流程并已取消，没有添加主页、转移主页所有权或申请新权限。该业务组合现状是排查线索，不足以断言迁移主页一定解决沙盒问题。
- 上述阶段的权限阻塞判断由顶部“当前结论”修正。后续发现账户身份和主页身份不能混用，没有通过扩大资产权限绕过。
- `diagnose` 为只读诊断；`readback` 新增账户及 Campaign–Ad Set–Ad–Creative 关联校验，VERIFIED 回执必须拥有四层完整资源。
- `validate-creative` 只对已保存的素材输入调用 Meta 官方仅验证模式，结果单独保存，不修改 UNKNOWN 创建回执、不新建 Campaign / Ad Set / Creative / Ad。
- `validate-page-creative` 使用所选主页身份做同样的仅验证；`recover-traffic` 仅接受文档中指定的原沙盒回执和资源 ID，任何恢复检查点存在但 ID 不完整时阻断。
- 初次补齐后广告异步返回 WITH_ISSUES / 2446289。对同一 Creative 做 Ad 仅验证：账户身份返回 200 / 3858756（操作者无法访问帖子），主页身份返回 success。`repair-ad-page-identity` 只对文档中的两个原 Ad 做同 Creative、PAUSED 更新，回执记录 pageIdentityRepair；没有重建任何已有资源。
- 接受脚本增加跨命令本地操作锁，禁止多个操作覆盖同一运行状态；readback 遇到 Meta HARD_ERROR 明确失败，不能仅凭资源 ID 判验收通过。

## 本次修正

- OAuth 补齐主页列表、读取及广告管理权限。
- Meta 错误保留脱敏后的字段/权限说明，去除访问令牌和 URL。
- 创建前读取平台账户最低预算，低于平台限制时在创建任何资源前阻断。
- 明确失败且没有已接受资源的执行允许修正草稿；同一账户、同一素材及有效上传回执可重新绑定新计划版本并保留平台视频。
- UNKNOWN、执行中或已接受结果继续禁止换绑和盲目重建。
- 投流演示数据改为开发环境显式设置 `VITE_PLATFORM_ADS_DEMO_MODE=true`，真实本地联调不混入模拟花费。
- 列表显示已核验暂停、已核验启用、平台结果待核对等实际计划状态。

## 本地操作

`scripts/setup-platform-ads-local.mjs` 只创建忽略目录中的本地凭据及运行配置，需显式指定已安装的 `PLATFORM_ADS_PB_BINARY`。默认端口固定为上述隔离端口。

`scripts/run-platform-ads-meta-live.ts` 是显式操作脚本，会发起真实平台调用。只允许隔离数据库和 paused_only 模式；分阶段保存到 `tmp/platform-ads-live/run.json`，不得把运行文件、令牌或数据库提交到 Git。不要在已有 UNKNOWN 回执时新建请求或重复创建。

已完成沙盒两种已支持目标的暂停创建与四层读回。未完成真实账户 Ad 创建（支付方式阻断，按要求未修改）、实际花费/归因验收、广告审核、应用 OAuth 回调接入及生产发布；不能据此宣布真实付费投放或上线就绪。

## 代码验证

- 修复起点 HEAD `25f3a083f747ed0186ef22cc9d929870e17fda7f`。本轮修改仅限 Meta 适配器、受影响测试、显式接受脚本和本验收记录；未合并或推送其他分支。
- 代码修复提交 `9bb1e8b70cd8c1ef5af6edb4b0f034d98f57d227`；前端 5187 与后端 8890 已从该源码重启并核对版本一致。最终审核状态读回后仅补充本记录，没有再修改代码。
- 本轮已重跑 `pnpm run test:platform-ads`（37 文件）、`pnpm run lint`、`pnpm run check:architecture`（2230 文件）、`pnpm run build`（studio 497094/500000）、`git diff --check`，均通过。其他下列测试为此前证据。
- `pnpm run test:platform-ads`：37 个测试文件通过（隔离平台模拟，不是真实平台验收）。
- `node scripts/test-platform-ads-ui.mjs`：通过，全部 API 模拟。
- `pnpm exec tsx server/platformAds/currencyExecution.test.ts`、`pnpm exec tsx server/platformAds/creatives.test.ts`：预算最小值和失败后素材复用新增回归通过。
- `pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`pnpm run build`、`git diff --check`：通过。
- 没有执行生产部署、生产迁移、分支合并或推送。
