# Meta 本地暂停创建验收记录

时间：2026-10-22，Asia/Shanghai。功能分支：`feature/platform-ads-meta-workspace-20261022`。

## 10 月 23 日两套历史企业的只读接入

### 原文件、账户与回执再核对

- 起点 `4ef6f137a85bf105f70364bef30660812e992911`，仅投流功能分支，5187/8890/8891。新增的原文件核验只使用原企业显式配置目录和只读文件句柄；不下载替代副本，不迁移、不复制、不修改源记录。文件路径、对象存储 Key、授权及内部错误不返回前端。
- 完整流式计算 SHA-256 与实际大小，限制 110 MiB，核对读取前后 inode 句柄对应文件的 size/mtime/ctime；拒绝目录、越界、软链接跨企业、读取期间变化和大小/指纹不一致。仅存在当前指纹而无冻结 SHA 的文件记为 fingerprinted，不算历史版本 verified。图片输出必须唯一对应原企业素材目录，不从 URL/名称猜测。
- 10:17:35（Asia/Shanghai）实库检查全部 35 条历史项目：客户历史 3 条成片血缘对应 2 个原始视频，实际 SHA/大小均通过；本地预览 5 个图片输出引用对应对象文件缺失。没有冻结输出文件引用的草稿单独提示，不冒充可投放素材。现有文件内容只读，源集合哈希及原广告集合“不存在”状态前后不变。
- 两套原源目录无 platform_ad_connections / platform_ad_executions / platform_ad_creatives。另以 sqlite3 -readonly 核对旧本地 PocketBase，这两个原企业没有广告连接及执行记录；不将主页、发布连接或当前沙盒广告当成原企业证据。因此本轮没有新增真实广告关联，统计保持未知，并在生命周期中分别提示账户/回执集合缺失。原文件核验通过不等于发布许可或广告审核通过。
- 原文件失败会阻止服务端平台报告，包括已缓存报告；前端的旧快照恢复规则也同步拒绝此类文件证据失败，不能仅加警告后恢复旧指标。新增测试覆盖匹配/不匹配 SHA 与大小、缺失文件、无冻结指纹、越界/软链接、图片租户隔离，以及文件变化后不得恢复旧 Meta 报告。
- 41 个投流测试文件、TypeScript、架构及构建通过；证据在 `artifacts/platform-ads/raw-file-lifecycle-audit-20261023.json`。这是本地只读核验，不是原企业真实非零投放指标或生产上线验收；需要原企业实际账户授权及精确广告上传/创建回执后才可继续关联。

- 开发起点 `204419822b09ec2878c0627ab01f61432b7bd35b`，工作区干净。本轮变更仅留在投流功能分支；未合并、推送、部署或修改基线。前端 5187、后端 8890、隔离 PocketBase 8891 保持独立。
- 用户明确授权两套来源分别接入并保留企业标识。服务端通过 `PLATFORM_ADS_HISTORY_SOURCES_FILE` 的本地显式 allowlist 授予当前沙盒企业只读访问；配置包含 viewerTenantId、source id、原 tenantId、原名称及明确目录，不接受浏览器传入路径或替换租户。未配置时不开放外部数据源。配置保存在隔离 runtime 的 ignored 文件内，不进入公共部署配置。
- `customer-history`：local-preview-1002 的 data/local-store，企业“本地预览测试”，13 条项目；3 条服务端成片血缘对应 2 个不同文件 SHA。`preview-history`：mobile-dual-edition-20261012 的 data/local-store，企业“灵枢本地预览”，22 条项目，其中 13 条关联图片任务，当前无同款社媒成片血缘。22 条项目不等于 22 个可投放文件。两个源工作树均未修改。
- 来源目录、分页、选中详情、生命周期与旧报告恢复均保留来源 scope；相同项目 ID、素材 ID 或 SHA 不构成跨企业映射。新来源用标准 Ant Select 和 Drawer；原素材库及历史详情继续复用统一生命周期组件，不新增一级页面或模拟指标。
- 文件只使用显式只读打开，不初始化源 DataStore、不触发源库迁移、锁或写回。核对原企业 Project → Task → Artifact → File 的精确标识、文件用途/类型/SHA，明确这是持久化记录核验，不冒充原文件字节核验或投放准入。历史版本 superseded/review_required 分别标为已替代/待内容审阅，不改成审批通过。
- 生命周期只在原企业集合内查找同版本绑定与 VERIFIED 创建回执，再使用原连接、账户、四层资源、上传证据和 Meta maximum 报告读回。复用原报告解析器；缓存增加数据源及快照命名空间。原账户授权不可解密、回执不全或素材不一致时保持未知并提示，不借用沙盒授权或报告。最多展示 20 个去重账户/广告，超限明示。
- 09:40:23（Asia/Shanghai）实库接口验收：两套项目数 13/22，核验血缘数 3/0；原来源均不存在 platform_ad_creatives 集合，所以历史素材尚无可核验广告关联，不填充沙盒数据。所检查的源集合内容及广告集合的“不存在”状态前后完全一致。证据：`artifacts/platform-ads/external-history-readonly-20261023.json`。
- 09:41:28 原两条沙盒广告只读复核仍为 PAUSED / PENDING_REVIEW；原任务版本、创建回执、素材映射不变；近 7 天与 maximum 均无平台统计，不填零。没有新建广告、素材上传、账户修改、账单变动或 Meta 应用创建。隔离服务固定 web-only，不运行后台调度；重启需使用完整 runtime.env，不能恢复默认 all 角色。
- 定向测试新增真实来源隔离、同 ID/SHA 碰撞不得借用目标沙盒、源文件不变、无授权与非法路径拒绝、损坏文件/越界软链接失败、原企业模拟 Meta GET 报告与错误不补零。原有 40 个投流测试文件、TypeScript、架构和构建均通过；真实历史企业尚无投放回执，非零历史消耗/购买/询盘未获实库验收，不能宣称上线或全平台历史回填完成。经营利润 ROI 和 CRM 有效询盘仍需独立可验证归因输入。

## 10 月 23 日复核与历史素材生命周期联通

- 开发起点 `faae7b9c6147d83ffd3e71cbdeb46c85011ed7ef`，工作区干净。仍为隔离功能分支、5187 / 8890 / 8891，无合并、推送、生产部署或数据库迁移；本轮真实 Meta 操作只允许 GET，不创建/补建/上传/激活、不改账单。
- 00:09:35（Asia/Shanghai）原两条沙盒广告最新读回均 PAUSED / PENDING_REVIEW；原版本 Traffic 2 / ThruPlay 1 和创建回执未变。近 7 天日期实际滚动到 2026-10-17—2026-10-23，仍 totals=null，三页缺失数据不补零。
- 新增只读 `creative-history`（Studio 历史 / 已保存社媒成片两个直接数据源）与 `creative-lifecycle`。不复制素材、不新增映射表；复用 studio_projects、社媒成片、冻结投放绑定和原执行回执。Studio 仅信任已有服务端 social_content_output 血缘，逐一核对源任务/成片 ID 与持久化文件 SHA；普通旧草稿、仅客户端 SHA 或缺血缘项目显示“未核验”，不靠标题、URL 猜测投放关联。
- 统一生命周期组件供投放素材来源目录、已投放素材详情、我的创作成片预览和历史素材详情使用。相同源版本的关联广告按账户/Ad ID 去重，最多展示 20 条；读取截断和部分失败明确提示。源版本变化、跨租户和上传证据不一致不得挂入当前 Meta 数据；失败保留同源、同账户/广告的旧报告，逐条显示采集时间，不冒充最新。
- 生命周期读取 Meta `date_preset=maximum` 的可用历史汇总，显示平台实际返回的窗口；空报告不编造历史起点。不请求无限日明细、不宣称无限终身覆盖；范围仅本系统已记录且核验的绑定，不是全账户或全平台素材总账。
- 新指标严格分列：actions.lead（Meta 归因线索）、actions.onsite_conversion.messaging_conversation_started_7d（Meta 新消息会话）、action_values.omni_purchase（归因购买金额）、purchase_roas.omni_purchase（购买 ROAS）。不累加重叠父子 action_type；缺失或重复类型保持 null，真零保留 0。数据页自定义列和 CSV 标明 action_type；沿用同一币种、账户时区、展示时间回报及广告组统一归因设置。
- Meta 线索/消息会话不是 CRM 有效询盘，购买 ROAS 不是利润 ROI。订单利润、CRM 去重与跨触点归因尚未接通；ROI / CRM 有效询盘明确未接通，不生成虚构指标或用点击、播放代替。没有新增 Pixel/CAPI、线索明细抓取权限或账单配置。
- 补齐计划页实时 issues_info 提示。修复页面跨账户日期边界后仍保留旧“近 7 天”窗口：聚焦和每分钟仅检查账户日期，日期变化才只读刷新；自定义日期不自动改动，关闭视图清理监听器。
- 回归覆盖最大可用历史超过 93 天、精确 action_type/零/缺失/重复值、两来源同一 Meta 报告、源版本与跨租户隔离、不可验证历史不误关联、读取失败保留旧版本范围及原计划/回执不变。源码验证和实际非零归因、审核通过、生产上线是不同结论。
- 字段依据：[Meta AdsInsights 官方 SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)。无利润与 CRM 归因输入，不能仅凭 Meta 广告数据计算经营利润 ROI。
- 源码验证：39 个投流测试文件通过；历史去重、血缘、封面与分析 13 项测试、历史素材列表 SSR 1 项测试通过；TypeScript（仓库 lint）、架构检查 2246 生产文件、构建和 Studio 分包预算通过。没有修改主生产工作台、排期或 CRM 结构，仅在历史详情接入共享只读组件。
- `6e97bae5d05b26dbde1a6c9abaa01fcd01505df4` 同版本前后端重启后，00:26:02 真实验收通过：两条广告仍暂停/待审核，17 个原生指标字段及 maximum 参数被 Meta 接受，窗口为空时 windowAvailable=false；未改变原任务、回执、目录映射。隔离库 Studio 历史为 0 条、已保存社媒成片为 1 条，未为演示复制生产历史或新建项目；真实双端历史回流需有已核验历史记录，当前由隔离测试验证血缘联通。
- 浏览器发现并修复新增生命周期宽表撑宽父级 Grid，以及旧投放表格 nowrap 样式影响口径说明的问题：使用 minmax(0,1fr)、内部宽表滚动和显式换行。桌面主区 clientWidth=scrollWidth=1277，窄屏主区 clientWidth=scrollWidth=252，表格自身保持 1500px 内部滚动；不调整全局缩放，不覆盖其他模块样式。

## 三页端到端联调与口径收口（本轮增量）

- 起点 `018d6444c0ba83f07bf15a63ecc92b5977906320`，工作区干净；仅功能分支与 5187 / 8890 / 8891，无基线合并、推送或生产部署。现有两条沙盒广告为唯一真实验证对象，不创建、上传、补映射、启用、改预算或改账单。
- 发现并修复素材报告与数据报告的双链路：素材曾用保存的连接时区、默认归因和日报自行算成本；现共用 `getMetaPerformanceReport(level=ad,preset=7)` 的实时账户元数据、展示时间回报、广告组统一归因、平台窗口汇总、原生单次成本和缓存。只读资源归属核验抽到 `executedCreative`，保留原导出契约，不新增路由或表。
- 素材“结果”依据真实 `optimization_goal`，LINK_CLICKS 与 THRUPLAY 分开；未知优化目标不冒称点击/播放。平台未给成本时保持 null，原生真零保留 0；不再以 spend/results 重算。素材页增加归因窗口说明，全部点击明确标注，未返回归因窗口不推断。
- 修复数据页、素材页翻页过程中可能继续展示旧页目录：页码与返回目录一致才可展示，翻页失败不冒充当前结果。切换计划时释放旧账户选择，明细搜索明确不改变上方资源范围小计；无效日期不能显示/导出旧报告。
- 浏览器验证 ThruPlay 的系列、广告组和广告层级查询；广告级 `120330001417559616` 返回 PAUSED / PENDING_REVIEW、THRUPLAY、CNY / Asia/Shanghai。今天查询实际窗口为 2026-10-22 单日，空数据保持“—”；切换未填日期的自定义周期显示校验并禁用导出。
- CSV 已实际下载到 `Downloads/Meta-ad-报告.csv` 并核对：真实账户与 Ad ID、CNY、Asia/Shanghai、单日窗口和采集时间正确；所有未返回指标为空单元格，不补零。浏览器下载事件等待曾超时，但文件已落盘，不将工具超时误报为平台或产品失败。
- 回归覆盖两页共用同一采集时间/缓存、Meta 时区覆盖过时连接时区、成本精度 2.005 与 1.234、零/缺失/空报告、真实目标覆盖本地标签、未知目标以及账户/币种/资源 ID/分页异常拒绝；所有供应商测试仅 mock GET。最终 39 个投流文件、TypeScript（仓库 lint）、架构检查 2242 文件、构建和 Studio 分包 497093 / 500000 字节均通过，`git diff --check` 通过。
- 字段依据 [Meta AdsInsights 官方 SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)。仍不声称审核通过、非零消耗/归因或生产发布就绪；真实创建/状态变更不属于本轮只读验收。

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
# 素材管理产品优化检查点（2026-10-23）

- 在 `feature/platform-ads-meta-workspace-20261022`、5187 / 8890 / 8891 开发，起点 `1026906d5dd81c718f9f3e2e87fae6e00a5fed21`；没有合并、推送、迁移或修改基线。
- 素材页默认打开创作素材，两套授权企业分组展示、独立搜索分页；宽屏并列、窄屏纵向排列。投放素材保留账户隔离。原始标识、指纹和统计说明折叠至详情。
- 新增鉴权只读原视频预览：只接受授权来源和项目身份，核对项目血缘、租户目录、文件 SHA/大小，限制读取上限且返回前再核对字节；不使用 URL、名称或其他企业的封面补位。浏览器从真实视频提取首帧，不自动播放或上传。
- 文件缺失、成片待核对、未关联广告、平台暂无数据、读取失败分别展示；空报告不补零，利润 ROI / CRM 询盘不冒充 Meta 指标。
- `verify-external-history-readonly.mjs`：源集合未变，13 / 22 条项目分别读取；3 条成片血缘对应 2 个真实视频，5 个图片输出文件缺失；两套来源均无已确认广告关联，不借用沙盒资源。
- 已通过 41 个投流测试文件、定向路由/原文件预览授权与指纹测试、TypeScript、架构检查、Vite 构建、Studio chunk 预算；这是本地产品验证，不是上线或供应商全链路验收。

## 计划创编与素材选择（2026-10-23）

- 起点 `bd678120243af06f24881a847f528a0919319f99`，仅投流功能分支和 5187 / 8890 / 8891；不写原企业源库，不变更广告、账单或授权。
- 新建/编辑计划与账户绑定共用 `AdMaterialPicker`、`AdSourceCatalog`、原文件封面。选择写入既有 configuration JSON 的 materialSource，保留企业 ID、任务/成片版本和 SHA，无新增数据库迁移。旧客户端配置编辑保留来源，显式 null 才清除。
- 服务端在选择、保存草稿、账户绑定时重新核对当前企业、原始文件 SHA/大小、MP4 与 64 MiB 上限；投放选择要求内容成片已审阅通过。预览不授予选择权，待审阅素材仍可查看原文件封面；跨企业只读来源不自动转为当前企业可投放素材。
- UI 只读检查确认现有当前企业测试视频仍为 draft，显示真实封面但禁止选择并提示内容审阅；没有为了演示修改其审核状态。外部企业缺失文件/无成片/仅只读权限分别禁选并说明原因。
- 定向测试覆盖已批准素材选择/保存/编辑/清除、审核变化、文件变化、伪造来源/指纹、跨租户、媒体与选择接口鉴权。浏览器只验证抽屉/预览/禁选/返回，不保存新真实计划、不绑定或上传平台资源。

## 素材可选性规则纠正（2026-10-23）

- 起点 `a6a7ee47b26f6cc919e084556a3a5c7f86bf5316`。本节取代上一节“投放选择要求内容成片已审阅通过”的过严规则：内部内容状态仅描述工作流，不作为 Meta 审核状态，也不单独阻止有权限的可用文件被选择。
- 继续校验企业权限、来源身份、文件 SHA/大小、MP4 与当前上传链路大小上限；外部企业只读来源不自动授予跨企业复用权。封面加载失败不阻止已经服务端核验文件可用的素材被选择。
- 分开展示文件可用性、内部内容状态、使用企业范围、投放数据是否返回、Meta 广告有效状态；内部 draft 显示“尚未确认”，不会改写为 Meta 待审核。
- 服务端返回真实内部状态，保存时重新读回而不信任客户端状态字段；draft / review_required / approved / superseded 均按同样文件和权限规则验证。测试确认选择和保存不修改源审核状态，文件损坏和越权仍拒绝。
- 浏览器实际选中现有 draft 测试成片并带回创编表单，来源与“内部内容：尚未确认”保留；未保存新真实计划、未写源库、未绑定上传、未创建或启用广告。

## 草稿—编辑—本地绑定—素材回看（2026-10-23）

- 起点 `56496a4308610725d2d096295e4868c9d67c6185`，仍仅功能分支和 5187 / 8890 / 8891；未修改基线、原企业源库或内容审核状态。
- 浏览器复用已选原成片，新建唯一一份隔离草稿“素材链路联调 · 2026-10-23”，再编辑同一草稿的受众说明，绑定现有 `Ads Integration Sandbox` 账户的本地素材记录，不调用上传或广告创建。
- 草稿 `5mafh6z0g8bcvjh`，本地绑定 `4dd02d2c91b9e87`，任务/绑定版本均为 3；状态 draft / pending，platformVideoId 为空，执行回执 0 条。保留源企业 `h4f24n6styjmymf`、源任务 `meta-live-integration-20261022`、版本 `meta-live-original-test-video`、原文件 SHA `558a360f67bd67577f88ab10996c24edfb8a48daf982e618efe7bf9e7c8a96ac`，内部内容仍为 draft。
- 修正绑定区换选后来源未写回计划的问题：绑定时更新 canonical materialSource 与名称并读回校验，其他配置保留。旧本地绑定不会冒充已更换/已清除选择的当前草稿素材；已执行广告历史继续保留。
- 本地未上传绑定直接预览真实源视频首帧，不误报缺少映射；仅媒体展示不读取其他计划的广告表现。详情实际显示这份草稿、“尚未创建广告”和未知指标 —，不借用同文件已有沙盒广告的数据。
- 方案版本变化后提示重新确认绑定，阻止旧版本上传/用于创建。素材管理从计划进入时显示计划名称而不是裸 ID。
- 原企业来源只读复核：13 / 22 条项目、3 条核验成片记录 / 5 个缺失图片输出，源集合签名未改变。联调只新增 1 个本地草稿和 1 个本地绑定，未重复上传、未创建或启用广告、未改账单。

## 同账户既有 Meta 视频复用（2026-10-23）

- 起点 `6949340c05217272a41ead180b67271c598bf6cb`，仅投流功能分支和 5187 / 8890 / 8891；不改基线、源库、审核状态、账单或现有广告。
- 绑定新增复用查找：同企业、同 Meta 实际账户（支持同账户不同本地连接）、同源任务/成片版本/文件引用/指纹/大小/MIME，完整已就绪上传回执和真实 requestId；使用当前账户凭据进行视频 id/status 只读核验，未就绪或读取失败不降级为新上传。
- 只保存目标绑定的复用元数据，保留来源绑定 ID、原上传请求 ID和核验时间；不修改原绑定，不复制原广告 mappingExecutionId，不复制或创建任何广告回执。旧待上传绑定的上传入口同样先查复用，防止通过旧入口重复上传。
- 复用联调复用已有草稿 `5mafh6z0g8bcvjh` 与绑定 `4dd02d2c91b9e87`，二者版本更新为 4。核验并复用现有视频 `1580768800024852`，目标状态 ready，账户为 `1640686001100669`，内部内容仍 draft，源企业和 SHA 未变，目标执行回执为 0；未增加视频、广告、草稿或绑定记录。
- 页面共用“已复用 Meta 视频”状态。计划范围筛选在素材分组前执行，避免将其他计划的广告数带入当前计划。数据页明确“已复用 Meta 视频，尚未创建广告”，指标 —，不继承来源计划消耗、审核或报表。
- 新增复用隔离/证据/只读状态/原回执不变/旧入口零上传测试；已通过 42 个投流测试文件、类型检查、构建、架构与 Studio chunk 预算（最终交接以实际命令输出为准）。

## 账户真实历史与账单核对（2026-10-23）

- 起点 `123cd3f9668c64f81089923150f24f375eb2c17d`，仅现有投流分支和 5187 / 8890 / 8891。无数据库迁移、源库写入、素材挂接、广告创建/启用或账单变更。
- 对两个既有连接分别 GET 账户 `amount_spent,is_prepay_account` 和 Insights `level=ad,date_preset=maximum,spend>0`：Lucy Chang（1306761139191078）与 Ads Integration Sandbox（1640686001100669）均返回累计花费原值 `0`、非预付、历史行为空且无下一页。不得由此宣称所有 Meta 账户都无历史；范围仅当前企业已接入的两个账户与平台可用历史。
- 新增 GET `/connections/:id/history`，使用租户隔离的已有凭据；直接读取平台广告，不要求本地执行回执，不创建本地计划。核验账户/币种/日期/正花费/广告去重；只将 cursor 带回固定 Graph 路径，不跟随含令牌的 next URL。最多读取 1000 条，截断明确提示且不汇总。
- 投放数据默认“账户真实历史”，本次浏览器确认默认 Lucy Chang；原沙盒验证保留为非默认“本地计划回执”。Meta 线索、新消息会话分别展示，购买 ROAS 使用原生字段；缺失为“暂无数据”，不伪造有效 CRM 询盘或利润 ROI。
- “账单与付款方式”显示平台返回的预付类型，跳转 Meta 官方账单页后由用户核对账户。当前不支持站内代收、充值订单或资金划拨，不采集卡信息，不显示虚构余额。API 的 balance 不能未经口径确认冒充可充值余额。
- 只读打开官方账单 URL，当前 IAB 会话进入 Meta 登录页，未登录、未查看账户账单明细、未执行充值或支付；因此仅本地产品入口和历史读取通过，不宣称支付链路验收通过。
- 验证：43 个投流测试文件通过；新增历史原生字段/分页/归属/空数据/账单拒读测试，以及路由鉴权/跨企业拒读与前端默认范围测试。TypeScript、Vite 构建、架构和 Studio chunk 检查通过。截图在 `artifacts/platform-ads/account-billing-readonly-20261023.png`。

### 补查授权账户范围与产品补齐

- 上述“两账户无消耗”只覆盖本地已连接账户，不能代表令牌的完整授权范围。继续只读调用 `/me/adaccounts` 发现第三个既有账户：灵枢联调验收账户 `1368550458638225`。没有新建或重新关联 Meta 账户。
- Meta GET Insights 返回广告 `120248796256110142`，名称 `UI acceptance - manual - 2026-09-12`，广告系列 `120248796255170142`，窗口 2026-09-12 至 2026-10-23，CNY 花费 10、展示 154；lead、新消息会话、购买金额与购买 ROAS 均未返回。账户返回预付类型。不得把该记录当成灵枢本地或沙盒计划，也不向历史素材挂接。
- 首次发现是开发者手动只读查询，原产品确实缺少授权发现能力。随后新增 `/connections/:id/history-accounts` 和 `/connections/:id/history/:accountId`：使用当前租户既有授权，只读取平台授予的账户清单；请求额外账户的报告前服务端核对实际授权成员。失败不得宣称授权范围内没有消耗，不跟随 next URL、不持久化新连接、不写源库。
- 浏览器普通刷新 5187，已自动发现该账户并展示平台花费 10、展示 154。账户 ID 和广告数字未硬编码到前端，线索/会话/ROAS 缺失明确提示。读取历史不创建本地计划、广告或付款订单。

## 三页面统一授权账户与平台素材（2026-10-23）

- 起点 `4bd5e0e585dae40ee59d6bf7ad999c0fe1b529bf`，仍在投流功能分支与 5187 / 8890 / 8891。原问题是历史数据仅接入一个视图，且 selectedDraft 可使数据页默认跳到本地回执；这不是 10 元历史记录丢失。
- 新增共享 `/account-directory` 和页面级目录上下文。计划、数据及平台素材共同读取、保持所选账户；身份变化隐藏旧目录，账户授权消失不静默切换到其他账户。数据页固定默认“账户真实历史”，本地回执明确不包含平台已有广告；创编列表同时展示只读平台历史与本地计划，不伪造导入草稿。
- 创编新增账户选择，明确匹配原生币种，不进行汇率换算。用户确认时服务端重新核验既有授权、账户 ID、状态和币种；`use-granted-account` 只在隔离投流库登记本地连接，平台请求均为 GET。按企业与账户加锁，重复确认复用原连接，不增加 Meta 账户或广告。
- 草稿 configuration JSON 增加可选 accountConnectionId，保存/再次编辑/旧客户端更新保留，显式清除才移除；服务端验证本企业、币种、渠道。素材绑定、预检及创建执行拒绝与已保存草稿不同的账户。未修改源审核状态，无数据库迁移。
- 素材页新增“平台广告素材”：从同账户真实历史广告 ID 回读 Ad → Creative → 视频 ID / 图片 hash / 缩略图，逐层核对账户归属。详情展示原生广告状态、窗口、花费、展示和缺失的线索/消息/购买 ROAS。未核验本地原始字节的来源明确独立管理，不按名称或平台 image_hash 冒充 SHA-256 匹配。
- 浏览器实际验证：创编列表可见该 10 元、154 展示历史广告；确认既有账户后，仅新增本地连接 `vhc0wqyvrizbke4`（账户 1368550458638225，CNY），取消未提交的创建表单，真实本地计划总数仍 4。没有新建或启用广告、上传素材或修改账单。草稿保存/再编辑/清除和跨企业、币种、账户拒绝路径使用独立测试库验证。
- 浏览器跨页面验证：选 Lucy Chang 后数据和平台素材均无该 10 元记录；切回原账户后自动读取对应广告和真实封面。原有两套企业创作素材仍分别展示、只读；未挂接本轮平台历史广告。
- 真实历史广告回读 configured/effective 均为 ACTIVE，原样展示；本轮没有修改其启停，也不能将其描述为“已暂停”。沙盒测试资源未操作。
- 已通过 45 个投流测试文件、TypeScript、Vite 构建、架构与 Studio chunk 预算。截图：`unified-plans-history-20261023.png`、`unified-plan-account-picker-20261023.png`；最终页面截图以交接附件为准。本轮不包含广告创建、支付或生产发布验收。
# 新个人账号：Meta 官方绑定引导（2026-10-23）

入口：5187 → 投放管理任一页面 → 连接广告账户 → Meta。

1. 登录 Facebook：前往 Meta 官方页面，由用户本人登录并同意现有应用的权限请求。密码、验证码和令牌不在灵枢输入。
2. 选择广告账户：读取该身份授权的账户，显示原生账户名、币种、时区和 ID；受限或状态未知的账户不可进入下一步。
3. 选择主页：取本人已获广告任务权限的主页与该账户 `promote_pages` 的交集；不会自动建立平台资产关系。
4. 确认连接：再次核验账户、主页和主页素材访问权限，加密保存账户凭证与默认主页。新计划带入账户；主页仅在已授权列表中仍可核验且表单为空时带入，不覆盖已有计划的主页。

关闭后重新打开，同一登录身份在当前浏览器运行周期内可恢复未过期授权进度；完整刷新页面后需重新开始。授权会话有效期 10 分钟；取消、过期、弹窗拦截、空账户和无可投放主页均有单独提示。只保存本地连接，不创建或启用 Meta 广告、上传素材、充值或改变预算。

## 现有应用配置前置条件（不是让用户复制令牌）

5187 对应的隔离服务需由管理员提供**现有应用**的 `META_ADS_APP_ID`、`META_ADS_APP_SECRET`、`META_ADS_REDIRECT_URI` 和有效的 `META_ADS_API_VERSION`。密钥仅写入隔离服务环境，不进仓库、浏览器或聊天。回调地址须与该现有应用后台登记完全一致，路由路径为 `/api/overseas/platform-ads/oauth/meta/callback`，公网须 HTTPS；不得随意推断可达域名或创建新应用绕过。

当前请求权限：ads_read、ads_management、pages_show_list、pages_read_engagement、pages_manage_ads。是否能供新的普通用户授权，还取决于**现有应用**的登录产品、开发/上线模式、角色、权限高级访问和 Meta 审核；环境变量齐全只代表配置就绪，不代表这些条件已通过。

2026-10-23 只读检查：隔离 runtime.env 的应用 ID、密钥和回调地址缺失；当前企业在隔离库的 `tenant_platform_apps` 中无 Meta 应用记录，共享社媒 OAuth 配置也无可用客户端。因此未发起新个人账号的真实 OAuth，不声称外部授权验收通过。普通用户不再回退到复制令牌。

## 存储与验收边界

独立增量迁移 `1792713600_platform_ad_default_page.js` 仅增加 `platform_ad_connections.defaultPage` 可选 JSON。5187 隔离 PocketBase 8891 已定向补齐此字段（不是运行全部迁移），历史企业源库及基线不变；正式迁移账本未推进。默认主页是选择偏好，不是永久权限证明，真实执行仍重新核验。

新增模拟测试覆盖：配置阻断、弹窗降级、受限账户禁选、账户/主页选择、最终确认、跨企业/跨用户/未授权资产拒绝、取消和过期、账户分页与凭证不泄露；模拟运输只允许 OAuth 换码 POST，其余 Meta 调用均为 GET。真实新用户登录需待现有应用管理员补齐上述配置后由用户完成。

## 独立 HTTPS 回调提案：开发与未来生产（2026-10-23，待确认、未启用）

本节仅为实施提案，不是部署、DNS/TLS/隧道开通或 Meta 白名单修改指令。保持 `feature/platform-ads-meta-workspace-20261022`、前端 5187、后端 8890、隔离库 8891，不触及基线及历史企业源库。

### 已核实事实与本轮边界

- 继续使用唯一现有应用 `2204714410308727`（Lingshu Ads Integration）。Chrome 已可管理该应用；本人重新验证完成，但本地服务尚未保存 App Secret，不重置密钥。
- Meta 设置页显示应用已发布，网页与客户端登录开启，HTTPS 与精确跳转匹配保护开启。应用发布状态不等于五项权限对所有新用户具备高级访问权限。
- 用户曾确认登记 `http://127.0.0.1:5187/api/overseas/platform-ads/oauth/meta/callback`。提交后重新加载，白名单仍为空，原生 URI 检查仍无效；因此不声称登记成功，也不将原因武断归为仅 HTTPS 限制。截图：`artifacts/platform-ads/meta-local-callback-not-effective-20261023.png`。
- 本轮只批准准备 HTTPS 方案，具体地址和访问范围确认后才能启用。未创建隧道或登录配置，未安装客户端、申请证书、改 DNS 或服务器，未发起新 OAuth、创建或启用广告、上传素材、改预算/账单。

### 拟用地址（不是已开通地址）

| 环境 | 拟登记的精确回调 URI | 接收目标 |
| --- | --- | --- |
| 5187 本地联调 | `https://ads-auth-dev.lingshu.site/api/overseas/platform-ads/oauth/meta/callback` | 独立回调网关，转交本机隔离后端 8890 的同一路径 |
| 未来生产 | `https://app.lingshu.site/api/overseas/platform-ads/oauth/meta/callback` | 正式 HTTPS 入口，直达正式后端；不经过本机或开发隧道 |

以上域名基于现有应用资料中的 `app.lingshu.site` 提出，尚未核实 DNS 管理权、边缘服务账户或证书覆盖。当前本机 DNS 查询返回 198.18.0.0/15 范围地址，不能作为公网解析、域名归属或服务可用证据。生产 URI 仅为未来目标，须以部署时确认的正式域名为准；本轮不访问或改动生产服务器。

### 开发接入：只能穿透回调，不能穿透整套系统

浏览器完成 Meta 同意 → 拟用开发 HTTPS 域名 → HTTPS 中转 → 独立本地回调网关（拟监听 `127.0.0.1:8892`，启用前先检查占用）→ `http://127.0.0.1:8890/api/overseas/platform-ads/oauth/meta/callback` → 隔离授权会话。

5187 页面仍只在本地使用，并以现有登录身份轮询本地授权结果、读取账户/主页和确认连接。不会把回调域名当成远程工作台，也不对公网反向代理 Vite、8890 全部 API、8891 数据库或原始素材文件。

- 仅接受 GET 且路径精确等于 `/api/overseas/platform-ads/oauth/meta/callback`；其余路径 404，其他方法 405。不允许通配 `/api`、`/media`、静态资源、WebSocket、管理后台、账户列表、连接或广告创建接口。
- 上游目标固定为本机 8890 的这一条回调，禁止客户端指定 URL/主机/端口、路径重写和跨环境分流。拒绝重复关键参数、过长请求和异常编码；白名单参数限 `state`、`code` 或平台取消/错误字段。
- 不向上游转发浏览器 Cookie、Authorization 或任意转发头；响应禁缓存、禁止 Referer 泄露，不输出密钥或令牌。代理、网关、错误页与监控全部禁止记录完整查询串、code/state、请求体和凭证；只记录无敏感参数的请求编号、结果码和耗时，并设定限流/并发上限。
- 不以 Meta IP 白名单或固定 Origin 代替 state 校验：OAuth 回调由用户浏览器访问。现有后端生成随机 state 并保存哈希，绑定发起人和企业、10 分钟到期、单次交换及锁校验；无效、过期、重复或其他环境的 state 必须失败关闭。
- 浏览器回到本地页面后，账户/主页选择仍受当前登录身份校验；回调接收成功不等于账户已连接、权限永久有效或广告已创建。

中转候选为用户自己管理的 Cloudflare Named Tunnel，绑定上述稳定子域名，入口规则精确匹配回调，最后一条为拒绝规则；必须同时有本地独立网关作第二层边界，不直接把 tunnel service 指向 5187/8890。此候选未安装、创建或启用，也未核实用户账户、套餐及 DNS 兼容性；不创建付费资源、购买域名或承诺第三方永久免费。有任何付费要求就停止请示。

**需确认的数据访问范围：** HTTPS 边缘中转商会终止 TLS，因此能接触授权 code、state 和客户端网络元数据；不能承诺其完全看不到参数。App Secret、访问令牌、账户报表及素材不发送给中转商，换码仅由隔离后端直接调用 Meta。若不接受该第三方信任边界，可改为用户自管的独立 HTTPS 中转；服务器变更必须另行授权，不借用生产回调暗接本地。

### 未来生产：正式 HTTPS 入口直达正式服务

- 使用正式域名的有效受信 TLS 证书，由正式入口对精确回调路径单独配置日志脱敏、限流、超时及响应安全头；正常工作台/API 保留自己的身份与企业权限边界。正式回调必须在服务端固定配置，不从请求 Host、前端参数或重定向参数拼接。
- 生产 `META_ADS_REDIRECT_URI` 固定为已确认的正式 URI；开发只配置开发 URI。换码所用 redirect_uri 必须与该次授权发起的一致，不通过 HTTP→HTTPS 或跨域二次跳转纠错。
- 仍复用同一个 Meta 应用；开发、生产使用不同登录配置（如该企业登录产品要求 config_id）、不同数据库/加密存储和运行凭证。**同一应用的 App Secret 本身是共享信任根，不宣称两套环境有独立 App Secret；重置它会影响所有环境，未经单独批准不能重置。**
- 现有应用的企业登录配置尚未建立。需核实 Meta 当前配置允许的用户令牌类型、原五项权限和资产选择；代码接入相应 config_id，不把旧 scope URL 当作已通过企业登录验收。普通用户的高级访问、应用审核和业务资产权限需分别核验；不扩大为 WhatsApp、发布、账单或其他无关权限。
- 多实例共享正式授权会话持久化和分布式单次交换锁，不能依赖单进程内存。state 的开发记录不导入生产；开发授权凭证和沙盒连接不迁移成正式客户的授权。
- 正式上线另行执行仓库规定的 Git/SSH 部署和验收流程，本轮不部署。稳定后移除开发 URI/停掉开发通道需另行确认，只移除开发入口，不撤销用户整套 Meta 授权。

### 启用前必须再次展示并确认

1. 实际 HTTPS 主机名、DNS 管理权、证书、第三方中转主体与是否有费用（无明确同意不得付费）。若候选域名不可用，提供替代地址重新确认，不偷偷换随机公网域名。
2. 精确路径与 GET-only 访问范围，以及仅转发至 127.0.0.1:8892 → 8890 回调的配置；通道拒绝 `/`、其他 API、数据库和素材访问的离线测试证据。
3. 持久化 Meta 精确白名单、原五项权限用户登录配置及本地秘密保存方式。复核 HTTPS/严格匹配保护不变，密钥不进入聊天、版本控制或公网网关。
4. 用户批准后才安装/启用通道、改 DNS/Meta 设置和隔离运行配置；实际 Meta 同意页若增加权限或要求验证，交由用户确认。核验回调、账户、主页选择和重复/过期 state 拒绝；不执行广告创建、上传、激活、预算和账单操作。
5. 恢复点：停止开发通道即可关闭公网可达性；恢复隔离服务原环境配置，不删原连接/历史，不操作基线或源库。移除 Meta/DNS 条目亦需明确核对目标，避免误删生产入口。

实现参考：[NGINX 精确 location](https://nginx.org/en/docs/http/ngx_http_core_module.html#location)、[Cloudflare Tunnel 官方架构](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)。本节描述的网关与规则是待实现/待测试要求，不是已存在的安全能力或真实 OAuth 验收结论。

### 正式环境优先：已补齐的离线代码与验收定义

2026-10-23 用户明确临时中转商不限，正式服务器链路优先；这不是正式部署、公开整个本地系统或启用付费资源的授权。HTTPS 地址、公开范围和实际启用仍沿用前述确认边界。

- 服务端配置已支持 `META_ADS_LOGIN_MODE=business`（默认），要求 `META_ADS_LOGIN_CONFIG_ID` 为现有应用内的数字配置 ID，授权 URL 使用 `config_id`，不混传 classic scope；确需旧式登录时必须显式使用 `classic`。当前应用配置 ID 尚未建立，不编造 ID，也不据 URL 测试宣称 Meta 已接受权限。
- `META_ADS_OAUTH_ENVIRONMENT` 与应用 ID、回调 URI、API 版本、登录模式/config_id 一起绑定授权 state 哈希；切换环境、应用、回调或配置后不能消费旧 state。没有新增表或复制企业数据；旧算法的未完成授权会话须重新开始，存量账户连接不受影响。
- 当 `NODE_ENV=production` 或 OAuth 环境为 production 时，强制正式 HTTPS 域名与 production 环境；拒绝 HTTP、本机、IP 和错误回调路径，拒绝 URL 内嵌凭证、查询参数与 fragment。开发配置不能被原样复制到正式服务器后静默工作。配置格式通过不代表证书、DNS、Meta 白名单或高级权限已验收。
- 复用现有持久化授权会话及跨进程任务租约锁，不引入内存版生产 OAuth；真实多实例与重启后的回调仍需正式预发布环境验收，不能用单进程模拟结果代替。

正式链路的完成标准必须逐项有真实证据：

1. 正式域名、TLS 证书及回调入口可达；精确回调 URI 已在原 Meta 应用中持久化并被原生检查接受，网关不记录 code/state。
2. 由正式产品入口发起授权，由用户完成 Meta 同意；授权跳回正式域名后，服务端直接换码，绝不把密钥或访问令牌交给前端。
3. 同一正式企业内可以选择有真实权限的账户和主页，正确保存原生币种、时区及来源；刷新/重新登录后仍能读取连接，重复连接不复制已有本地账户。
4. 能读取该账户已有广告和平台报告，并与素材页保持同账户口径；无数据、权限不足、撤权/过期分别提示，不用沙盒指标补齐。验收不需要创建、启用或消耗广告。
5. 拒绝错误/过期/重复 state、跨企业/用户/环境资产；验证多实例共享会话、单次交换和重启恢复。令牌失效要求重新授权，不能因刷新失败显示假成功。
6. 按单独批准的正式部署流程验收服务版本和 readiness；在以上事实未完成前，状态只能是“代码检查通过/待真实授权”，不是“生产链路已跑通”。

本轮代码验证仅用隔离测试与模拟 Meta 传输，无真实 OAuth、DNS/TLS、服务器或广告变更；仅更新功能分支代码及此手册，不启用公网中转，不写历史企业源库。

### 临时 HTTPS 实际准备记录（2026-10-23 16:44，北京时间）

- 用户请求推进真实授权联调，保留具体地址/访问范围的启用确认。新增 `scripts/platform-ads-oauth-relay.mjs`，仅开发运行，默认 `forwarding=DISABLED`。绑定 `127.0.0.1:8892`，固定上游为隔离服务 8890 的精确回调；路径、方法、参数、容量和隐私边界见脚本及测试。只有再次确认后才可带 `--enable-approved-callback` 重启，不能用于生产。
- 定向测试 `node scripts/platform-ads-oauth-relay.test.mjs` 通过：默认禁止、精确 GET 路径、异常/重复参数拒绝、用户 Cookie/Authorization 不转发、响应不泄露上游内容；未调用实际 Meta 或业务接口。`git diff --check` 通过。
- 在 `/tmp/lingshu-ads-https.TW2LCT` 下载 Cloudflare 官方 2026.10.3 arm64 归档，未安装系统服务。发布说明的归档校验值与 GitHub 实际资产元数据不一致，最初校验拒绝执行；继续核对官方 `releases/expanded_assets/2026.10.3` 后，下载归档 SHA-256 `1165d14b6f6360a3b8c283d7d1100024d6ec7cd9bc9e32519e96150645f3ec55` 与官方资产元数据一致，才解包运行。官方页：https://github.com/cloudflare/cloudflared/releases/expanded_assets/2026.10.3 。并非跳过完整性校验。
- 为获得可确认的实际地址，启动无账号 Quick Tunnel，仅指向禁止转发的 8892 网关：`https://nissan-ref-rim-repeat.trycloudflare.com/api/overseas/platform-ads/oauth/meta/callback`。公网实际 GET 验证：该回调 503，正文明确等待批准；`/`、账户连接 API、`/media/test` 均 404。尚未将此地址登记到 Meta，尚未开启向 8890 的转发，亦未启动真实 OAuth。没有改自有域名 DNS。
- 当前阻塞：Chrome 打开该地址实际显示“此页面已被 Chrome 屏蔽 / ERR_BLOCKED_BY_CLIENT”。不推断是哪一个扩展或策略，不绕过拦截，也不改用另一浏览器掩盖问题。截图 `artifacts/platform-ads/temporary-https-chrome-blocked-20261023.png`；已请用户自行允许这个特定域名，或改选自有 HTTPS 域名。
- 下一步前置条件：用户确认上述具体地址/仅 GET 回调范围（含 Cloudflare 可接触 code/state 的边界），并解决实际 Chrome 拦截。随后才可登记 Meta HTTPS 白名单、完成现有应用内原五项权限的登录配置、本地安全保存密钥，再从 5187 发起真实授权，验证账户/主页保存及重新登录读取。地址若因隧道重启而变化，必须重新确认；不拿临时 URL 做未来正式回调。
- 网关会话 `8667`（仍默认禁止转发）、临时隧道会话 `95779`；这些是开发会话标识，不是稳定运维服务。需要关闭时先解析实际 PID/监听和命令再停止，不清理其他工作区或服务器。无 Meta 应用新建、广告创建/启用、预算/账单操作；基线和历史源库未动。本轮不能宣称真实授权已跑通。

### 用户确认后的 Meta 登记结果（2026-10-23）

- 用户明确确认上述随机 HTTPS 地址及精确 GET 回调范围。仅在现有应用 `2204714410308727` 登记该 URI；保存并刷新后仍存在，Meta 原生 URI 检查显示“此跳转 URI 对这个应用有效”。HTTPS 强制与严格模式保持开启。证据：`artifacts/platform-ads/meta-https-callback-valid-20261023.png`。
- 在同一应用内创建登录配置 `Lingshu Ads Local 5187`，配置编号 `1667534818305334`；标准企业登录体验、用户访问口令（Facebook 个人账号登录），仅选 `ads_management`、`ads_read`、`pages_manage_ads`、`pages_read_engagement`、`pages_show_list`。其中 pages_manage_ads 自动依赖 pages_show_list；未选 business_management。Meta 显示创建成功；证据：`artifacts/platform-ads/meta-5187-login-config-created-20261023.png`。这是登录配置，不是新建 Meta 应用。
- 页面明确提示：标准访问权限只能由在此应用中拥有身份的用户申请；当前配置创建成功不证明普通外部客户已有高级访问权限，也不等于已通过真实用户授权验收。
- 重新加载 Chrome 回调页仍显示 `ERR_BLOCKED_BY_CLIENT`。用户提出由代理操作放行，但浏览器安全拦截须由用户亲自处理；未关闭扩展/保护、未绕过错误页、未通过其他浏览器传递真实授权码。8892 转发仍关闭，未将 App Secret 读取或写入配置，未发起真实 OAuth，账户/主页保存与重新登录读取仍未验收。
- 当前功能分支 `feature/platform-ads-meta-workspace-20261022`，HEAD `9579eb3bd14d4d9780c19e569e810cefed253105`；5187/8890/8892 监听保持独立。本次只写此功能工作树验收记录及现有应用的已批准登录配置，未改基线、历史源库、广告状态或账单。

### 多企业客户上线资格只读核对（2026-10-23）

本轮仅导航与读取现有 Meta 应用/业务资产组合，没有加入审核、提交验证、确认技术提供方身份或更改权限。

| 核对项 | Meta 后台实际证据 | 上线判断 |
| --- | --- | --- |
| 应用所有者 | Business Suite 应用列表选中 `2204714410308727`，详情明确“所有者：Robert”，业务资产组合 `3124707611058974` | 必须先由负责人确认该组合用于正式经营的法定主体，不能按显示名猜测公司 |
| 公司验证 | 业务信息明确“未验证”；公司法定名称、地址、电话、网站均未填写。安全中心显示“符合认证资格 / 开始验证” | 资格不是验证通过，当前阻塞外部客户上线 |
| 原五项权限 | ads_management、ads_read、pages_manage_ads、pages_read_engagement、pages_show_list 均显示“准备测试”；ads_management 操作菜单仍提供“加入应用审核” | 未看到高级访问获批证据，不应宣称外部非角色用户可用；本轮未新增申请 |
| 测试状态 | 测试页显示营销 API 用例“测试已完成”；ads_management、ads_read、pages_manage_ads、pages_read_engagement 显示“已完成”，pages_show_list 显示 8 次 API 测试调用 | API 测试完成不等于应用审核或高级权限通过；页面提示测试结果可能延迟 24 小时、有效期 30 天 |
| 应用发布 | 发布页有“取消发布”，导航显示已发布 | 已发布不等于具备读取其他公司数据的资格 |
| 技术提供方 | 面板仍提供“成为技术提供方”；只读弹窗要求公司验证、访问权验证、应用审核，并明确身份认定不可撤销 | 未点击“是，我是技术提供方”；需要企业负责人确认，不由代理替公司作不可撤销声明 |
| Marketing API Access Tier | 用例权限页显示“有限访问权限”，283 次调用 | 与单项权限的访问级别不同；不得靠消耗广告或刷调用量提升资格 |

只读证据：`artifacts/platform-ads/meta-permissions-readiness-20261023.png`、`meta-business-verification-required-20261023.png`、`meta-tech-provider-requirements-20261023.png`。官方技术提供方与验证文档链接由 Meta 后台直接提供；网页抓取 429，规则结论优先采用已登录后台实际提示，不引用第三方转载代替应用状态。

#### 实施责任与顺序

1. **负责人先确认主体**：现有 Robert 组合是否属于正式提供灵枢服务的公司；提供公司法定名称、注册国家/地区、网站和可验证联系方式，资料必须真实且与证明文件一致。不要为了通过审核随意替换主体或新建应用。
2. **可直接继续的开发**：功能分支内完善企业隔离/越权回归、授权取消/过期/撤权恢复、账户与主页权限提示、令牌保密、删除/解绑链路检查；准备五项权限逐项用途说明、审核操作步骤与录屏脚本。不能把测试开关或手工粘贴令牌当作客户正式入口。
3. **需负责人配合**：Meta 官方公司验证资料、邮箱/电话/域名控制验证、可能的身份验证；不可撤销的技术提供方认定；真实数据处理者/子处理者、留存、删除与保护措施的真实性确认。密码/验证码/证件仅在官方页面或批准的安全资料渠道处理，不发聊天。
4. **需再次明确确认的外部提交**：技术提供方认定、访问权验证、五项权限的应用审核提交以及任何附带条款。可先准备材料，不伪填，不自动勾选无法证明的安全承诺，不扩大 business_management 等范围。
5. **正式运行资格验收**：固定生产 HTTPS 与隐私/数据删除入口真正可达后，由真实外部企业管理员（非本应用管理员/开发者/测试员）完成授权；至少两家独立企业验证账户/主页选择、保存重登、越权拒绝、历史报表与素材对应、解绑/撤权。仅现有资产只读，不创建/激活广告，不操作账单。正式部署另行授权。

本轮仅追加验收记录，`git diff --check` 为文档变更检查；没有以单元测试代替审核批准或生产验收。当前结论仍为“开发与受控内测，未达到多企业正式上线资格”。


### 当前投流预览恢复与客户授权缺口（2026-10-24）

- 本轮工作树 `/Users/julia1/Documents/ChatGPT/1024真实投流测试`，分支 `feature/platform-ads-chain-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`；保留已有未提交修复。本节只记录该功能预览，不推进或重判 governance 中的共享集成基线。
- 从原 Meta 应用 `2204714410308727` 的官方后台复用 App ID、现有 App Secret、Business Login 配置 `1667534818305334`，仅保存到忽略的本地私有 `.env.local`（0600）。没有新建应用、重置密钥、把凭据写入源码或新增权限。一次工具输出意外包含密钥，已告知用户；需由用户在官方后台轮换，再同步本地配置。本文不记录密钥值。
- 用户当次确认后，尝试追加 `http://localhost:5197/api/overseas/platform-ads/oauth/meta/callback` 并保存。刷新后该地址没有保留，URI 检查明确显示无效；旧 HTTPS 隧道回调仍在。无法据此认定本机 HTTP 回调受支持。严格模式及强制 HTTPS 未改，没有重开临时公网隧道或公开服务。
- 仅重启本地 8990 后端加载已恢复配置，8991 数据库、5197 前端不更换；连接接口返回 3 个连接，OAuth 缺项缩小为 `META_ADS_REDIRECT_URI`，仍为未就绪。Chrome 刷新后登录有效，4 个计划和原有平台历史可见。未发起 OAuth 授权交换、绑定写入、广告创建/启用、预算或账单操作。
- 与 `tmp/platform-ads-chain/backup-before-workflow-fix/data.db` 只读逐行比较，users 1、tenants 1、connections 3、tasks 4、creatives 4、executions 4 均相同。安全恢复点为该备份和 `.env.local.before-meta-reconnect`；不得覆盖恢复后的运行数据。
- 实际运行 `node node_modules/tsx/dist/cli.mjs server/platformAds/oauthConfig.test.ts`、`node node_modules/tsx/dist/cli.mjs server/platformAds/oauth.test.ts` 均通过（使用缓存 Node PATH；离线桩，不是 Meta E2E）。本轮没有生产代码变更，不重述上一轮 lint/架构/构建为本轮新证据。

产品验收仍需补齐，以下为缺口而非已实现能力：

1. 灵枢登录独立于 Meta 授权。授权过期/撤销后继续允许登录和查看历史，仅阻止需要该权限的投流动作；保留账户、计划、素材及回执关联，重新授权更新原连接。
2. 使用平台维护的固定正式 HTTPS 回调和服务端私有密钥，用户只在 Meta 官方页面登录、选账户和主页。开发电脑、随机隧道及人工粘贴令牌不作为客户常规入口；正式域名与部署另行授权。
3. 补齐令牌有效期、数据访问期、已授权限及健康状态；按 Meta 对该令牌类型实际支持的机制续期，无法续期时提供一次重新授权。当前 `oauth.ts` 仅交换 code 并加密保存，广告连接没有上述生命周期字段，不能声称永久有效。
4. 补齐取消授权/撤权、数据删除、到期提示和管理员诊断。用户只看明确原因及下一步，例如“授权已失效，重新授权”“缺少主页权限”“平台连接暂不可用”；不能把平台配置错误归咎于用户密码。
5. 后端已有租户/用户/配置绑定的短期 OAuth 会话、抗重放及同账户更新逻辑；前端授权进度目前仅进程内 Map，刷新恢复及中断继续仍需实现。验收应覆盖刷新、关弹窗、取消、回调超时、跨租户拒绝、重授权不重复建连接。
6. 本轮 Meta 用例页仍显示 Marketing API 有限访问权限，各广告权限为准备测试；这不证明外部企业访问资格。须完成真实主体与所需审核，并由非应用角色的外部企业管理员只读验收，才能认定面向客户可用。

本轮结论：原配置部分恢复、账号和业务数据保留；有效回调与真实绑定闭环仍阻塞，未执行真实投放或部署。


### 授权恢复实现与本地真实 schema 验证（2026-10-24）

本节取代上一节的“代码缺口”状态，仍不代表正式 Meta 绑定或上线通过。工作树与分支不变，HEAD 仍为 `89b175109149d4551aeb3ce590fe9c42c46bf23c`，源码未提交；保留之前计划定位/人工回执修复。未更新共享集成基线。

#### 已实现的代码与边界

- `server/platformAds/authorizationLifecycle.ts`、`connections.ts`：保存实际令牌/数据访问有效期、权限及健康；七天内到期派生提示；明确过期、撤权、缺权限或损坏元数据阻断凭证使用。旧无元数据连接显示待检查并保留兼容，不假定有效。健康检查仅 GET，失败不覆盖旧证据，迟到检查不能覆盖新凭证。重连按企业/平台/账户使用持久锁更新同一连接 ID。
- `oauth.ts`、`oauthSessions.ts`：服务端按当前用户/企业/配置恢复授权，恢复不暴露 token/state/URL；取消、交换、保存共用 session 锁。取消及过期清理临时令牌，前端迟到回包不复活。保守使用 Meta 实际有效期，不对未知类型的 Business Login 令牌执行自动长效交换；重新授权是当前续期方式。
- `oauthPrivacy.ts`、`platformAdConnections.ts`：HMAC 签名撤权/删除回调、事件时间校验、重复请求幂等、跨应用/身份隔离，持久撤权屏障先于凭证清理。旧撤权事件不覆盖新授权；待核实删除请求持续阻断再授权。删除回执真实为 pending，不假称业务数据已经删除；需负责人核实处理并留证，尚无自助完成业务数据删除功能。
- `authorizationMonitor.ts`、既有 `runtime/backgroundJobs.ts`：仅 background job 角色进行本地过期会话清理；只有 `PLATFORM_ADS_AUTH_HEALTH_ENABLED=true` 才启用只读 Meta 健康扫描，每小时唤醒、每连接至少间隔一天。当前本地仍为 web，扫描关闭；没有后台真实 Meta 调用或外部通知。
- `AdMetaConnectionGuide.tsx`、`AdAccountConnections.tsx`、`AdAuthorizationHealth.tsx`：刷新恢复、换登录人隔离、明确授权状态/检查/重新授权入口。灵枢登录和历史读取独立，保留用户要求删除的大段提示区域为空，不恢复旧解释框。
- `oauthDeploymentReadiness.ts`、`scripts/check-platform-ads-readiness.ts`：统一校验现有 OAuth 契约和配置缺项；正式固定 HTTPS 候选与供应商注册、可达、外部企业资格、真实绑定分别记录，不能因环境变量齐全而声称 productionReady。
- 设计决定见 `docs/architecture/adr/2026-10-24-meta-ads-authorization-recovery.md`。本轮测试由投流 runner 自动发现 server 测试，并显式加入前端健康状态测试。

#### 两份本地增量迁移与验证

用户当次明确允许只迁移当前本地预览。先保留一致性备份 `tmp/platform-ads-chain/backup-before-auth-lifecycle`（data.db 与私有运行配置，0600），在 `auth-migration-rehearsal` 复制库验证，再短暂停止本地 8990/8991、使用仅包含本轮迁移的 `auth-migration-only` 目录运行 `pocketbase migrate up --automigrate=false`；前端 5197 保留，随后恢复同数据目录的本地服务。没有操作生产或历史来源数据库。

1. `1792800000_platform_ad_authorization_lifecycle.js` 增加隐私请求表。真实 PocketBase 检查发现其 try/catch 判断缺字段不兼容：`getByName` 返回 null，部分字段未添加。保留已应用文件字节及校验和，不改写历史。
2. 追加 `1792800001_repair_platform_ad_authorization_fields.js`：按真实 null 判断补缺，使用 Go Field 的 `type()` 校验现存字段。也修复同语义导致的既有 account context/defaultPage 漏字段，只添加缺失字段、类型不符拒绝，不覆盖现存值。先在副本验证失败检查点，再修正尚未成功应用的新修复文件并验证通过；最终副本和本地均应用成功。
3. 修正内存测试使其真实模拟 null 与 Go type()；不能再用错误模拟掩盖升级问题。真实本地 REST schema 审计最终 `ready=true`、17 个投流集合、issues=[]、mutated=false；证据 `tmp/platform-ads-chain/auth-lifecycle-live-schema.json`。
4. 两份增量已追加到 checksum manifest，全部 199 份迁移只读清单通过；未修改旧 197 份迁移。修复 down 保留被收养字段，不用破坏性回退恢复数据。
5. 原列逐行对比备份：users 1、tenants 1、connections 3、tasks 4、creatives 4、executions 4、OAuth states 0 均相同。新增隐私表 0 行；账号/业务关联和私有令牌原值保持。Chrome 已登录且原计划、历史报表与授权弹窗可见，旧授权状态真实显示待检查。

实际验证：`pnpm run test:platform-ads` 53 文件通过；最终 `pnpm run lint` 通过；`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture` 通过（2692 production TS，未增加预算）；`pnpm run check:digital-employee-migrations` 199 份通过；`pnpm run test:migration-guard` 通过；`pnpm run build` 通过（Studio 368850/485000）；修复后的 `schemaMigration.test.ts` 单独通过；`git diff --check` 通过。各日志在 `tmp/platform-ads-chain/auth-lifecycle-*.log`。未跑整仓 quality/verify，未声明真实 Meta E2E。真实 run/task 标识：无，本轮无新投放。

#### lingshu.site 正式接入准备（未执行）

用户确认该域名已运行在服务器上，可复用现有服务器。当前机器对首页和 OAuth 回调的 HTTPS 只读访问均 SSL connection timeout；这仅表明当前网络无法验证可达，不证明服务器故障，也不作为关闭 TLS 或改公网保护的理由。没有修改 DNS、服务器或 Meta 配置。

待获正式部署授权后，使用仓库 AGENTS 的现有 Ubuntu 交互 SSH → GitHub HTTPS `git pull --ff-only` → `bash deploy/update.sh` 唯一路径；先验证服务器 origin、分支、干净与差异。不得把当前未提交功能代码视作已部署版本，也不能将本地 OAuth state 发送到不共享会话库的线上后端。

正式服务器私有配置候选（App Secret 与加密 key 不写文档、不复制给用户）：`META_ADS_APP_ID=2204714410308727`、`META_ADS_LOGIN_MODE=business`、`META_ADS_LOGIN_CONFIG_ID=1667534818305334`、`META_ADS_REDIRECT_URI=https://lingshu.site/api/overseas/platform-ads/oauth/meta/callback`、`META_ADS_OAUTH_ENVIRONMENT=production`，API 版本使用原配置并单独验证支持范围。生产 env、存储与密钥必须持久、安全并与本地隔离。先修复当前密钥曾在工具输出泄露的问题，由用户在官方后台轮换后同步私有运行配置。

服务器版本、HTTPS 路由与配置就绪后，才在原 Meta 应用申请保存以下精确地址，并保留严格匹配与 HTTPS：

- 登录回调：`https://lingshu.site/api/overseas/platform-ads/oauth/meta/callback`
- 取消授权：`https://lingshu.site/api/overseas/platform-ads/oauth/meta/deauthorize`
- 删除请求：`https://lingshu.site/api/overseas/platform-ads/oauth/meta/data-deletion`

浏览器保存安全配置和附带条款须当次确认；密钥轮换由用户操作。没有提交公司验证、技术提供方或权限审核；负责人须确认真实主体、隐私/删除政策及实际处理能力。五项权限审核材料按实际功能演示：ads_read读取历史、ads_management管理用户确认的广告账户、pages_show_list选主页、pages_read_engagement核对主页、pages_manage_ads使用获授权主页身份；不得扩大不需要的权限。

完成审核与配置后，至少两家非应用角色外部企业只读验收授权、选账户/主页、保存重登、刷新继续、越权拒绝、重新授权同 ID、撤权及隐私请求状态；不创建、启用广告，不改预算或账单。当前结论：代码及本地恢复验证通过；固定线上回调接入、Meta 外部客户资格、真实绑定及删除业务处理仍未验收。

最后补充：生产 OAuth 配置现明确拒绝本机、IP 和已知临时隧道域名；oauthConfig 与 oauthDeploymentReadiness 定向回归通过。它不能代替正式域名所有权、TLS、路由和 Meta 注册的外部验证。


### 本地产品化优先、线上暂停（2026-10-24，用户追加要求）

用户明确先完成本地产品化，暂不部署。本轮没有修改线上服务器、DNS、Meta 配置或审核状态；只读核对仍看到原临时隧道回调，正式回调未登记。共享基线和 HEAD 不变，仍为当前功能分支未提交改动。

新增 `oauthCustomerJourney.test.ts`：真实本地 HTTP、严格禁止意外外部网络、隔离临时持久库，模拟 Graph 回应；从新客户授权开始，经 callback、服务子进程重启后恢复 ready 会话、选账户/主页、连接、fresh 应用登录身份、同 ID 重授权、再次子进程重启读回、跨用户/企业拒绝、expiry/revoke 门禁，核对历史逐行不变。供应商模拟仅两次令牌交换，没有广告/素材上传/预算/启用请求；不是 Meta 真实 E2E。补齐临时授权检查故障保留证据并返回503、已失效业务状态返回409的区分。

前端本轮收口：配置缺失用一行可访问状态说明原因和下一步；重授权锁定原广告账户，未返回原账户则禁止继续；检查失败明确保留上次检查时间及结果；所有旧账号的迟到成功响应（OAuth、手动连接、验证、计划、健康、同步、资源、导入）不得写回新账号 UI。新增 `AdAccountConnections.recovery.test.tsx` 并注册投流 runner，原 guide 测试增加原账户筛选。

实际浏览 Chrome 时发现现有本地 `trend_videos` 缺 `updated` 字段，灵感列表队列查询按该字段排序返回400；Express 4 的未捕获 async 拒绝退出共享后端，导致投流断线。仅在 `videoListingRoutes.ts` 为两个 GET 加显式错误边界，返回可重试503 / VIDEO_LIST_UNAVAILABLE、Retry-After、no-store，不伪造空列表或改 schema/数据。新 `videoListingFailure.test.ts` 验证同进程依赖故障后健康仍200，恢复后原记录返回；原列表鉴权回归也通过。当前本地实际顺序请求 `/videos?contentFormat=video` 为503，再请求 `/platform-ads/connections` 为200且3连接，后端未退出。灵感领域缺字段仍是已知限制，本轮不把它算作该领域完全可用。

定向新客户旅程、两个前端恢复文件、两个视频路由测试均通过；TypeScript、架构（仍2692 production TS）、构建通过，Studio 368850/485000。投流全量最终结果见 `tmp/platform-ads-chain/local-productization-tests.log`；本轮真实账号/连接/计划/素材/回执原列再次与安全备份一致（1/3/4/4/4）。新 Chrome 本地投流标签独立于用户正在浏览的灵感页，原登录保留，截图 `tmp/platform-ads-chain/local-productization-chrome.png`。

交付仍分开判断：本地产品逻辑/异常恢复验证、外部 Meta 真实授权、正式站点上线。当前预览因有效回调缺失继续明确显示不可开始真实授权；不能把模拟供应商测试写成新用户已真实绑定。正式部署及生产迁移目前没有授权，不执行。


### HTTPS 开发回调接入继续（2026-10-24，登录待恢复）

用户经侧会话明确转告主会话：允许在 Chrome 继续腾讯云开发回调接入及本地真实 Meta 绑定验收；不授权业务部署/生产迁移/投放或收费资源。安全敏感配置保存需当次确认；开发子域名尚未创建。

Chrome 实际检查：腾讯云 OrcaTerm 显示登录失败、0 会话；新控制台页跳回官方登录页。已请求用户正常登录，没有抓取浏览器凭据、变更权限、创建 DNS/证书/隧道或修改服务器。

原精确路径回调网关新增仅可配置的本机上游端口，默认8890保留，当前以 `--upstream-port=8990` 启动在127.0.0.1:8892，仍未加启用转发标志。既有隔离测试及当前端口测试通过；真实本机探测根路径、数据库/API登录路径均404，回调503（转发未启用）。没有有效state/code进入业务后端，没有 Meta 调用。下一步需腾讯云登录后只读核对实际实例、域名控制权和现有HTTPS入口，再准备可审阅的窄范围通道配置并确认保存。


### 开发 DNS 已保存，网关仅暂存校验（2026-10-24）

用户完成腾讯云登录，并当次明确授权保存开发 DNS：`ads-auth-dev.lingshu.site` A → `43.163.109.159`，TTL600。Chrome 已显示添加成功及正常记录；未改其他记录。只读发现根域名所指实例已过期待回收，运行中的现有 preview 实例为上述 IP，不续费或修改业务部署。

已通过 Chrome OrcaTerm 在运行实例的 `/tmp/lingshu-ads-dev-proposal` 暂存公开配置并使用现有 Caddy v2.11.4 执行 validate，结果0 / Valid configuration；未应用 Caddy、SSHD、systemd、用户或隧道配置。服务器主机公钥指纹通过当前已登录终端与本机 keyscan 一致核验；没有登录私钥传出本机。

待批准配置见 `scripts/platform-ads-dev-callback/`：独立开发域名的唯一 GET OAuth 回调；Caddy 查询凭证日志脱敏；私网桥接172.18.0.1:18893；只允许127.0.0.1:18892反向转发且无 Shell 的独立SSH用户及8小时临时公钥。拟使用现有 Caddy 免费自动证书、原位保留现有 Caddyfile 路由并平滑重载，不重建业务容器。启用前仍须当次确认。

实际回归：`python3 -B scripts/platform-ads-dev-callback/bridge_test.py`、`node --test scripts/platform-ads-oauth-relay.test.mjs`、`git diff --check`通过；均为模拟上游/配置校验，尚无真实 Meta 授权。DNS 成功不表示 HTTPS、隧道或绑定完成。本地转发仍关闭，未部署业务、迁移生产或真实投放。


### 开发网关已获授权并启用（2026-10-24）

用户当次允许启用准确范围的开发回调网关、免费 HTTPS、私网桥接及8小时受限隧道。服务器备份 `/var/backups/lingshu-ads-dev-20261024T070912Z` 保存原 Caddyfile、应用/worker/PB/Caddy 容器 ID 和启动时间；应用后逐字相同。新建独立 `ads-dev-tunnel` 用户、受限 Match 配置、独立桥接 systemd 服务并平滑重载 Caddy/SSH；没有业务部署或数据库写入。

首个失败检查点：SSH 公钥选项包含不接受的端口0，单用户临时 DEBUG3 日志明确 `bad key options: invalid permission port`。只修正为合法端口1，并恢复日志级别；SSHD `PermitOpen none` 仍禁止全部本地转发，`AllowTcpForwarding remote` / `PermitListen 127.0.0.1:18892` / `MaxSessions 0` / nologin 保留。修正后同一密钥成功保持隧道；没有关闭腾讯云安全防护。临时密钥到期时间为2026-10-24 22:38:32（北京时间）；私钥仅本地0600。

本机精确路径 relay 已显式启用，上游8990；私有 `.env.local` 已备份并增加开发HTTPS回调，只重启本地后端，数据库和前端不动。公开 HTTPS 正常校验证书，根路径、数据库及登录API均404，缺参数回调400；虚构 code/不存在state通过完整通道到达本地并409/AUTH_REQUIRED，没有触发真实Meta请求。公开响应不回显凭证；检查现有 Caddy 容器日志未出现虚构探测code。证据 `tmp/platform-ads-chain/dev-callback-proposal/transport-check.json`，服务active。

原 Meta 应用设置页仅填入精确开发回调，旧回调、严格模式和HTTPS保留；尚未点击保存，等待该安全敏感动作的单独当次确认。真实 Meta 绑定与外部客户资格仍未验收。

### Chrome 真实 Meta 绑定验收（2026-10-24）

已获当次许可后点击原应用“保存更改”，Meta 显示“更改已保存”：精确开发回调新增成功，旧回调和强制HTTPS/严格模式均保留。开发与生产回调长期分离，生产候选 `https://lingshu.site/api/overseas/platform-ads/oauth/meta/callback` 本轮不登记、不启用；不在授权进行中切换配置，不将本地会话交给生产存储。

真实 Chrome 流程：沿用 Lucy Chang 先前权限设置，Meta 返回两个广告账户；选择原 `1368550458638225` 与主页 `1323567870837055`，确认保存成功。连接沿用 `vhc0wqyvrizbke4`，总数3。取消临时会话不删除原连接，再发起第二次真实授权、在流程中刷新 Chrome、从服务端恢复 ready 会话，再选同一账户/主页保存，仍同一连接ID且授权healthy。最近会话证据：`gfrq86bakbvze4d` cancelled、`4i6g50ofacqaam3` ready；不记录code/state/token。原账号重新调用登录接口取得新应用登录令牌后能读回同一连接与主页；没有退出或覆盖 Chrome 的现有账号。实际到期信息为数据访问期限2027-01-22，不能宣称永久令牌。

数据保留：与迁移前一致备份逐列比较，原用户1、计划4、素材4、执行回执4全部原列一致；连接ID/广告账户关系全部一致，目标连接只按授权更新加密凭证、授权元数据及主页。证据 `dev-callback-proposal/final-data-preservation.json`、`fresh-login-verification.json`、`real-meta-reauthorized.png`。没有素材上传、创建/启用广告、预算/账单写入或业务部署。

公开证书通过默认SSL信任链和域名校验，实际颁发方 Let's Encrypt YE1，SAN为开发域名，见 `https-certificate.json`。服务器已登记 `lingshu-ads-dev-expiry.timer`，2026-10-24 22:38:32（北京时间）停止独立桥接并终止该专用用户进程，避免仅公钥到期却留下已连接隧道；不影响业务服务。此后已有绑定仍在，但新开发授权须重新获得受限通道时段授权。

实际验证：`python3 -B scripts/platform-ads-dev-callback/bridge_test.py`、`node --test scripts/platform-ads-oauth-relay.test.mjs`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`、`git diff --check`通过。这里只确认指定现有应用角色/账号的本地真实授权，不是普通外部客户审核通过，不是整个投流真实E2E或发布就绪。源码 HEAD 保持 `89b175109149d4551aeb3ce590fe9c42c46bf23c`，当前改动未提交。

已知体验缺口：两次授权回调在到达本地并成功换取账户后，Chrome 弹窗均显示 `ERR_BLOCKED_BY_CLIENT`，本地依靠服务端轮询继续成功，未绕过浏览器防护。浏览器工具拒绝访问 `chrome://extensions/`；已请用户在 Chrome 手动确认拦截来源，没有通过其他接口绕过工具限制。该问题须继续定位，不能据主流程成功写成整个浏览器体验无缺口。普通非应用角色外部企业权限资格及生产部署仍未验收。

安全恢复点：本机私有环境备份 `tmp/platform-ads-chain/dev-callback-proposal/env-before-https`；云端 `/var/backups/lingshu-ads-dev-20261024T070912Z`。如需收回本轮入口，先停止独立桥接/专用隧道；回滚现有 Caddyfile 必须先核对之后无他人改动，按原inode写回备份并验证/平滑重载，只操作本轮独立配置。不得盲目恢复数据库、删除连接或重建业务容器。DNS、Meta旧回调、生产站点保持原状。

### 旧回调重访提示修复（2026-10-24 15:38，北京时间）

用户截图中的英文由开发 bridge 返回。将 Chrome 可见回调的state按原配置context指纹匹配（不持久化明文state/code），确认对应 `4i6g50ofacqaam3`，其有效期截至15:29:01；此前真实连接与重授权已成功，重访时会话expired，原连接 `vhc0wqyvrizbke4` 仍connected。当前三个层级（本地后端、relay、公开HTTPS）的虚构未知state探测均409，通道不是不可达。此前把 Chrome `ERR_BLOCKED_BY_CLIENT` 当作主要待排原因并要求用户查扩展，证据不充分；本轮优先修复已证实的旧回调重访和网关反馈问题，没有修改浏览器防护。

改动范围：`scripts/platform-ads-dev-callback/bridge.py`、`bridge_test.py`、新增 `result_page.py`、`Caddyfile.fragment`。同一个精确GET回调路径处理完后303到只含静态result的地址，清除code/state；刷新静态结果不调用上游、不再交换授权码。成功仅提示“回调已处理、返回继续或检查连接”，不冒充账户绑定成功；过期保持409、通道不可达保持503，取消、无效、限流和故障分别反馈。结果页面沿用产品规范的Result终态语义、白底/中性色、渐变主操作，独立传输页不加载业务应用/远程依赖/脚本，仅准许固定CSS内容哈希；返回地址固定本地5197，禁止任意next/returnUrl。

只更新已批准开发网关：原文件哈希并发检查、Caddy候选validate通过后原inode写入、平滑重载Caddy与重启独立bridge；应用/worker/PB/Caddy容器ID和启动时间均未变。安全备份 `/var/backups/lingshu-ads-dev-20261024T070912Z/result-fix-073626`。SSH、DNS、Meta白名单、22:38到期关闭时段和业务数据未改。Chrome实际刷新原旧回调后显示中文“此授权链接已使用或过期”，地址无code/state，再次刷新稳定；点击“返回本地灵枢”恢复原登录，原账户执行只读Meta授权检查仍healthy，检查时间15:37:34。

证据：`tmp/platform-ads-chain/dev-callback-proposal/result-fixed-chrome.png`、`result-fix-returned-preview.png`、`result-fix-http.json`。本轮不新增真实OAuth、不上传/创建/启用广告、不修改预算账单。当前功能分支HEAD仍89b175109149d4551aeb3ce590fe9c42c46bf23c，保留既有未提交改动。共享BASELINE文档另指向集成工作树及02f5a112等提交，本轮不据此推断当前分支已同步，不作基线推进/合并判断。

本次结果页修复实际检查：`python3 -B scripts/platform-ads-dev-callback/bridge_test.py`、`node --test scripts/platform-ads-oauth-relay.test.mjs`、`pnpm run lint`、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`、`git diff --check`均通过。结果页用模拟上游覆盖重访409、断线503、取消、静态刷新零上游请求、凭证/重定向参数隔离；公开实际GET验证同状态语义，非回调API仍404。未重新运行全量quality/verify或真实投放验收。

### 投流三页闭环修复与重启验收（2026-10-24）

工作位置 `/Users/julia1/Documents/ChatGPT/1024真实投流测试`，功能分支 `feature/platform-ads-chain-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`；全部原脏改动保留，未提交/合并/推送，未据共享BASELINE中的另一集成树推断本分支已同步。

本轮修复：

- 素材页按taskId精确查目录，换计划清除旧筛选及详情；旧计划不再被第一页20条限制隐藏。
- 执行回执独立于审批/托管记录加载；辅助接口失败或挂起仍能看回执，执行历史读取失败时禁止把未知当无历史并重新创建。
- 预检使用本地授权元数据阻断过期/撤权/缺权限/损坏信息，保留legacy兼容提示；无供应商调用或令牌解密。
- 创建前在既有result JSON保存createSnapshot；人工对账依据原快照严格核对视频、Page、链接、预算、目标、地域、版位、排期。旧回执缺证据继续待核对，不新增迁移或回填假证据。
- 计划与回执全页读取，避免第201条后历史/UNKNOWN消失；完整回执目录不再误报截断。
- adsTaskId显式导航、当前身份重新鉴权恢复及迟到响应隔离；加载失败显示错误与重试，保留已有快照，不在开发模式吞错或显示“第一份计划”。

改动领域文件：`server/platformAds/{execution,preflight,tasks,creativeLibrary}.ts`及测试，新增`executionReceiptRecoveryRoutes.test.ts`；前端`AdCreativeLibrary.tsx`、`PlatformAdsOperations.tsx`、`PlatformAdsPage.tsx`，新增`src/lib/useAdPlanNavigation.ts`与行为测试，既有`AdWorkflowRecovery.test.tsx`、页面合同测试及投流runner更新。执行快照保存在既有JSON，无本轮迁移。

实际命令均退出0：`node scripts/test-platform-ads.mjs`（57文件）、`pnpm run lint`、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`（2693 production TS及ratchet通过）、`pnpm run build`（Studio368850/485000及导入边界通过）。日志在`tmp/platform-ads-chain/three-page-audit/{tests,lint,architecture,build}.log`。构建含通用大chunk提示，不是失败；未声明整个仓库quality/verify或供应商写入验收。

已只重启本地后端加载上述源码，PID由62827变为84174；PB39127与Vite26936未变。重启前只读一致备份`three-page-audit/before-restart.db`。重启后原1用户、3连接、4计划、4素材、4执行回执逐列一致，见`after-restart-data.json`；原账号fresh登录和四计划的素材/回执/定向目录均200，见`restarted-api.json`。

运行接口验证：四绑定源视频均200且字节17790、SHA256相同；当前企业成片creative-selection返回200且精确SHA已核对。各计划preflight仅本地读取，已有创建/UNKNOWN均阻断重复创建。旧UNKNOWN执行核对409/RECONCILIATION_REQUIRED，原因是资源不完整，原状态保留且没有重新创建。见`runtime-check.json`。未调用上传/execute/AI生成/启用/预算/账单接口，未部署任何业务或改生产。

Chrome旧连接连续超时；原生窗口读取曾受其他网页焦点变化影响。只针对localhost:5197恢复控制，未操作其他站点、禁用防护或访问受限制扩展设置。当前连接实例重新绑定后，子Agent已建立独立验收标签1401422346并读取原账号、四计划，继续实际三页流程。浏览器最终结果随后补记；本段不把接口/模拟测试当作Chrome完整验收。

#### Chrome 最终三页验收与选材显示补齐

Chrome 已恢复，验收标签1401422346保留原账号登录。实际从当前企业选择原MP4、选择原CNY广告账户、三步确认并保存唯一新草稿 `cymhxg2kqoqdr7y`（“本地闭环验收·不投放·20261024”，draft/version1）。没有创建绑定或上传。原1用户、3广告连接、4计划、4素材、4执行回执逐列不变，仅增加此草稿，见 `tmp/platform-ads-chain/three-page-audit/final-data-preservation.json`。

实际发现并修复：新草稿保存了materialSource但尚未绑定，素材页此前显示空白。现将当前身份恢复的计划选择传入素材目录，复用原源视频组件，显示“已选素材 · 尚未绑定/上传”、原名称及返回原计划入口；不生成假binding、平台videoId或表现数据。换计划清除旧源预览；9项AdWorkflowRecovery行为测试包含选择可见、换计划隔离、缺选择原空态及无上传/绑定/虚构报告请求。

Chrome最终结果：计划创编、投放数据、素材管理三个页面分别刷新后均保留 `adsTaskId=cymhxg2kqoqdr7y`；计划详情正确，投放数据默认本地计划回执并保留计划范围，无广告指标保持未投放语义。素材显示“文件可用 · 可预览”，只读源视频实际加载6秒、720×1280、readyState4且无error。旧计划 `y951p1yaw2mxipp` 的UNKNOWN回执和“核对这条回执”入口可见；浏览器没有点击执行、上传或广告管理保存。最终Chrome停留 `http://localhost:5197/?page=adsCreatives&adsTaskId=cymhxg2kqoqdr7y`。

证据：`tmp/platform-ads-chain/acceptance-ui-evidence.json`；截图 `acceptance-draft-saved.png`、`acceptance-plan-refresh.png`、`acceptance-data-refresh-final.png`、`acceptance-selected-material-refresh-fixed.png`、`acceptance-selected-source-video.png`、`acceptance-unknown-receipt-final.png`、`acceptance-local-final.png`（均位于tmp/platform-ads-chain）。

仍未跑通/本轮未执行：旧UNKNOWN部分资源缺失，不能安全核对成成功，需要原平台人工资源证据；新草稿没有上传、平台广告资源或真实投放回执，不能据此确认真实投放E2E；非应用角色新客户的Meta权限审核/真实绑定仍未验收；生产回调和部署未执行。历史现有角色真实绑定成功与本轮本地三页验收分别记录，不代表发布就绪。开发回调受限通道原定22:38:32到期，不能作为长期生产入口。安全恢复点为只读一致备份 `three-page-audit/before-restart.db`，无需恢复数据库，保留现有数据。

最终选材修复后重新执行：`node scripts/test-platform-ads.mjs` 全部57文件退出0（含9项工作流恢复行为测试）；`pnpm run lint`、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`、`pnpm run build` 均退出0，`git diff --check`通过。完整回归曾发现旧源码合同断言不兼容新增requestTaskId隔离条件，已更新断言，6项定向通过后重新跑完整57文件通过。最终日志覆盖到 `three-page-audit/{tests,lint,architecture,build}.log`。没有运行全仓quality/verify，也没有把本地模拟测试当作真实投放验收。HEAD仍89b175109149d4551aeb3ce590fe9c42c46bf23c，源码修复未提交。
