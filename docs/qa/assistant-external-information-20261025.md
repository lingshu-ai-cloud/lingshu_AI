# 灵小枢外部信息第一轮开发验证

日期：2026-10-25（Asia/Shanghai）。本记录为开发验证，不是集成基线推进；后附真实前端只读查询结果，未达到完整供应商验收。

## 起点与变更

- 工作树：`/Users/julia1/Documents/ChatGPT/1025灵小枢外部信息`。
- 分支：`feature/assistant-reply-quality-20261025`。
- HEAD/恢复参照：`7801dd0f90ce5b27a52540069b8fbfd330ae654b`。开始时干净；本轮修改尚未提交，不更新共享 `BASELINE.md`。
- 原集成工作树及其 `server/index.ts` 未提交修改未触碰。
- 首页入口、会话、任务执行、企业资料和报价服务复用原实现，无数据库迁移、依赖包或新增付费数据商。

改动位置：

| 范围 | 文件 |
| --- | --- |
| 来源路由、明确条件的数据问答 | `server/assistantContext/externalQuestion.ts`、`externalAnswer.ts`、`externalAnswer.test.ts` |
| 共享汇率、Comtrade、HTTP边界与来源附录 | `server/externalInformation/{exchangeRates,comtrade,http,sourceFooter,externalInformation.test}.ts` |
| 原模型层及 Qwen 原生来源适配 | `server/agents/llm.ts`、`qwenSearch.ts`、`qwenSearch.test.ts` |
| 现有首页/共享问答入口、经营日报 | `server/routes/{strategy,agentChat,schedulerBusinessDynamics}.ts`、`strategy.grounding.integration.test.ts` |
| 已有客户端错误解释 | `src/lib/assistantStreamCompletion.ts`、同名测试 |
| 测试入口、配置和决定 | `package.json`、`.env.example`、`docs/architecture/adr/2026-10-25-assistant-external-evidence.md` |

## 已执行验证

命令执行时将工具提供的 Node 目录加入 PATH；使用已存在的依赖目录软链，不安装新依赖。

- `pnpm run test:assistant-quality`：63/63，0跳过。新回归已并入此命令；覆盖来源路由、Qwen/Gemini 模拟响应、正文末尾来源、无来源零正文泄漏、缺端点不换域名、exact执行范围拒绝额外搜索、币种方向/金额精度、时间异常/缓存、Comtrade范围与重复口径、受限样本、429不重试等。
- `pnpm run test:assistant`：完整命令退出0，保持会话、任务动作、签名对象/版本及执行入口原合同；各分组数量不相加为不重叠总数。
- `pnpm exec tsx --test src/lib/assistantStreamCompletion.test.ts server/quotation/engine.test.ts`：6/6。报价 golden、精确金额、重放哈希、权限边界及有界外部错误解释通过。
- `pnpm run lint`：通过。中间一次因新增集成测试访问 `unknown` 返回值而失败，改为完整对象比较后通过；未修改生产类型或放宽检查。
- `ARCHITECTURE_BASE_REF=7801dd0f pnpm run check:architecture`：通过，2788个生产TS文件，含预算ratchet，未增加预算/豁免。
- `pnpm run build`：通过，Studio 371875/485000字节，懒加载导入边界通过；存在既有其他chunk体积提示。
- `git diff --check`：通过。

实际 HTTP 集成使用既有登录/租户/角色与本地 store fixture，外部传输全拦截：

- 纯汇率100美元换人民币由数据接口和原金额模块直接计算，不调用模型。
- Comtrade返回指定年/报告国/HS/方向的记录，正文注明美元、年份和样本范围。
- 公共资讯不读取企业上下文；伪造的客户端 `userQuestion` 不改变实际消息的路由。
- 引用同时存在于 sources 事件及最终回答末尾；完整正文经过原 `parseMessages` 保存合同校验，包含来源附录。
- 缺来源返回错误及DONE，不泄漏模型结论，也不追加第二次供应商调用。
- 原租户隔离、记忆撤销、经营证据与创作选择隔离测试继续通过。

日志位于本机 `/tmp/lingshu-reply-{quality-tests,assistant-tests,calculation-tests,provider-tests,types,architecture,build}.log`，是临时开发证据，并非持久发布审计库。

## 限制与下一步

以下为浏览器验收前的阶段记录；真实查询状态以后附结果为准。

- 未发起真实模型、汇率或 Comtrade API 查询；未注册、购买、OAuth、发消息、投放、迁移、推送或部署。外部 run/task 标识：无。
- 当前 MaaS/代理是否提供与现有Key同域/同区域的 Qwen 原生 Generation API，尚未验收。未知绑定要求配置 `QWEN_SEARCH_ENDPOINT`，缺配置明确失败，不能把本地替身通过写成联网Ready。不得将Key粘贴到聊天。
- Gemini真实检索可能返回Google中转引用URL。当前严格来源域名校验不会把中转链接当作已确认的原始官方域名；这种情况会拒绝结论，需要在真实验收时评估可核验的来源解析方式。未声称真实双供应商来源兼容性已验收。
- Comtrade无Key使用限量preview；有Key仍仅请求500条。200次/日为每进程限制，非账号全局保证。首版支持单年、明确国家名和HS编码；月度、增长率、复杂国家/产品语义先澄清，不声称全量自然语言贸易分析已完成。
- 汇率为每日参考数据，不提供历史/银行买卖价/实时结汇价；不修改企业报价。
- 未新增阿里国际站、蝉妈妈、FastMoss会员数据、WTO、Tavily或物流接口；无授权不声称读取这些数据库。
- 本轮不改变界面布局；验证到HTTP/SSE/保存合同，未做真实账号浏览器验收。未运行整仓 `pnpm test`、33阶段quality/verify、目标库迁移或供应商E2E。
- 下一步：在当前账号与区域核实原生检索端点及来源返回能力，在明确预算和稳定基线下单独验收真实供应商；再决定是否需要其他接口。不会自动购买或用无来源生成代替失败。

## 本地前端真实查询（后续验收）

用户要求在首页发问并截图。使用本工作树的独立前端5265、后端8865，沿用本地预览身份与现有隔离守卫；企业资料与一条阻塞任务为明确标记的本地合成验收数据。模型、汇率和Comtrade请求为真实只读调用。没有任务执行、渠道发送、购买、迁移、推送或部署。HEAD仍为7801dd0f，所有改动未提交；安全恢复参照为该提交，未操作其他工作树。

为完成预览，只在原有 action scope 中增加显式开发环境开关 `ASSISTANT_PREVIEW_REAL_QUERIES=1`，限定已知模型问答端点及汇率/贸易GET，每轮最多16请求；不开渠道或任务写入，作用域结束即关闭。私有预览配置位于本机临时目录，项目未保留 `.env.local`，账号密钥不写入报告。相关文件为 `scripts/customer-preview-ai-scope.{mjs,d.mts}`、`scripts/local-preview-provider-env.mjs`、`server/assistantContext/previewInformationScope{,.test}.ts` 与原strategy路由。

| 前端问题 | 实际结果与判定 |
| --- | --- |
| 100美元换人民币 | ExchangeRate-API真实200，返回668.49 CNY、上游数据时间与查询时间，每日参考口径、正文末尾来源均可见；通过。 |
| 内部“核对出口资料”任务状态 | Qwen真实200，读到本地任务blocked/等待人工确认HS编码，审计没有搜索或数据接口请求；新会话复测事实一致。连续追问曾出现无证据的历史推断和内部标识残留，已强化提示，不能声称所有多轮表述问题解决。 |
| 2025年中国HS8504出口伙伴与金额 | UN Comtrade preview真实200，按2025/中国/出口/HS8504返回美元金额与来源；美国4,516,649,816美元等。自然表达首轮被过严解析拒绝，放宽展示指令并加入回归后通过。数据是年度历史记录，不是客户清单或实时订单。 |
| 阿里/海关近期资讯 | Qwen原生Generation真实200，sources及正文末尾链接可见。但首轮混入旧闻/社区页面，质量未通过；收紧阿里官方子域、近期30天与日期检查后再测海关。海关回复有日期、数字与官方链接，但原文独立核验遇到curl35连接失败及curl60证书链错误，未绕过TLS；不能确认所述数字或标题日期与原文相符，本项仍未通过内容验收。 |
| 银行买入价作为实际结汇价 | 明确说明尚未接入此口径，不以每日参考汇率代替，未新增外部请求；通过。 |

同域原生检索配置 `https://maas.qianwenaiapi.com/api/v1/services/aigc/text-generation/generation` 已在本机现有账号成功调用，未切换账号或把密钥发送至新域名。示例request IDs：内部 `df5a8f1f-4ce9-9760-928a-0bf221618010`；海关检索 `f85db1bd-d39c-9a28-8740-845c738614af`（一次turbo搜索，input9266/output200）。未检验真实Gemini回退、付费Comtrade或其他供应商。无外部任务run标识。

新增近期检索与回归涉及 `externalQuestion.ts`、`qwenSearch.ts`、`llm.ts`、两条问答路由及测试；日期检查只检验回答中日期，不能代替原文真实性核验。没有新增资讯抓取旁路。内部事实表述规则位于 `chatInput.ts`。

补充验证：`pnpm run test:assistant-quality` 66/66；`node --test scripts/local-preview-provider-env.test.mjs scripts/customer-isolation-bootstrap.test.mjs scripts/customer-isolation-diagnostics.test.mjs` 15/15；`node scripts/run-customer-isolated-tests.mjs scripts/customer-isolation.test.mjs server/customerService/localPreviewAiIsolation.test.ts server/customerService/localPreviewReplyCompatibility.test.ts` 10/10。重新运行 `pnpm run lint`、`ARCHITECTURE_BASE_REF=7801dd0f pnpm run check:architecture`、`pnpm run build` 均退出0；`git diff --check`通过。未运行全仓quality/verify或生产迁移。

真实会话刷新后正文不恢复，是当前 `withoutPersistedConversation` 与既有合同的行为；本轮未改动。前述保存合同校验不应解释为刷新后完整对话恢复通过。

证据：截图位于工作树 `artifacts/assistant-browser-20261025/`；脱敏调用审计、测试与构建日志位于 `/tmp/lingshu-assistant-browser-20261025/`。截图反映实际页面，包括未验收的资讯结果，不作为其内容正确性的背书。当前已验证真实前端请求、后端路由、指定数据接口/模型返回和SSE展示；完整回复质量验收仍被资讯原文核验与多轮内部表述问题阻塞。

## 后续修复：总体结论、原文核验与多轮事实

用户要求继续修复并固定“分析/结果 → 总体结论 → 信息来源”的顺序。新增 `sourceVerification.ts` 复用原有有界HTTP传输；`shared/assistantPublicSourcePolicy.{mjs,d.mts}` 同时供服务端原文读取与本地action scope使用。只读取最多3篇实际引用原文，不添加付费数据接口或第二次模型补写。检查角标索引、标题、逐字短摘录、完整日期与数字，以及近期publication字段；失败不释放模型断言，返回 `search_source_verification_failed`、安全总体结论与标明原文未核验的来源。SSE来源事件同步保留这些线索，避免现有Markdown链接规则把正文中的来源链接移除。日志只记录稳定失败原因及来源主机，不记录上游私密错误。

`taskStatusAnswer.ts` 在原 `buildChatGrounding` 内格式化已鉴权的工作流任务读投影；唯一具名事实问题直接回答当前记录、阻塞点、证据边界与总体结论，无额外读库或模型调用。限量记录明确样本范围，同名不混合，执行请求仍走原路径。复杂分析继续原模型；提示明确历史助手回答不是证据，不从blocked推导从未开展或没有其他问题。

普通首页及共享问答限量缓冲后检查总体结论，缺失则明确失败而非偷偷补调；心跳和取消保持。汇率、贸易及澄清回复使用确定性总体结论，随后追加来源。另修正“不要求近期”的来源路由，明确WTO走官方域名。

前端已实际复测：具名任务纠错正确，说明阻塞记录不证明从未开展，并给出先处理HS确认的总体结论；100美元换算结果在总体结论后列来源。海关查询已拦截未核验模型内容，显示安全总体结论和未核验线索；WTO查询服务未返回来源，明确说明本轮未取得资料，没有换数据商或付费重试。普通未联网问答首次仍把免费邮箱/没有官网夸大为风险依据，并列未核验的认证与技术判断；已补充提示约束，区分必要报价条件与可选资质，禁止此类推断。真实资讯“可稳定产出经原文核验的正确答案”仍未验收：外部原文可达性、检索无结果及完整语义判断不能由词面检查替代。

本次命令：`pnpm run test:assistant-quality` 74/74；`pnpm exec tsx --test src/lib/assistantStreamCompletion.test.ts src/lib/assistantChatStream.test.ts` 8/8；`pnpm run test:assistant`完整命令退出0；原客服隔离10/10。`pnpm run build`通过（既有chunk体积提示保留），相对7801dd0f架构检查通过（2791生产TS文件，无预算豁免）。类型检查中发现一处测试数组被assert收窄为never[]，已改用独立数组，不放宽生产类型。最终类型检查及git diff检查结果按交接中的实际命令为准。未运行整仓quality、黄金E2E或迁移。

源码仍为7801dd0f上的未提交修改；没有推进集成基线、提交、推送、部署或写生产数据。安全恢复参照不变。新增截图名称以 `06-` 及之后编号标记本轮结果。开发预览在源码/文档变更后可能热重载并清空会话，截图应在完整回复出现后立即保存；此现象不作为供应商错误。

补充收口：普通问答复测还暴露出擅自生成“两小时内响应”的话术、把未提供的企业规则解释为不存在。修复根因：一般方法且明确不联网的问题不再加载不相关企业上下文；具名任务、显式内部问题与创作继续原grounding。新增禁止未经证据的企业流程判断、主动话术及履约承诺规则。任务限量投影明确不能排除同名，未知状态不继承对象原型。原文日期优先使用明确publication元数据，不允许较新的侧栏日期替换旧文章日期，无元数据时仅在article/main正文内读取发布时间。相关回归已加入本轮定向命令，最终次数以实际结果为准。

一般方法继续收口：实测显示仅靠长提示仍可能生成未核验法律、绝对前提和主动话术。因此该明确不联网且不需要企业事实的场景改用简洁的同一模型提示，并在现有缓冲交付点检查已复现的未核验法律、企业规则断言、绝对前提、主动copy话术及响应承诺；不通过则明确失败、零正文泄漏，不付费补调。这不是完整语义审查，未知类型的推断仍需持续评估。最终定向回归已增至76项，另有输入边界文件内新增断言。

最终普通问答页面返回了带适用范围的总体结论、不再以免费邮箱/官网缺失直接拒绝报价，但正文仍出现未核验的“特定行业监管下必要资质凭证”判断。将这条真实复现加入交付拦截与回归断言；不能据本轮声称开放式回答的全部语义质量已通过。总体结论格式、数据口径及已知失败拦截的完成状态，与模型全部内容正确和真实资讯可达状态分开记录。

## 来源默认折叠（用户后续修订）

共享 `src/components/AgentReply.tsx` 将服务端来源附录和旧sources列表合为“数据和信息来源”入口，复用现有Ant Collapse ghost/small，默认收起、点击展开或收起，独立于详细分析。来源附录仍完整保留在消息正文与元数据中；页面仅改变展示，不改联网、数据、任务或持久化契约。总体结论、数据口径及核验失败结论不隐藏。代码块中的同名示例不误拆，无来源不展示空入口。产品规范新增对应交互约定，采用Ant官方Collapse模式。

`pnpm exec tsx --test src/components/AgentReply.readable.test.tsx` 5/5；包括分析展开与来源仍折叠、正文总体结论可见、去除重复来源、历史sources和代码块边界。类型、架构、构建及浏览器交互结果以本轮交接实际证据为准。HEAD与安全恢复参照仍为7801dd0f，改动未提交，未推送或部署。
