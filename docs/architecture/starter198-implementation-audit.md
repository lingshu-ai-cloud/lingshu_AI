# starter_198 产品实现审计

> 审计日期：2026-09-13（Asia/Shanghai）
> 代码基线：当前工作区，包含尚未提交的 starter_198 产品优化
> 审计方式：代码、迁移、默认装配和自动化测试的静态校准；发布证据／结果摘要合并后的稳定工作树已由根任务统一复跑质量门禁并记录
> 商业边界：购买入口、支付、套餐选择、续费、退款和发票明确不在本期范围，因此不列为缺陷

状态口径：

- **已实现**：当前代码链路已经存在，并有针对该行为的自动化测试；仍不自动等于生产验收通过。
- **部分实现**：局部链路可以运行，但存在明确断点或只能处理受限输入。
- **目标态**：产品／架构文档要求的最终效果，尚需实现和验收。
- **未验证**：不能从单测、构建或代码结构推导，必须在生产同等环境做迁移、故障、恢复或容量验证。

## 1. 结论

**当前实现已经形成 198 标准版的安全产品壳和若干可运行纵切，但仍不满足完整对客 GA，也不能宣称支持 1,000+ 用户同时使用。**

相比上一版审计，以下能力不再是“完全缺失”：

1. starter 用户有独立的灵小枢工作台，“今天／待决策／成果”和四 Agent token／成本卡已经落地；所有 Agent 写操作收口到 `/api/overseas/starter-198/commands`。
2. 灵感大屏、内容制作、投流／发布、销售／客户四个入口仍存在，并以差异化、租户级、只读投影展示真实业务摘要；不是删除这些生产现场。
3. 默认 starter router 已装配持久 run/task 队列、初始设置、审批、报价规则／询盘、报价审批／人工证据等应用端口。
4. 专用 orchestrator worker 已注册固定 10 节点图，10 个节点均有显式处理或受控投影路径：上下文／调研确定性执行，内容与报价观察精确血缘的真实领域产物，审批／发布包由专用桥接与 worker 推进，发布证据只接受受信任验证结果，结果摘要重新核验 canonical 事实并在全部通过时结束当前 run。缺产物、审批或回执时会明确等待，不模拟 provider 成功。
5. 灵小图已有 `tenant + run + task` 索引化内容血缘、文件／质检哈希适配和幂等唤醒；灵小量有批准版本／哈希门禁、工作流绑定的发布包 worker、证据验证／投影原语和下载接口；灵小售有精确询盘／草稿血缘、确定性计价、自助规则／结构化询盘、报价草稿、审批、不可变下载产物和人工发送证据。
6. usage ledger 已有 reserve／settle／release、input/output/cache token、人民币成本、预算和异常语义；终态真实成本不会因为超预留或跨周期被丢弃。
7. processing 命令可从租户内持久事实恢复：orchestrator inbox、初始设置、发布包／发布证据以及报价命令均不会仅凭“目标状态看起来相同”猜测成功；暂停、恢复、取消、内容审批和报价审批使用精确 command/idempotency/request/actor 证据归因。
8. starter 开通前会扫描 legacy 凭据、账号、待发布任务和待发送跟进；Product API、legacy 定时发布与跟进发送在最终权限读取至外部动作之间与开通共用数据库仲裁的有界 transition lease。Product API Key 新凭据只持久化 tenant-bound HMAC 摘要，旧明文记录被清空并要求轮换。
9. 三个 starter worker 均要求开关值精确为 `true`，生产环境缺 PocketBase 依赖时 fail closed，并使用禁止本地 JSON fallback 的严格存储；发布包与报价产物修复扫描具有有界、公平、可续传且校验严格的 cursor，orchestrator 过期 lease 可在 grace 后换代并使用 fencing token。
10. 70 个现有 PocketBase migration 已纳入 checksum manifest 与历史基线不可变门禁；发布证据／结果摘要合并后的稳定工作树已通过 `pnpm run quality` 和全量 `pnpm test`。
11. Starter workspace 与四类生产现场不再转发原始记录：任务文案由固定 task schema 投影，usage 只暴露公开异常码，趋势／内容／销售记录采用字段白名单、公开 ID 和联系方式清理；`production_site.read` 会在服务端同时阻断现场记录读取与产物下载。
12. starter 探测豁免只接受 `/auth/me` 由服务端管理员校验产生的 `platformAdmin: true`；订阅套餐名、邮箱或 browser-read token 都不能伪造该权限。browser-read 会话仍可访问获准的普通只读路由，但不能借此绕过 starter legacy boundary。
13. `pnpm run audit:production` 当前报告 0 项生产依赖漏洞；SheetJS 固定为官方发布的 vendored `xlsx@0.20.3`，质量门禁验证来源、版本、LICENSE 和 SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`。产品导入还增加文件格式／签名和资源上限，避免压缩炸弹或超大稀疏工作簿占满浏览器资源。

仍阻断 GA 的事实是：starter 尚未主动派发真实内容生成／渲染 provider，真实平台／签名回执 verifier 的运行调用方和隔离登录态均未接入，自然语言询盘理解尚未实现；发布包仍是 JSON manifest 而非含素材的 ZIP。真实模型和工具调用没有全面接入用量账；通用数据库 CAS、跨记录事务、事务 outbox/inbox、独立持久队列、API/Worker 分离和全局限流尚未完成；完整白标与标准开通也没有闭环。完整开发依赖审计仍有 Electron 33 与其 `extract-zip` 依赖两项 high，自动修复要求升级至 Electron 44，属于跨 11 个主版本的破坏性迁移，尚未在本轮冒险升级。1,200 个已登录会话只是容量门禁目标，当前没有压测证据。

## 2. 当前能力矩阵

| 能力 | 当前状态 | 已经成立 | 仍未成立 |
| --- | --- | --- | --- |
| 购买／套餐 | **明确不做** | starter 表面不依赖购买或支付状态 | 不进入本期验收；未来商业化另立项 |
| 灵小枢唯一入口 | **已实现产品壳** | 工作台、三类卡片、次要补充输入、命令入口与 legacy 阻断 | 完整卡片覆盖率、批量决策和真实租户体验指标未验收 |
| 四 Agent 组织 | **部分实现** | 固定 role、共享合同、10 节点 DAG、run/task；所有节点有明确 handler／bridge／worker／projection，结果摘要只汇总已验证事实 | 无真实内容 provider、真实平台 verifier 调用方、自然语言询盘与非 mock 端到端验收，不能称全自动联调 |
| 生产现场 | **部分实现** | 四类差异化只读页面；读取趋势、内容项目、客户、发布包和报价摘要 | 不是原页面全部组件与全部领域细节的只读复用 |
| token／成本 | **部分实现** | 四卡展示；账本可预留、结算、释放并保留异常 | 真实模型／工具调用覆盖、provider/model/价格／汇率来源和 DB 原子预算未完成 |
| 发布包 | **部分实现** | worker 回读批准上下文并校验版本/hash；manifest 带精确工作流绑定并可下载；证据区分未提交／待验／驳回／已验，只有受信任验证结果可投影成功 | 非素材 ZIP；真实平台／签名回执 verifier 调用方未接入；无 append-only evidence、登录态 session broker |
| 智能报价 | **部分实现** | 规则确认、结构化询盘、确定性十进制计价、草稿、审批、不可变 JSON 报价产物、人工发送证据；询盘／草稿按 run/cycle/task 精确血缘唤醒 | 无模型自然语言理解／追问、复杂例外闭环、可信发送验真、CRM／订单反馈 |
| 开通与白标 | **部分实现** | starter access 与可重试 provisioning helper；开通前 legacy 凭据／账号／待执行效果兼容性扫描 fail closed | 无完整 Owner 邀请、品牌快照、域名／邮件和内部一键开通用例 |
| 依赖与产品文件导入 | **部分实现** | 生产依赖 audit 为 0；vendored `xlsx@0.20.3` 有来源／SHA-256／版本／LICENSE 门禁；CSV/XLS/XLSX 有类型、签名和资源上限 | 完整开发依赖仍有 Electron 33／`extract-zip` 两项 high；Electron 44 跨主版迁移与桌面端回归未完成 |
| 并发与可靠性 | **未验证** | 单活 run 数据库守卫、持久命令恢复／精确归因、严格 worker 存储、公平 cursor、orchestrator lease 换代；短时 run mutation、发布证据和档位切换使用数据库 durable lease | 仍是同进程轮询；跨记录提交缺通用 DB CAS／事务 outbox／独立持久队列，且无 1,200 会话故障与恢复报告 |

## 3. 已确认成立的安全与真实性边界

以下约束已在当前代码中建立，后续实现不得破坏：

1. **starter 的 Agent 写入口唯一。** 前端不提供三个子 Agent 的平级控制台；starter legacy 业务 GET/HEAD/写入口由 `server/starter198/legacyBoundary.ts` 服务端拒绝，而不是仅隐藏菜单。
2. **生产现场严格只读。** `StarterProductionSitePage` 只消费 workspace 投影；下载、回填、审批、暂停、恢复等可写动作仍由灵小枢卡片承载。
3. **workspace 缓存按 bearer 隔离。** `src/lib/starterWorkspace.ts` 对缓存与 in-flight 请求按认证会话分桶，并处理登出和旧响应晚到。
4. **默认装配不是测试空壳。** `server/starter198/router.ts` 默认注入 initial setup、orchestrator queue、approval、quote decision/evidence/self-service 和生产现场 read model。
5. **任务缺少真实事实时诚实等待。** 固定节点只接受各自允许的 canonical 事实；内容、发布、询盘、报价或验证证据缺失／不匹配时返回 `waiting_external` 或保留人工等待，不构造 provider 成功。
6. **确定性价格不由模型计算。** 报价按版本化规则、十进制金额和固定舍入产生；规则、询盘和草稿具有 tenant-bound hash／幂等键。
7. **外部效果不被伪造。** 发布包只代表待用户发布；人工发布／报价发送证据在验证前保持 unverified；报价文件只在有效审批后生成。
8. **租户过滤不可被 caller 覆盖。** starter repository 会在合并 query 后强制使用可信 `tenant_id`，并校验返回记录租户。
9. **单活 run 包括过渡状态。** `waiting_human` 与 `cancelling` 都占用 starter 单活槽，避免取消过程中创建第二个活跃 run。
10. **命令恢复以持久证据为准。** processing journal 会从 tenant-scoped inbox、初始配置、发布包／证据或报价事实恢复；缺少精确事实时保留 unknown，不盲目重放。暂停／恢复／取消、内容决策和报价决策还必须匹配 command ID、幂等键、请求 hash、目标、版本与原始 actor，不能用后来相同的对象状态冒领成功。
11. **短时 run 变更已有跨进程仲裁。** 取消、orchestrator 提交、内容／报价唤醒和发布证据投影通过同一 run-mutation 数据库 lease 协调，进程内 run lock 只降低本实例争用；写入前仍回读 starter scope／状态。task 与 run 等多记录写入不是同一事务，崩溃依赖幂等重放修复，因此仍不能替代通用 CAS、事务 outbox 和完整 effect fencing。
12. **starter 不接受 legacy 外部效果旁路。** Product API、定时发布和客户跟进会在入口扫描及真正执行前检查 starter authority；开通兼容性检查会先拒绝仍有 legacy 凭据、账号、排期发布或待发送跟进的租户，且开通与 legacy effect 的最终 authority read／effect 由数据库 transition lease 串行。该 lease 不是把 access 与 effect 合成单一数据库事务。
13. **生产 worker 不静默降级。** orchestrator、发布包和报价产物 worker 只有显式精确 `true` 才启动；生产缺少有效 PocketBase 地址或管理员凭据会拒绝启动／扫描，严格 worker store 不回退本地 JSON。
14. **修复扫描不会长期饿死后排记录。** 发布包和报价产物 worker 使用有界 opaque cursor 跨页继续，遇到未就绪／被租约占用的头部记录仍可推进；畸形或超长 cursor fail closed。orchestrator 的过期 immutable lease 只在 grace 后回收并换 fencing token，旧 owner 无法释放新 lease。
15. **客户投影遵循字段白名单。** workspace 的任务标题、原因和输出摘要只来自固定 task key／结构化 schema；usage 不返回原始 provider 错误、prompt 或操作员备注；四类生产现场只选择业务展示字段，联系方式和内联 URL 会清理，记录 ID 对外哈希，secret、prompt 与 provider payload 不进入 Starter 响应。
16. **`production_site.read` 是服务端能力，不是菜单开关。** 能力关闭时服务端不查询生产现场存储，不投影现场记录，也拒绝发布包／报价产物下载；返回对象若与认证租户不一致则 fail closed。
17. **平台管理员豁免只有服务端事实来源。** 前端只认 `/auth/me` 中经 `requireAdminUser` 计算的 `platformAdmin: true`，不再按 `subscriptionPlan=admin` 或邮箱推断。browser-read 身份在 `/auth/me` 不获得该位，不能跳过 starter profile 探测或 legacy boundary。
18. **产品文件导入有供应链和资源双门禁。** `xlsx@0.20.3` 的 vendored tarball 在安装前／quality 中校验来源、SHA-256、包名、版本和 LICENSE；导入端限制 10 MiB 文件、2,048 个 archive entries、64 MiB 总展开量、32 MiB 单项、20 张表、每表 20,000 行／256 列／750,000 个范围单元格、每工作簿 1,000,000 个范围单元格与 8 MiB 文本，并关闭公式、样式、VBA 和依赖解析。
19. **Product API Key 不可恢复存储。** 新 key 仅 create／rotate 时返回一次，存储只保留 tenant-bound HMAC、key id、前缀与末四位；生产缺至少 32 字节 pepper 会拒绝启动，校验使用常量时间比较。迁移不会把旧明文转换成可复用摘要，而是清空并标记必须轮换。

## 4. P0：正式对客阻断项

### P0-1 固定 10 节点已有安全路径，但真实外部闭环仍未接齐

**当前事实**

固定图包含上下文快照、内容调研、内容生产、质检、内容审批、发布包、发布证据、询盘、报价草稿和结果汇总 10 个任务；当前每个节点都有明确的处理或受控投影路径：

- `starter_context_snapshot` 与 `starter_content_research` 确定性读取冻结上下文和租户内真实趋势；
- `starter_content_production` 与 `starter_content_quality_gate` 只观察受信任内容链已经写入的精确 `tenant + run + task` 血缘，并校验现行内容版本、文件哈希和质检回执；它们不调用模型或渲染 provider；
- `starter_content_release_approval` 由 canonical 审批桥推进，`starter_publication_package` 由专用 worker 生成与审批／任务精确绑定的 JSON manifest；
- `starter_publication_evidence` 有未提交、待验、驳回、已验的安全投影，只有受信任 verifier 已持久化且与 package／run／approval／task 完全匹配的验证结果可成功；
- `starter_inquiry_intake` 与 `starter_quote_draft` 观察 self-service 产生的结构化询盘和确定性报价，按 run／cycle／task／版本／哈希读取并幂等唤醒；
- `starter_result_summary` 重新读取 canonical 报价、批准证据和已验证发布证据，只汇总已验证发布与报价草稿，流量、发送和成交仍明确列为缺口。

orchestrator 还可在 lease 到期并经过安全 grace 后回收旧 immutable lease、创建新 generation／fencing token，旧 owner 不能释放新 lease；run 的短时变更另由数据库 durable lease 仲裁。这些是局部恢复和并发保护，不是整条业务链已具备跨记录事务恢复。

**影响**

用户可以启动目标并看到真实任务状态，也能在已有受信任产物和审批都到位时沿 10 节点推进；但 starter 不会主动生成内容，也没有真实平台验真和自然语言询盘入口，因此默认生产组合仍不能独立完成“灵小图生成 → 灵小量发布验真 → 灵小售理解询盘 → 灵小枢结果卡”的非 mock 闭环。

**关闭标准**

1. 接入受 entitlement、事实版本和预算约束的真实内容生成／渲染 provider，不在 orchestrator 内复制旧路由逻辑。
2. 接入可信平台／签名回执 verifier 的运行调用方，并为自然语言询盘增加合规抽取与最少补项。
3. 把当前显式唤醒 hook 接入事务 outbox／持久重投；任何未知外部结果先对账，不盲重试。
4. 使用默认生产组合完成非 mock 端到端，覆盖重复投递、进程重启、取消、版本变化和中途部分写入。

### P0-2 发布包与发布证据仍未达到可验证交付

**当前事实**

- `publicationPackageWorker.ts` 与 `publicationPackageArtifact.ts` 已形成真实消费链：读取 canonical 内容、校验批准对象／版本／hash，生成并持久化带 `runId + approvalId + approvalTaskId + agentTaskId` 工作流绑定的 package。
- 发布包修复扫描已有跨页、有界、公平 cursor；未就绪或被其他 lease 占用的前排任务不会永久阻塞后排任务，非法 cursor 会 fail closed。发布包提交和其他短时 run 变更通过数据库 run-mutation lease 仲裁，并在提交 task／run 结果前回读状态；task 与 run 仍是分开写入。
- 当前下载接口返回 `application/json` 的 manifest；它不是包含原素材、平台文案、封面、说明和文件校验清单的 ZIP。
- 用户可以提交 URL／平台引用等人工证据；它只进入 `pending`。提交命令会在证据先持久化后 best-effort 调用投影；投影失败不会把已经成立的提交事实返回为失败，后续幂等命令重放会重试。代码已有要求 source receipt hash、verifier identity、可观测性与内容哈希的受信任验证写入原语，以及固定图／审批／package 精确绑定的投影；待验、驳回、错误 run、未绑定普通包、待审批和关闭 run 均不能推进成功。当前仍缺由真实平台读取器或签名回执驱动的 verifier 运行调用方；验证后通知仍需集成方显式调用内部 hook，证据字段也不是独立 append-only attempt 集合。
- 登录态辅助发布仍只是目标态：没有 session broker、用户在场控制通道、每次独占浏览器 worker 和凭据硬 TTL。

**关闭标准**

1. 生成完整可交付包，至少包含批准素材、各平台文案、发布步骤、manifest 和逐文件 SHA-256。
2. 证据提交与验证分离，使用 append-only attempt；`published` 只能由可信验证结果派生。
3. 辅助登录态保持独立 entitlement，未过安全／法务／平台验收时始终关闭，不阻塞发布包基础路径。

### P0-3 内容生成与询盘理解未自动化；结果摘要仅覆盖已验证事实

**当前事实**

灵感 read model 能读取真实趋势摘要，content read model 能读取真实项目摘要。starter 的内容生产／质检 handler 现在会按 `tenant + workflow run + workflow task` 组合索引只读核验现有真实 `studio_project`，不会按租户宽扫，也不会调用 legacy 内容 provider；没有精确产物时仍诚实等待。受信任的既有内容生产链会同步写入顶层 lineage 投影，并在真实项目达到可复核状态后调用内部唤醒 hook。该 hook 只重置带精确 run/task 身份及可恢复 wait 原因的节点，歧义、超配额、哈希或完整性异常不会被自动唤醒；共享 run lease／存储短暂失败会返回可重试 deferred 结果，不会把已经持久化的成片反写成生产失败。

这仍只是受信任生产链与 starter 观察器之间的显式、幂等桥接，不是 starter 专用灵小图已经获得内容生成／质检 provider。当前也没有事务 outbox 或持久事件重投器；自动重试依赖后续生产 tick 或内部事件调用方重新投递单项目 hook，因此部署前仍需补 durable delivery。询盘表单当前只接收来源、数量、目的地等结构化字段，不保存原始消息或联系方式；它能安全地产生确定性报价，却不是“灵小售阅读客户原话并提出最少补充问题”。

结果汇总 handler 已不再是占位等待：它是确定性、零 provider 调用的安全聚合器，会校验固定图、重新读取 canonical 报价及其不可变批准证据，并回读已验证发布 evidence；成功时也只报告一条已验证发布和一份已批准报价草稿，把平台表现、报价发送和成交标为未观察缺口，并由 orchestrator 将当前 run 置为成功。缺任一证据、哈希变化或报价未批准时继续等待；由于真实 verifier 调用方缺失，生产链目前不会自然抵达该成功终点。它尚不是完整经营复盘或下一周期自动滚动。

**关闭标准**

- 接入受 entitlement、schema、事实版本和成本预算约束的内容生成／质检工具链；
- 增加合规的自然语言询盘导入、PII／同意／TEST 隔离和必要缺项卡；
- 扩充灵小枢摘要的真实业务证据范围，并补下一周期滚动；继续禁止用空值或模型推断补齐发布、发送和成交。

### P0-4 真实调用计量与资源预算还不完整

**当前事实**

`usageLedger.ts` 已实现 reserve → terminal settle/fail 的不可重复生命周期，能记录 token、预留／结算／释放、资源单位和异常。终态实际成本即使超过预留、跨计费周期或预算投影暂时不可用，也会先落账并产生异常，避免“为了守预算而丢真实成本”。

目前多个 handler 是确定性读取、哈希校验或摘要逻辑，正确显示 0 token／0 provider 成本；这不表示真实 AI 免费。内容模型、渲染、抓取、浏览器、渠道等生产调用未全面接线。短时状态变更已有数据库 lease，但预算 reservation 仍不是数据库事务/CAS；多数声明的 resource limit 也没有完整生产计数点。

**关闭标准**

1. 每次模型和计费工具调用写唯一 usage/effect event，并记录 provider、model、价格版本、原币与汇率快照。
2. 使用数据库原子 reservation/CAS；未知成本 fail closed，重试不得重复扣费。
3. 每个对客 limit 都有计数、拒绝码、边界测试和并发测试；没有执行点的限额不进入对客清单。

### P0-5 生产现场已安全投影，但仍是摘要级只读适配

**当前事实**

四个入口已经保留，且不再是完全相同的占位卡：read model 从 `trend_videos`、`studio_projects`、`whatsapp_customers`、starter 发布包与报价集合读取租户内摘要。记录经过字段白名单、公开 ID、状态枚举和联系方式清理；workspace 的任务／用量文本也由固定 schema 生成。`production_site.read` 在查询、投影与产物下载三处由服务端执行，能力关闭时不会以“页面隐藏”代替隔离。该设计改善了安全性和可追溯性，但没有复用原页面全部展示组件，也没有完整投影灵感来源、脚本／素材／版本／质检、公开表现、询盘跟进、成交与归因。

**关闭标准**

1. 为四个现场建立稳定、分页、可观测的只读 BFF projection。
2. 在不暴露 provider payload、prompt、凭据和 PII 的前提下复用原页面的高价值展示组件。
3. 所有现场 mutation 与 side-effecting GET 对 starter 继续返回 403；所有修改回到灵小枢卡片。

### P0-6 1,000+ 同时在线尚无架构或压测证据

**当前事实**

- starter 三个 worker 默认关闭，只有开关精确为 `true` 才会启动；启用后当前仍作为 Express 运行时内的定时轮询工作，没有独立 Worker 部署。
- 生产 worker 已要求 PocketBase 地址与管理员凭据，并通过 strict store 禁止落到本地 JSON fallback；这解决了静默分裂事实源，不等于已经迁移到独立持久队列。
- PocketBase 是当前业务源；关键状态更新尚无通用 DB version CAS 和跨聚合事务。
- runtime/SSE/部分任务锁仍与单进程生命周期相关；默认部署没有 BullMQ、共享事件流或多 API 副本正确性证明。
- 全局大 JSON body、对象存储直传、租户／用户／IP 限流和 backpressure 尚未完成。
- 没有 1,200 个已认证会话、4 小时 soak、故障注入和恢复报告。

**关闭标准**

API/Worker 分离、持久队列、共享事件、数据库 CAS/outbox/inbox、限流与对象存储先落地；随后按版本化 `load_profile_198_ga_v1` 完成 1,200 会话混合负载，并报告 p95/p99、错误率、队列延迟、资源余量、恢复和成本。完成前只能说“容量目标为千人级”，不能说“已支持千人并发”。

## 5. P1：生产安全、一致性与开通阻断项

### P1-1 完整标准开通与白标未闭环

`provisionStarter198` 能幂等创建／恢复 starter access。开通前的 compatibility scan 会完整分页检查 Product API／平台／社媒／YouTube 凭据与账号，以及待定时发布、待跟进发送和结果不明的 legacy 状态；发现 blocker 返回 409，存储不可用／扫描不完整返回 503，并保证在 access 写入前停止。开通 transition 与 legacy external effect 共享同一个数据库仲裁的租户 transition lease，进程内队列只降低争用；这关闭了原有“仅靠同进程锁”的缺口，但尚未把 access 与 effect 合成一个事务。

这仍不是完整开通闭环：尚无内部一键用例同时完成 tenant、Owner membership/invite、品牌快照、域名／邮件、预算和审计；跨进程 transition 也仍需数据库原子协议。购买／支付不在范围，不影响该缺口成立。

### P1-2 状态转移缺通用数据库 CAS 与事务 outbox

单活 run 的 partial unique index 是有效的局部守卫；processing command 也能从 inbox／配置／artifact 等 tenant-scoped durable facts 恢复，run control 与决策命令有精确归因证据。取消、orchestrator 提交、内容／报价唤醒和发布证据投影会通过数据库 run-mutation lease 仲裁；发布证据自身变更和档位切换也有独立数据库 lease。进程内队列／run lock 仍存在，但在这些窄路径上只用于降低本实例争用。

但 repository update 仍是读后写；跨 run/task/approval/event/quote/package 的状态变化不是同一数据库事务，lease 过期、进程崩溃或未覆盖的 legacy 写路径仍需依赖重放与回读。局部 durable lease 不能证明全系统多实例正确性。所有关键状态仍需要 version CAS，外部副作用仍需要 transactional outbox/inbox 与唯一 effect key。

### P1-3 报价有效态与对象级授权仍需收紧

报价审批和发送证据的命令角色已收紧：operator 不能批准或登记报价证据，`customer_service` 只能提交询盘和登记人工发送证据。workspace 已停止透传任意自由文本，只投影报价金额、状态、绑定摘要和固定动作；但它仍直接读取 quote 基础记录，未统一经过 quotation application 的 effective-draft 检查，报价对象也没有 assignee／客户负责人约束。应让 projection 返回有效状态与不可执行原因，并叠加对象 assignment。

### P1-4 证据、schema 与高基数读取仍有缺口

- publication evidence 仍嵌在 package 单行 JSON，不能保留多次提交／驳回的完整审计；
- handoff 唯一约束与 task/result 绑定仍需加强；
- 发布包／报价产物的后台修复扫描已有安全 cursor，但 workspace 对 task/approval/usage 仍是固定窗口，quote/package 也只展示最近条目，尚无完整 projection cursor、rollup 和保留策略；
- 报价产物为不可变 JSON 字节并带 SHA-256，满足当前安全下载纵切，但尚不是客户最终期望的品牌化 PDF／文档交付。

### P1-5 legacy 依赖环与巨型文件仍在

starter 新文件已经通过架构预算拆分，但 enterprise/knowledge/WhatsApp、studio/contentProduction 等 route↔domain 环和 server→src 反向依赖仍存在。当前架构 guard 主要是目录／行数预算，不是完整 AST import graph；不能把 starter 纵切外推成全仓复杂度治理完成。

### P1-6 真实迁移、备份与恢复门禁未验证

当前 70 个 PocketBase migration 已全部登记 SHA-256 checksum；门禁会同时校验当前目录／manifest 一致性，并从 Git baseline blob 校验历史 migration 与 checksum manifest 不可改写，缺失 baseline blob 也 fail closed。该 checksum／fixture 门禁即使通过也不执行 PocketBase，不等于生产历史链升级、回滚或备份恢复通过。仍必须在生产同等 PocketBase 版本／真实基线或后续 PostgreSQL 迁移环境中完成空库创建、旧库升级、数据校验和隔离恢复演练。

### P1-7 支持授权与凭据治理仍未到目标态

支持访问默认关闭、短 TTL、Owner 开关和只读限制已有止血；目标仍是 target-tenant、人员、scope、reason、expiry 级 support grant。凭据保险箱、历史敏感数据清理、正式 provider webhook 的时间窗／防重放／事件幂等也必须在扩大真实客户前关闭。

### P1-8 桌面开发链仍有两项 high 依赖风险

`pnpm run audit:production` 已达到 0 项生产依赖漏洞，且产品文件导入不再依赖 registry 中的旧 SheetJS 包；官方 `xlsx@0.20.3` tarball 由本地 SHA-256／版本／LICENSE 门禁约束。完整依赖审计仍报告 Electron 33 与其 `extract-zip` 链两项 high。审计建议的修复是 Electron 44，跨越 11 个主版本，会同时改变桌面运行时、安全模型、打包和自动更新行为，因此不得用 `audit fix --force` 未经验证地落地。

关闭标准：单独建立 Electron 33 → 44 迁移批次，完成主进程／preload／renderer 权限盘点、macOS／Windows 打包签名、安装／更新／回滚及桌面端关键旅程回归；升级完成并再次得到完整依赖 audit 0 后，才能声称“全部依赖审计为 0”。在此之前，生产 Web／API 依赖 audit 0 的结论不能外推到桌面开发链。

## 6. 自动化与验证事实

当前代码已将下列 starter 专项纳入 `test:starter-198`、`test:process-role` 等质量脚本与 CI：初始设置及崩溃恢复、durable command recovery、精确命令归因、审批、固定队列、专用 worker、usage ledger、生产 read model、内容／报价精确血缘与唤醒、发布包 worker 公平扫描／工作流绑定、发布证据投影、确定性结果摘要、报价 artifact 公平扫描、报价 self-service／命令、provisioning compatibility／legacy effect guard、数据库 operation lease、router、租户／成员 quota 和前端 workspace cache。

下表记录发布证据／结果摘要合并稳定后，由根任务在当前工作树完成的最终复跑结果：

| 门禁 | 本文判定 |
| --- | --- |
| `pnpm run quality` | **通过**；包含架构及 ratchet、70 项 migration checksum／guard、共享契约、进程角色、安全边界、前端安全、starter 专项、`tsc --noEmit` 与生产构建 |
| `pnpm test` | **通过**；覆盖全量既有回归脚本及本轮新增内容／报价／发布／摘要测试；新增 transition lease 后暴露的跟进 worker 测试夹具缺口已补齐并完成重跑 |
| `pnpm run audit:production` | **通过**；0 项生产依赖漏洞 |
| `pnpm dlx npm@11.6.2 audit --audit-level=high` | **未通过**；开发链仍有 Electron 33 与 `extract-zip` 两项 high，自动修复要求破坏性升级到 Electron 44 |
| vendored SheetJS 与产品导入安全测试 | **通过**；校验来源／SHA-256／包名／版本／LICENSE，并覆盖格式签名、ZIP 展开量和工作簿资源上限 |
| 真实 PocketBase 历史升级／恢复 | **未验证** |
| 1,200 已登录会话容量、故障和恢复 | **未验证** |

`quality`、全量测试和生产依赖审计通过，只证明该稳定工作树的静态、单元／集成、回归、构建及 Web／API 生产依赖门禁成立；完整开发依赖审计仍未清零，也不证明完整四 Agent 业务闭环、真实 provider 计量、生产迁移恢复或千人并发。

## 7. 建议关门顺序

1. 先接入灵小图真实内容生成／渲染 provider 与灵小售自然语言询盘，同时把所有真实调用接入 usage ledger；保留现有精确血缘观察器和确定性结果摘要作为真实性边界。
2. 完成灵小量素材 ZIP 与可信平台／签名回执 verifier 的运行调用方；登录态辅助继续独立封闭，不阻塞基础发布包路径。
3. 补 database CAS、事务 outbox/inbox、可靠消息队列和 worker 恢复，再拆 API/Worker；不要在进程锁仍影响正确性时水平扩容。
4. 恢复四类生产现场的完整只读信息密度，并完成白标／Owner 邀请／标准开通与 scoped support grant。
5. 将 Electron 33 → 44 作为独立桌面兼容性迁移处理，关闭 `extract-zip` 链 high 风险并取得完整依赖 audit 0；禁止直接执行破坏性自动升级。
6. 用真实 seed tenant 跑通“事实 → 内容 → 审批 → 发布包 → 发布证据 → 询盘 → 确定性报价 → 审批／发送证据 → 结果卡”。
7. 最后执行 1,200 会话容量、故障、恢复和长稳门禁，证据达标后才扩大生产灰度。

## 8. 对外发布声明约束

当前可以准确表述：

- “已完成灵小枢唯一入口的 starter 产品壳、低对话三类卡片和四 Agent token／成本展示”；
- “已建立固定四 Agent 10 节点任务图，每个节点都有明确处理或受控投影路径；缺真实产物、审批或验证回执时会明确等待”；
- “已具备精确内容／报价血缘桥、受批准版本与工作流绑定约束的 JSON 发布 manifest、发布证据安全投影、确定性结果摘要和报价自助纵切”；
- “Web／API 生产依赖审计当前为 0，产品文件导入已增加 vendored 依赖与资源门禁”；
- “198 默认不要求客户配置官方 API，购买／支付不在本期范围”。

当前不得表述：

- “四 Agent 已全自动联调完成”或“7 日闭环已经跑通”；
- “发布包已经是完整素材 ZIP”“发布已被平台验证”或“登录态辅助发布已上线”；
- “AI 已能理解任意客户消息并全自动报价／发送”；
- “所有模型和工具成本都已准确计量”；
- “全部依赖漏洞已经清零”或“桌面端依赖风险已关闭”；完整开发依赖审计仍有 Electron 33／`extract-zip` 两项 high；
- “系统已经支持 1,000+ 用户同时使用”或“已通过 1,200 并发”。

任何草稿、排期、请求提交、JSON manifest 或人工自报证据都不得被描述成真实发布、触达、询盘、发送或成交。
