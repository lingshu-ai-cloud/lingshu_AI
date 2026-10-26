# 首页场景能力复用与迁入

## 开发位置与范围

- 起点：统一基线 `baseline/unified-20261026` / `86d855e110821fb309b2493a7d69d5afb6fc2c47`，开始时基线树干净。
- 隔离开发树：`/Users/julia1/.codex/worktrees/assistant-scene-capabilities/1025灵小枢外部信息`，分支 `codex/assistant-scene-capabilities-20261026`，HEAD仍为上述起点，本次改动未提交、合并、推送或部署。
- 原会话工作区的16项未提交内容保留，不整树覆盖、不带入卖点提炼代码或旧首页。没有改动基线工作树、真实数据库或原预览服务。
- 用户中途明确删除产品卖点功能，本次删除该入口及CO-03提炼卡片；没有迁入卖点生成接口、产品回填或口播优化。

## 卡片与现有链路对照

| 首页入口 | 现有链路及本次处理 |
| --- | --- |
| 查看当前周计划 | 原发布日历场景、周任务问答及经营上下文保留；增加内容创作任务进度卡片，接原strategy/chat与buildChatGrounding、内部任务读模型。具名任务的问答/确认后门户沿用原实现。 |
| 查看内容策略 | 保留原策略、内容、发布和投流规划提示词；经原问答与经营数据上下文返回建议，具体执行仍由专用流程确认。 |
| 查看外部资讯 | 五种资讯保留原planExternalQuestion、Qwen联网检索、权威域名策略、原文核验、总体结论、SSE来源及折叠展示；行业卡增加明确行业输入。补汇率与贸易卡，接原answerExternalData、readExchangeRates、readComtrade；不新增数据源/收费服务。 |
| 分析经营数据 | 保留原数据分析提示词、租户范围的经营上下文与专用分析页。未宣称所有外部账号都有真实数据。 |
| 点击开始创作 | 保留借鉴爆款、选定开场、活动内容、多平台改写、图文爆款复刻五种卡片；原assistantScenarioIntake、creationPortalNavigation、视频/图文任务和V4生产不改。 |
| 查看素材怎么用 | 保留原素材问答和现有素材/参考上下文，后续任务走原确认入口。 |
| 规划发布安排 | 保留原发布问答、日历及专用排期/发布链路，不从普通卡片直接发布。 |
| 跟进重点客户 | 保留原客户问答、租户范围经营上下文与专用客服/跟进流程；不通过普通提示词直接发送消息。 |
| 优化智能投流 | 保留原投流分析/计划问答、签名动作及专用计划管理、预算、授权、执行与回执链路。 |

后三类等普通分析卡片“已有链路”指已接原问答及业务页，不代表所有细分执行动作/供应商均验收完毕。本次只迁入会话已走通的条件收集与草稿衔接，不扩张其他领域能力。

## 实际改动

- `src/components/ContentCreationHome.tsx`：三个查询卡片打开共享条件对话框，生成提示词后走原草稿追加/替换保护。
- `src/lib/assistantHomeQuickPrompts.ts`：删卖点入口、增加两个外部数据卡片、暴露原CO-11任务进度卡片并明确内部问法。
- `src/lib/assistantQueryQuickPrompts.ts`、`src/components/assistant/AssistantQuickPromptDialog.tsx`：从原会话按需迁入查询条件与提示词生成，没有新增后端、供应商或任务服务。
- 对应目录/路由解析测试及package.json助手质量测试入口；产品规范记录本次用户修订。

## 验证

- `pnpm run test:assistant-quality`：101/101通过。新增场景路由和条件测试与原真实HTTP/SSE替身集成、企业事实/内部任务/外部核验测试一起执行；无真实模型或供应商请求。
- 首轮新增回归发现原CO-11包含“最新”且内部意图不够明确，误走web；修正提示词后完整重跑101项通过。没有放宽后端意图或来源门禁。
- `pnpm run test:assistant`：全部阶段退出0；普通问答、场景入口、草稿、线程、签名动作及权限合同保留。
- `pnpm exec tsx --test src/components/ContentCreationHome.contract.test.ts`：通过。
- `pnpm run lint`：通过（TypeScript）。
- `ARCHITECTURE_BASE_REF=86d855e1 pnpm run check:architecture`：2920个生产TS文件通过，相对起点预算棘轮通过。
- `pnpm run build`：通过；Studio 371881/485000字节，导入边界通过；现有大chunk告警保留。
- `git diff --check`：通过。
- 日志：`/tmp/assistant-scene-{quality,assistant,home,lint,architecture,build}-20261026.log`。使用桌面附带Node加入PATH；未另跑全仓quality/verify、生产迁移、真实供应商验收。

## 浏览器范围与证据

Chrome在临时5268前端测试：九组入口无卖点；行业空值校验/填写家具/回填；汇率默认美元兑人民币/已有草稿替换确认/回填；贸易中国、2025、出口、HS8504/回填；任务进度填入；原五创作卡片保留。没有点击发送或创建真实任务。

前端基于86d855e1开发树，UI验收代理原本地合成企业8865后端59d3fc06，保留前后端版本不一致提示；此浏览器证据只证明入口、条件和草稿交互，不能声称统一基线整链E2E。后端协议与SSE由上述101项隔离测试验证。临时代理只在本机验收脚本里使用，未写入生产配置或改变鉴权。

截图位于忽略的本地产物 `artifacts/assistant-scenes-20261026/01-trade-query.jpg`、`02-creation-preserved.jpg`、`03-external-scenes.jpg`。

没有外部run/task标识。恢复点：86d855e1与原会话保留工作区。后续如需进入共享基线，应先按当前基线重新核对并集成；本次没有推进BASELINE.md或声称部署/供应商Ready。
