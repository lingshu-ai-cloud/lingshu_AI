# 自由创作对话的事实与状态所有权

日期：2026-10-24（Asia/Shanghai）
状态：独立功能分支实施；未合入主基线、未部署。

## 决定

首页只选择爆款参考。原助手 `business` thread/store、请求身份 fence、abort handle、消息和 CAS 保存队列继续拥有对话状态。新增 `creationDraft` 是同一线程内的展示选择，`Message.creation` 是当前一轮选择快照；推进时只保留最新选择快照，原问答正文保留，以免重复持久化整份素材池。普通会话仍沿用原恢复规则，有创作草稿时恢复该身份下的创作对话。

`shared/contracts/contentCreationDialogue.ts` 定义有界选择、问题、素材片段和待创作方案，不定义生产任务。`server/assistantContext/contentCreationDialogue.ts` 在 strategy 领域处理只读推荐，路由只负责认证身份、输入输出和错误。既有 `trend_videos`、严格租户企业资料读取、`readMaterialLibrary`、参考逐镜/编导复核和人物校验仍为各自事实所有者。

`/strategy/creation-dialogue` 按明确 action 异步重读证据，不访问供应商、不写任务或队列。产品使用现有稳定产品身份；参考只接受当前租户记录；分镜由核验过的参考首镜和素材库存片段投影。SHA-256 绑定参考分析、人工复核、产品事实及候选片段；后续采用时检查版本，变化返回 `creation_evidence_stale`。产品确认/刷新是显式重新读取推荐的检查点。

`/strategy/chat` 可携带有界 `creationSelection`，必须先重新核验再将所选参考、产品、分镜、口播与方案加入服务端模型上下文。客户端卡片标题、普通附件上传、线程快照或模型文本均不是执行授权。企业知识库 AI opt-out 被继续遵守，缺少租户资料不使用全局演示资料补齐。

三版口播采用证据约束的编辑规则，商业描述只取知识库完整事实句，画面描述只取所选片段；时长为明确标识的朗读估计。自由追问继续原策略模型链，不增加另一条模型或供应商调用路径。

数字人位置只由同一分析尝试下、已确认且非混镜的首镜复核标签确定；未确认或未选首镜时位置待定。待创作方案实际插入第二个数字人槽，或将首镜设置为数字人口播，且最多一个数字人槽。槽位复用共享 `DigitalHumanRequirements`，人物与内容确认保持 false。人物候选经 `validateHeyGenPresenterRecord` 和 `validatePresenterReferenceMaterials`；这些只读资格仍不等于生产可用性或供应商 Ready。

## 持久化与门禁

沿用 `assistant_threads` 的租户、用户、source 和 version/CAS 隔离。仅追加 `creationDraft` JSON 字段迁移（16 KiB 字段上界，线程仍受原 96 KiB 上界保护），Postgres 原 JSON 文档模型不新增表。迁移源码和 checksum 清单一起提交；本任务不执行目标库迁移，部署前须另行授权并演练。

请求重新选择、超时或切换身份后，旧回包不得改写新选择或新身份；失败不清除派活草稿。普通聊天、数字员工、灵感页裂变、客服和投流的业务链不新增分支行为。没有新聊天表、生产任务状态、队列或执行器；没有提高架构或 Studio chunk 预算。

## 验证和限制

见 [验收记录](../../governance/CONTENT-CREATION-DIALOGUE-20261024.md)。离线浏览器夹具挂载真实首页、全局助手和推荐处理器，片段为本机 FFmpeg 生成的测试图样；模型传输使用 loopback stub。它们只能证明交互、事实贯通和门禁，不证明真实供应商效果、语言质量、认证、收费或生产完成。
