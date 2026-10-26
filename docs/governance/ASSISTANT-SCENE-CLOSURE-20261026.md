# 首页助手场景链路闭环

> 后续用户修订：旧脚本库停用；本记录中的脚本库截图及跳转仅为原提交历史证据，当前承接以 [多平台改写内容创作承接修订](PLATFORM-REWRITE-CONTINUATION-20261026.md) 为准。

## 交付范围

功能分支：`feature/assistant-scene-backend-closure-20261026`。开发起点与安全恢复点：`240676bea03ccc67e2c83192bc1778bc96565e81`。本报告随实现提交，确切实现SHA使用 `git log -1 --format=%H -- docs/governance/ASSISTANT-SCENE-CLOSURE-20261026.md` 查询。

未合并或推送至本地基线、远端，未部署。任务结束只读观察到基线由其他工作推进为 `ff948eb3d043afa08cb2c7bd9ea08cca5357bdef`；本分支没有吸收该后续变更，不对新基线集成状态作验收结论。基线原 `server/videos/videoVisibilityMaintenance.ts` 脏补丁SHA256仍为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`。

## 清单与实现

| 场景 | 卡片 | 完成的原链路接入 |
|---|---|---|
| OP-01/05/07/08 | 周经营任务、今天优先、本周复盘、下一轮动作 | 日期绑定、原目标/任务/审批/复盘/当前待办；复盘与下一轮补客户/投流汇总 |
| OP-04/06、PU-04 | 数据分析、经营健康、账号表现 | 原经营集合全页读取，来源状态、分组统计与样例分开；账号授权信息；客户与投流快照汇总 |
| AD-01/02/03/04/06 | 投放数据、计划、渠道受众、预算目标、执行风险 | 原租户计划选择、授权/审批/执行/素材/指标；符合条件时原Meta campaign/adset/ad报告；新计划可无历史计划 |
| CS-01/02/03/05/07/09 | 优先跟进、会话摘要、回复草稿、高质量询盘、跟进计划、客户画像 | 原授权渠道客户/本地会话、对象及日期核验、可追溯筛选；会话类必须选择客户 |
| CO-07 | 多平台改写 | 原Studio源稿选择、原Qwen生成、编辑确认、共享Studio插入、幂等读回、历史创作新稿详情定位 |

修复8条已审计内部提示词误分外部搜索；类型化场景直接走内部资料。明确续问绑定对象并重新读取；新话题停止继承，日志持久化保留经过校验的助手场景。原已通的外部信息、内容生产门户、口播卖点回填等保持原流程。

## 文件范围

- `shared/contracts/assistantBusinessScene.ts`：严格场景、日期、对象与改写契约。
- `server/assistantContext/businessScenes/*`：权限、资料投影、经营/客户/投流适配、全页完整性与回归测试。
- `server/assistantContext/externalQuestion.ts`、`server/routes/strategy.ts`、`server/routes/assistantBusinessScenes.ts`：原聊天接入与端点。
- `server/platformAds/{readPages,connections,approvals,launch,creatives}.ts`：保留默认分页，增加显式全页读取。
- `server/scripts/platformRewrite*`、`server/studio/projectDraftStore.ts`、`server/routes/studioProjectSaveRoutes.ts`：改写草稿与原Studio共享持久化步骤；原保存准入不变。
- `src/components/assistant/AssistantBusinessSceneDialog.tsx`、`ContentCreationHome.tsx`、`GlobalAssistant.tsx`、`useAssistantSend*`、`src/appSession.ts`、`src/lib/assistantThreadJournal*`：条件确认、范围传递与恢复。
- `package.json`、相关测试、UI规范与ADR：测试入口和决策记录。

## 实际验证

在上述功能工作树执行；日志保存在 `/Users/julia1/.codex/integration-evidence/20261026-assistant-scene-closure/`。

| 命令/检查 | 最终结果 |
|---|---|
| `pnpm run test:assistant-quality` | 160/160通过，包括租户隔离、内部路由、统计完整性、三层Meta适配、源稿版本与幂等保存 |
| `pnpm run test:assistant` | 完整脚本退出0，包括场景续问与日志净化；不是仅最后一组12项 |
| `pnpm run test:platform-ads` | 73个测试文件通过 |
| `pnpm exec tsx --test server/routes/studioProjectSaveRoutes.test.ts server/routes/studioProjectReadRoutes.test.ts server/routes/studioProjectSaveCas.integration.test.ts src/components/ContentCreationHome.contract.test.ts src/components/HomeGrowthTour.test.ts` | 6/6通过 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint` | 退出0 |
| `ARCHITECTURE_BASE_REF=240676be pnpm run check:architecture` | 2974个生产TS文件通过，原历史预算未提高；GlobalAssistant 792行 |
| `pnpm run check:digital-employee-migrations` | 清单只读检查通过，无迁移执行 |
| `pnpm run test:migration-guard` | 隔离Git夹具通过 |
| `pnpm run build`、`pnpm run build:account-hub` | 退出0；保留大chunk警告；Studio预算371881/485000字节 |
| `git diff --check` | 通过 |

开发过程中相对导入、测试请求计数及新增非法日志夹具的TS声明曾失败，均修复并重新运行通过。未运行完整quality/verify，不将已知基线M1限制归为本次通过。

## 隔离联调证据

使用临时数据目录、合成企业/客户/广告计划/源稿、实际策略路由与鉴权、实际Studio读写及本地loopback模型替身；fetch限制仅本机。没有真实供应商调用或费用，没有业务客户消息、广告、发布或迁移写入。

- `http-matrix-final.json`：18个场景的选项读取→条件绑定→鉴权读取→流式回复全部通过；多平台生成、人工编辑、两次同请求保存仍仅新增两稿、Studio读回和源稿保留通过。
- 浏览器：客户缺对象校验、选客户问答、选广告计划分析、多平台选择→编辑→确认保存→脚本库实显。最终再次保存Instagram草稿并通过“查看脚本库”自动选历史创作、打开新稿详情；截图 `script-library-final.png`。
- `script-library.png`、`rewrite-review.png`、`rewrite-saved.png`、`customer-chat.png` 为此前同一隔离流程证据。模型替身仅验证协议与交互，不验证真实回答质量。

## 已知边界与下一步

- 真实模型质量、渠道授权、供应商Ready及真实Meta报告需要当前任务另行授权验收；没有宣称真实E2E或发布就绪。当前已完成本次代码与本地隔离闭环。
- 原客户读模型可能只提供买方消息，按返回范围分析；缺失双向消息或渠道档案不能假设完整。测试/历史客户不进入真实优先级统计。
- 非Meta明细沿用原模块能力；缺少已核验执行、授权或指标时返回不可用，不能补零。经营金额分币种、账号指标分口径，样例不能冒充总量。
- 全页读取与上下文有明确上限，超出要求缩小范围。分析输出与执行分开；本次不新增自动发送、自动画像写入或自动投放。
- 后续集成须针对当时基线重新审计；本次遵照用户要求保留在功能分支。
