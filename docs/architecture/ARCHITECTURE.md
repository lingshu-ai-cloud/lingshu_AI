# 当前架构摘要

更新时间：2026-10-21（Asia/Shanghai）

## 边界

- `src/components/socialContent/`：工作台与用户交互；不得自行绕过服务端租户鉴权或供应商成本控制。
- `src/components/ConversionPage.tsx` 与 `src/components/customers/`：页面持有会话状态和三栏视图；客户定位/加载、草稿翻译副作用与渠道发送适配分别落在客户子模块，真实发送仍经过现有服务端出站接口和回执边界。
- `src/components/EnterprisePage.tsx` 与 `src/components/enterprise/`：页面持有可编辑企业资料和导航；资料默认值/快照、服务端读写校验、FAQ/销售风格控制器及业务视图由企业资料模块负责。保存成功必须以服务端读回和产品身份校验为依据。
- `src/lib/studioApi.ts`、`src/lib/socialImageApi.ts`：前端 API 适配层。
- `shared/contracts/`：跨端任务、内容与交付合同；字段变更需检查旧任务兼容性。
- `server/routes/`：HTTP 鉴权、输入规范化、租户上下文和响应编排；业务算法逐步下沉到领域模块。
- `server/socialImage/`：图片任务、参考画布、首版策划、图层合成、修订和质量判定。
- `server/starter198/socialContentProductionExecution.ts`：社媒自动生产 worker 的阶段编排；素材路线重绑定与动态主持人背景锁由 `socialContentProductionRouting.ts` 负责，`socialContentProductionMaterialPreparation.ts` 在预算认领前读取任务素材、核对已批准本地路线并记录重绑定证据，非渲染代拍清单投影由 `socialContentShootingPlan.ts` 负责。`socialContentProductionScriptBaseline.ts` 负责已冻结脚本快照校验、兼容重建和原任务持久化；不能在恢复时悄悄采用更新的企业事实或模板。成片后复刻评估的参考视频只从任务素材或租户路径、来源和哈希均匹配的缓存读取，由 `socialContentProductionReplicationEvaluation.ts` 负责。原 worker 导出维持兼容。
- `server/lib/translationCues.ts`：时间戳配音翻译的纯文本解析、cue 完整性校验和响应形态归一化；Express 超时/连接生命周期保留在路由 adapter。
- `server/lib/imageGen.ts`、`server/agents/qwen.ts`：供应商适配；调用由服务端显式选择并受预算/回执边界约束。

## 图片管线数据流

工作台输入 → 租户任务合同 → 企业素材准入 → 策划与确认字段 → 图像生成 → 素材持久化 → 确定性预检 → 多模态复核/人工审阅 → 交付。

确定性失败不可被模型复核覆盖；多模态服务不可用时状态保持不确定，不得推断通过。多输出轮播/GIF 使用冻结计划、逐单元原子认领和持久化回执；结果不明时停止后续付费提交，只能核对已有素材。GIF 的产品与文字在背景底图持久化后由固定图层合成，最终动图单独登记与质检。工作台接线及本地合同测试不等于真实供应商、浏览器交互或发布验收。

## 依赖方向

共享合同不得依赖 React、Express 或供应商 SDK。领域模块不得依赖页面组件。路由只做边界校验和编排；新的复杂逻辑应先落独立领域模块，并保持租户身份从认证上下文向下传递。

## 架构治理

机器门禁由仓库根目录 `architecture.config.json` 和 `scripts/check-architecture.mjs` 执行。普通生产 TypeScript 文件上限 800 行；历史超限文件使用精确预算，只允许持平或下降。每个治理批次最多拆分 1–2 个热点文件，并单独记录行为验收。
