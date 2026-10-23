# 客服与图片投流模块合并前检查

检查日期：2026-10-23。结论：**客服可以进入受控集成候选准备；三模块整体尚不满足直接集成放行条件。** 客服需解决两个清单冲突；投流存在迁移完整性和实际升级缺字段问题；图片分支与基线已显著分化，不能整文件覆盖。

本次只读取现有工作树，在独立临时 Git 对象库中执行 merge-tree，并在临时目录生成验证文件投影。没有执行 git merge、更新现有分支、创建真实合并提交、合并到基线、部署或修改现用数据库。临时文件投影和临时 PocketBase 不代表正式集成版本或生产验收。

## 一 审查对象和有效范围

| 对象 | 固定提交 | 现场状态 |
| --- | --- | --- |
| 客服 `xixi智能客服隔离测试` | `18e8046b242f02cab8d429f300a872c087b263be` | 审查开始工作区干净；本地与同名远端一致 |
| 集成基线 `xixi1021程永罗沟通前大整合` | `81ad476ee9e716c177dd9928fac52023e7e37874` | 本地与同名远端一致；末次又有其他任务的纠偏路由拆分未提交，未纳入验证。已提交增量均重新验证 |
| 图片 `xixi图片生成+GPT降级分析` | `23b1bb93f18d0780b2cc668d7e3057531ab17789` | 工作区干净；本地与同名远端一致 |
| 投流 `feature/platform-ads-meta-workspace-20261022` | `1026906d5dd81c718f9f3e2e87fae6e00a5fed21` | 有其他任务未提交代码/UI；没有配置该分支 upstream，同名远端未找到。未发现以此 SHA 为 tip 的其他远端 head，不据此推断提交从未被推送 |

权威基线位置由 governance 文档和实际 Git 分支共同确认：`/Users/julia1/.codex/worktrees/xixi1021-governance-baseline`。投流位置为 `/Users/julia1/.codex/worktrees/xixi1021-full-integration`，目录名不代表它仍是基线。

审查期间基线由 `2b6a5338` 经 `a8b53951` 前进到 `81ad476e`，新增灵感素材弹窗和库存生命周期拆分。每次均重新计算三组基线冲突，并将临时验证投影更新到 81ad476e；客服最终 120 项回归及类型、架构、迁移和构建针对这个新快照执行。后续 HEAD 或工作区变化须另做增量复核，不能继承为“最新全部修改通过”。

检查期间观察到、未作为脏文件移入验证版本的范围包括：

- 基线：检查早期的素材弹窗/库存 hook 及相关清单改动随后由所属任务提交，已纳入 81ad476e。末次又出现 architecture.config.json、server/routes/digitalEmployees.ts 和新 taskInterventionApplication.ts、digitalEmployeeTaskInterventionRoutes.ts 的未提交纠偏拆分；这些新改动未纳入验证，且直接涉及客服共享任务路由。
- 投流：externalHistory/externalHistoryFiles、platformAdCreatives 和对应测试，以及 AdCreativeLibrary、AdSourceCatalog、AdSourceLifecycle、PlatformAdsPage/CSS、AdHistoryMedia 等。
- 精确观察清单及末次 HEAD 见相邻 JSON 证据。这些内容只在所属任务正式提交后才通过已提交的基线增量进入验证版本；没有直接复制脏文件，也没有清理、覆盖或暂存。

## 二 文本冲突矩阵

通过独立临时 bare 仓库执行 `git merge-tree --write-tree --name-only --messages <固定SHA> <固定SHA>`；写出的 tree 对象仅存在于临时对象库，不是合并提交，也未更新生产仓库 refs。

| 组合 | 文本冲突数 | 解释 |
| --- | --- | --- |
| 当前基线 + 客服 | 2 | package.json、scripts/pb-migration-checksums.json |
| 当前基线 + 图片 | 12 | 包括付费视觉审查、图层渲染、旧大路由、架构预算及灵感页 |
| 当前基线 + 投流 | 0 | 自动文本合成干净，但迁移检查阻塞，不能据此放行 |
| 客服 + 图片 | 1 | architecture.config.json；共同祖先较旧，历史预算差异也会冲突 |
| 客服 + 投流 | 0 | 共享 package 自动文本合成；仍需保留各自测试脚本 |
| 图片 + 投流 | 0 | 不能推导为“基线加三个分支无冲突” |

客服相对基线共同祖先 43892e74 有 59 个变化文件，其中 1 个契约测试修正与当前基线完全相同，实际不同为 58 个。图片分支相对共同祖先 8d4c6d46 有 23 个变化文件，其中 8 个与当前基线完全相同。投流相对共同祖先 be8a7d1f 有 78 个变化文件。三个功能分支并非从同一个时间点分出；只比较当前文件名交集会漏掉历史差异。

### 客服两个冲突的处理原则

- `package.json`：保留当前基线全部脚本，追加客服的 test:customer-pipeline；不能用客服旧 package 整体替换，丢失基线后续回归。三个来源的 dependencies/devDependencies 与基线相同，没有发现新增依赖版本或锁文件冲突。
- `scripts/pb-migration-checksums.json`：保留当前基线 193 个已登记项和原哈希，追加 `1792670400_create_customer_reply_requests.js`。与客服清单共有的历史条目哈希一致；不得改写旧条目来消除冲突。
- `customerMessagingIntegration.contract.test.ts` 两侧均已改为读取 historyInbound.ts，内容相同，不需要重复回退或重写。

以上两项策略仅应用在临时文件投影作验证，未修改真实分支。

### 图片十二个冲突文件

```text
architecture.config.json
server/agents/openaiImageEvidence.test.ts
server/agents/openaiImageEvidence.ts
server/agents/qwenContracts.ts
server/routes/videos.ts
server/socialImage/fixedOverlayComposer.test.ts
server/socialImage/fixedOverlayComposer.ts
server/socialImage/layerRenderer.test.ts
server/socialImage/layerRenderer.ts
server/socialImage/socialImageTask.test.ts
server/socialImage/socialImageTask.ts
src/components/InspirationDashboard.tsx
```

基线已经具备 referenceLayerBlueprints 合同、部分图层/遮罩能力和工作台接线；8 个相同文件含 socialImageCreation/socialImageLayerGraph、socialImageFirstDraft、luxuryProductHero 和三个图片工作台组件。应先逐 hunk 去重，确定是否仍有缺失业务能力，再决定如何集成剩余补丁；不能把“分支还有独有提交”解释为所有功能都未进入基线。

## 三 必须先处理的问题

### P1 投流修改了已锁定旧迁移

`pb_migrations/1790035200_create_platform_ad_schema.js` 在投流增加了广告层级资源集合和连接上下文字段。基线清单锁定哈希为 `a001716f642e20ffe5caf66bf50db2df212319f431ed9c6a8f396c8dc1abc6da`，投流文件实际为 `d579f2efc21ebc095bcf885fe885689969791b1bae42f2f42234dee54763d64b`。

实际运行迁移只读检查得到 checksum_mismatch。即使把清单改成新哈希，也会违背既有迁移不可改写约束，且已运行旧迁移的环境不会因此补齐表。

集成前应保留基线旧文件及原清单，把实际表结构差异放到已审核的前向迁移中。不得增加通用校验豁免，也不触碰目标数据库。

### P1 两个投流新增迁移未登记

- `1792627200_platform_ad_account_context.js`
- `1792627201_platform_ad_resources.js`

基线加投流的临时投影实际得到两个 unregistered_migration。须先审定字节内容及升级行为，再登记校验和；仅登记清单还不能解决下面的实际升级缺字段。

### P1 投流账户上下文升级后七字段仍缺失

在全新一次性 PocketBase 0.39.5 中执行：

1. 以当前基线未改写的 `1790035200` 建立旧广告表。
2. 加入投流的 `1792627200`、`1792627201`，日志显示两项均 Applied。
3. 独立探针读取 platform_ad_connections，发现以下七个字段全部缺失：businessName、accountStatus、timezoneId、timezoneName、timezoneOffsetHoursUtc、resourceSyncRunId、resourceSyncedAt。

原因：1792627200 使用 try/getByName/catch 判断字段是否存在；本版 PocketBase 的 getByName 在字段不存在时返回空值，未进入 catch，所以没有执行添加。广告 schemaReadiness 明确要求这些字段，升级环境可能持续不 Ready 或无法持久新上下文。

原始证据见 [迁移演练日志](./evidence/customer-premerge-ad-schema-20261023.log)。探针输出 failed to apply，但本次 PocketBase CLI 进程仍返回 0，因此验收还必须核对实际 schema 和日志，不能只看退出码或 Applied 文案。

应由投流分支提交前向修复，显式检查字段空值，并重新演练旧库升级、完整新装及重复执行后的字段/索引。若两个旧时间戳迁移已在某些环境运行，必须明确其历史，再选择追加修复，不以重写文件假定已升级。

### P1 图片旧 GPT 路径不能覆盖基线付费与恢复契约

图片分支的 openaiImageEvidence 通过 API Key 直接 fetch，videos.ts 会在质量不足或 Qwen 失败时自动调用 GPT。当前基线的同名 OpenAI 审查适配已要求 paidCall，包含账号/模型绑定、预算、一次提交许可、供应商结果持久回执和响应大小限制；相关批准集合也已增加。

解决 add/add 冲突时若保留图片分支整个旧文件，可能回退这些契约。基线现行默认图片分析模块仍有自身 Qwen/Gemini 路径；存在 OpenAI paidCall 原语和批准集合，不代表自动 GPT 降级生产入口已经全部接通。剩余 GPT 降级若要接入，必须通过当前明确批准的上下文，不恢复旧直接调用旁路。

同时保留基线现有遮罩遮挡保护、输入归一化及产品主体保护；不能用旧 layerRenderer/fixedOverlayComposer/socialImageTask 覆盖基线后来增加的规则。

### P2 不能恢复图片分支旧架构预算或旧页面大文件

基线仅 5 个冻结超限文件；图片分支仍保留 8 项旧预算。当前 videos.ts、Studio、数字员工页/助手页及 InspirationDashboard 均已多轮拆分。须保留基线预算和模块边界，不恢复旧 10k 行 videos 路由、旧灵感页，或放宽预算掩盖冲突。

检查期间灵感素材库存改动已由所属任务提交到 81ad476e；它与图片冲突文件 InspirationDashboard 直接相关。任何随后未提交改动仍须定稿并重新核对，不能对变化中的最终页面给出集成放行结论。

## 四 共享接口与数据边界

| 共享点 | 兼容性判断与集成要求 | 仍需验证 |
| --- | --- | --- |
| 服务启动与鉴权 | 客服新增 CB 路由、旧分群 criteria guard、WeCom 父挂载；保持 loadEnvironment 先于依赖初始化、requireAuth/支持会话只读顺序。与已提交投流/图片没有同一启动文件的新增业务补丁冲突 | 在候选主服务做真实注册 HTTP 测试，核对 401/403、角色、租户和只读令牌，不仅调用独立 router |
| 数字员工跟进只读 API | 基线把批次详情、worker 状态、preflight 移到 digitalEmployeeFollowupReadRoutes.ts；公开 URL/字段保持。该 router 仍导入现有 customerWorkflow 导出，客服无需回填旧大路由 | 批次 building、blocked、partial_sent、新审批版本和详情/预检返回结构；当前临时共享回归已覆盖部分 |
| 客服工作台可见入口 | ConversionPage 在有 deliveryHandoff.runId 时挂载 CustomerWorkflowPanel；客服批量面板在 customer_segmentation 场景出现。不是数字员工首页那个未挂载的 BatchFollowupTruthPanel | 真实首页深链→客户工作区→批量预览/审批；上一轮 fixture 浏览器测试不能证明当前基线全部导航链 |
| Meta 凭据与账号 | 客服依赖社媒账号/平台应用、pages_messaging 等消息权限及稳定 authority；投流使用 platform_ad_connections、广告账户和独立 tokenCipher。共用加密/存储设施不代表授权可互换 | 广告授权成功不能证明可发私信；消息账号刷新/权限撤销不得破坏广告连接，反之亦然 |
| Messenger authority 哈希 | 客服改为稳定业务身份，保留实时证明过期验证；历史用旧哈希冻结的选择/审批可能不再匹配 | 明确重新核验或重建旧审批范围；不能批量改写历史回执以“兼容” |
| 企业事实、知识和产品 | 客服草稿使用事实版本及冻结上下文；图片使用已确认产品、素材/图层来源；投流素材关联靠实际文件与回执身份 | 企业事实变化后旧草稿、图片、投流执行的各自冻结范围不能混用；共用 productId 不代表自动建立 CRM 归因 |
| 图片产物→投流来源 | 投流 externalHistory 对图片项目仍明确标示尚无输出图像指纹与 Meta 图片创意回执的可核验关联；图层合同相同不代表图片投放指标链已完成 | 原图项目→最终字节 SHA→素材/上传回执→广告创意/投放版本→指标的完整关联；不能借用同名视频或相似 URL |
| 投流线索→客服新客 | Meta lead/新消息会话是平台归因指标；客服 new_inquiry 是真实买家消息+关系确认；recorded_paid 是订单台账 | 仍缺可宣称已打通的跨模块有效询盘/成交归因闭环；不得将 Meta 数量直接写成 CRM 客户或支付事实 |
| 超时、结果未知与恢复 | 客服 requestId 和发送账本、图片 paid permit/receipt、广告执行回执是不同账本，不能共用一个“重试”按钮语义 | 不重复模型/发送/广告创建；跨模块 unknown 应保留原 ID/证据，只做对应账本恢复 |
| 本地预览和历史数据 | 投流带专门预览端口及只读历史来源白名单；客服有历史/模拟客户隔离，不能扩大对真实客户的写权限 | 避免默认启动脚本互抢端口；历史文件只读、来源企业和 SHA 不漂移；不复制各工作树 .env、令牌或数据目录 |

源码重点：客服 shared/contracts/customerReply.ts、customerSegmentation.ts；基线 server/routes/digitalEmployeeFollowupReadRoutes.ts、server/agents/openaiImageEvidence.ts、imageEvidencePaidContext.ts；投流 server/platformAds/schemaReadiness.ts、externalHistory.ts、shared/metaPerformance.ts。

## 五 迁移整合方案

| 来源 | 基线以外内容 | 处理 |
| --- | --- | --- |
| 客服 | 1792670400 创建 customer_reply_requests/customer_classifications | 原字节及 SHA 保留，追加清单；当前基线+客服投影 194 项只读检查通过 |
| 图片 | 无独有新增迁移；基线已有 1792686176/1792686177 的 LinkedIn/图片审查批准集合 | 不用图片旧清单抹掉这两个基线迁移，也不把集合存在当作真实付费入口 Ready |
| 投流 | 两个 1792627200/1 新迁移；并改写旧 1790035200 | 先修复旧迁移改写及缺字段，再登记新增清单，必要时另加前向修复 |

三个来源文件名并集为 196 个迁移文件，没有发现新增文件名碰撞；但一个旧文件内容冲突、两项未登记、实际升级七字段缺失，不能称为“迁移无冲突”。新增前向修复后文件总数还会增加。

集成次序不等于数据库迁移执行次序。客服/投流新文件时间戳早于基线最新批准集合；部署前应按目标真实迁移历史与 schema 检查未执行项，不以最大文件名猜已完成。当前只做一次性广告旧表→两项前向迁移演练；未进行目标库升级、完整 196 项新装或全库回滚验收。

不要把删除广告资源集合的 down 脚本当作有业务数据环境的恢复方案；真实数据保留、索引、已有命令执行历史以及备份恢复需要独立审核和演练。

## 六 建议集成顺序

1. **来源定稿并固定 SHA。** 由各工作区负责人处理当前未提交内容并给出可审查提交；不在脏基线现场合并。记录新的本地/远端 SHA，重新做本报告的增量差异。投流需明确可移交的分支/远端来源。本次不替其他任务提交或推送。
2. **先确认基线已吸收的图片能力。** 将 8 个完全相同文件和其余安全增强逐 hunk 对照，列出真正缺失功能。保留基线付费契约、结构拆分和预算；不为“先合图片”回退当前实现。
3. **先接客服低冲突候选。** 后续取得合并授权时，在新的隔离集成候选处理 package 与迁移清单追加，保持客服两个提交历史/安全回退点；先完成本节验证再纳入基线。本轮仅临时文件投影验证通过，不已合入。
4. **投流修复后再接。** 在投流正常开发分支完成迁移修复、清单登记、七字段升级验证及来源冻结，再基于客服候选增量集成。保留基线/客服测试脚本，重点验共用素材来源、Graph 账号隔离和迁移前向性。
5. **图片残余功能单独移植并复核。** 对仍有实际缺失的部分，按当前提取后的模块接口适配，先补 paidCall/审批/回执与遮罩保护测试，再进入候选。剩余图片付费旁路或 12 个冲突未解决，三模块整体不得放行。若去重确认无新需求，可保留图片来源分支而不强行做冗余合并。
6. **最后验证三模块最终同一候选。** 本次只有两两文本分析及两个独立文件投影测试，没有三分支最终合成版本的完整验收。验证通过后才另行请求/执行已授权的基线集成；部署和真实外部联调各自需要独立任务授权。

客服、图片、投流在业务上没有“必须先发广告才能生成客服草稿”的依赖；上述顺序按冲突成本和可隔离验证安排，不是生产执行顺序。

## 七 实际检查与剩余验证

### 本轮已执行

- 固定 SHA 的六组 merge-tree 分析；基线两次前进后均重新核对主要三组冲突。
- 临时“当前基线+客服”文件投影：120 项隔离回归全部通过（客服主回归 80 项+新基线纠偏/审批/原生派发共享边界 40 项，去重按实际 runner 计数）；TypeScript、架构/ratchet、194 项迁移只读检查、生产构建和 chunk 门禁均通过。架构扫描 2,436 个生产 TypeScript 文件，保留 5 项旧预算；Studio 主 chunk 480,957/485,000 字节。
- 临时“当前基线+投流”文件投影：投流测试脚本通过 41 个测试文件；TypeScript 与架构检查通过。但迁移只读检查仍有 3 个阻塞，不能因源码测试通过而放行。
- 一次性 PocketBase 0.39.5 的广告旧 schema→两项投流新迁移演练；实测七字段缺失。没有查询/写入现用数据库、调用真实模型或发送/创建真实广告。
- 测试预加载禁网 guard，只允许当前测试进程开启的本地 HTTP 服务。图片冲突没有自动替选或解决，也没有对未解决的图片候选编造构建/测试通过记录。

### 正式集成前必须完成

- [ ] 基线新出现的任务纠偏拆分、投流未提交修改定稿，全部来源重新固定 SHA；复核客服共享审批/重试/发送门禁及路由挂载，再验证报告之后的增量。
- [ ] 客服两个清单冲突按追加原则解决；新主服务路径、鉴权/角色/只读支持会话做真实 HTTP 注册测试。
- [ ] 投流旧迁移还原为锁定字节；两个未登记项登记；前向修复七字段，覆盖重复运行、既有记录、索引及空值场景。
- [ ] 在最终候选执行全量迁移完整性检查；临时新装及基于目标精确 schema 备份的升级/数据保留演练。
- [ ] 图片冲突逐项裁决，现有付费批准/预算/供应商身份/回执恢复不退化，遮罩和主体保护测试保留。
- [ ] 最终同一候选重跑客服、数字员工、图片管线、视觉证据付费模块、投流、租户隔离及共享来源测试；再做 TypeScript、架构 ratchet 和生产构建/chunk 检查。
- [ ] 浏览器从真实首页导航，分别进入图片生成、投流、客服工作区；确认批量筛选/审批入口可见、上下文不串租户、标签及来源状态正确。
- [ ] 仅在另行授权后做真实单客闭环：消息入站→草稿→审批→到期派发→签名回执；明确 WA 入站自动接待仍未启用。
- [ ] 另行授权后的真实图片生成/审查以及最小广告验证；平台受理、实际送达、付费结果与未知恢复分别验收，不把模拟回执称为真实完成。
- [ ] 图片产物到广告创意的字节级关联，以及 Meta 归因指标与 CRM 有效新客/订单的边界仍需单独验收；没有证据时保持 unknown。

## 八 证据和安全恢复点

- [机器可读检查记录](./evidence/customer-premerge-review-20261023.json)：固定 SHA、原始冲突输出、迁移阻塞、临时升级探针、验证摘要及日志 SHA-256。
- [广告临时升级演练日志](./evidence/customer-premerge-ad-schema-20261023.log)。
- [数字员工客服执行说明](../runbook/CUSTOMER-PIPELINE-AGENT-EXECUTION.md)。

客服源码安全恢复点仍是已推送的 18e8046b，修复代码提交为 0c994b3c。本次仅新增本报告和证据，不更新 governance 基线、不提交/推送、不合并、不部署；其他任务的脏文件保留原位。恢复本次检查不需要对任何真实分支或业务数据库回滚。
