# 图片生成管线数字员工执行手册

更新日期：2026-10-23（Asia/Shanghai）

## 1. 使用边界与当前证据

本手册描述功能分支 `xixi图片生成+GPT降级分析` 的当前图片管线，文档起点提交为 `23b1bb93f18d0780b2cc668d7e3057531ab17789`。该分支不是 `docs/governance/BASELINE.md` 记录的集成基线。

数字员工必须区分三种结论：

- **已验证**：源码合同、隔离测试、HTTP 集成测试或确定性渲染已通过。
- **待真实联调**：需要真实租户、企业资产、供应商账号、额度、预算和唯一 run 才能得出结论。
- **未授权**：本次不合并、不部署、不运行真实付费生成、不写入生产数据。

执行前先记录：源码分支与 SHA、工作区状态、服务版本、持久化 store、租户 ID、企业产品资产版本、参考图指纹、供应商模型与预算回执。任一项不可确认时，不得开始真实付费调用。

## 2. 数字员工执行原则

1. 任务与资产必须来自当前鉴权租户；不使用页面传入的租户 ID。
2. 所有更新携带 `expectedVersion`；收到 `409` 时先 `GET` 最新任务，不覆盖服务端状态。
3. 付费请求前必须先持久化 job/冻结计划，并由服务端原子认领。
4. 超时、断网或响应丢失均属于“结果未知”；不得自动重提。
5. 产品主图、Logo、参考图或冻结输入不可读时停止。不得清空 `productIds`、降级成无产品生成或用竞品图代替企业身份图。
6. 确定性失败不能被多模态结果覆盖；模型缺失的检查保持 `uncertain`，不得猜测为 `pass`。
7. 只有当前交付物的全部硬质量项为 `pass`/`not_applicable`，且多输出单元齐全时，才能进入可发布状态。

## 3. 主管线调用顺序

```text
灵感图文入库
  → 千问 VL 拆解客观事实、遮罩和图层
  → 结果完整性/置信度判定
      ├─ 合格：保留千问结果
      └─ 低置信/结构冲突/千问失败：GPT 携原图复核
  → 灵感详情中选择“爆款裂变”
  → 创建租户图片任务
  → 保存产品、事实、输出规格与参考快照
  → 生成文案/渲染策划
  → 选择执行路线：
      ├─ 参考图产品海报：分层编译 → 确定性渲染
      ├─ 普通单图：原子认领 job → GPT Image 2 生成/编辑
      ├─ 轮播：冻结 4 个单元 → 按顺序逐张 GPT Image 2
      └─ GIF：冻结 4 张背景底图 → 逐张 GPT Image 2 → 固定图层合成 GIF
  → 产物入企业素材库并记录 provenance/SHA
  → 确定性预检 + 千问视觉复核
  → 人工审阅/按图层修订
  → 全部硬质量门通过后才允许交付
```

GPT 视觉只是低置信分析复核；`gpt-image-2` 是最终生成模型；千问还负责产物视觉质检。三者不得在运行记录中混为同一“生成供应商”。

## 4. 节点输入、输出、接口与恢复

### 节点 A：参考图文分析

- **输入**：最多 10 张原图、标题/caption、来源平台、标签。
- **默认调用**：`analyzeImagePostEvidenceWithQwen`，模型由 `QWEN_VL_MODEL` 控制，默认 `qwen-vl-max`。
- **输出**：`imageEvidence` v2，包含可见事实、OCR、轮播功能、可复用模块、`layerBlueprints`、不确定项和 `routing`。
- **GPT 复核触发**：图片事实或图层缺失、平均置信度低于 0.72、缺背景层、图层 ID/深度冲突、不确定项过多或千问失败。
- **GPT 配置**：`SOCIAL_IMAGE_ANALYSIS_REVIEW_MODEL`，其次 `OPENAI_VISION_MODEL`，默认 `gpt-4.1-mini`。
- **异常恢复**：原图下载失败或必要的 GPT 复核失败时标记分析失败；不用低可信千问结果假装完成。由操作者修复图片可读性/密钥/额度后手动重新分析。
- **证据**：分流阈值、GPT 原图请求与几何归一化的隔离测试已通过；真实千问/GPT 准确率、费用和延迟待联调。

### 节点 B：创建与恢复任务

| 目的 | HTTP 接口 | 主要输入 | 成功输出 |
| --- | --- | --- | --- |
| 自由创作 | `POST /api/overseas/social-images/tasks` | 类型、产品、事实、规格、企业资产 | `201 { task }` |
| 爆款复刻 | `POST /api/overseas/social-images/tasks/from-reference` | 上述输入 + `referenceSnapshot` + `referenceLayerBlueprints` | `201 { task }` |
| 读取/恢复 | `GET /api/overseas/social-images/tasks/:id` | 任务 ID | 最新服务端任务 |
| 保存修改 | `PATCH /api/overseas/social-images/tasks/:id` | `expectedVersion` + 有界 patch | 版本递增后的任务 |

服务端拒绝客户端伪造 `renderPlan`、`gifDelivery`、付费 job 结果和成片质检证据。输入已冻结时返回 `social_image_paid_inputs_frozen`；数字员工必须转入回执核对，不能继续改输入。

### 节点 C：文案与首稿策划

- **接口**：`POST /api/overseas/studio/fb-poster`。
- **输入**：当前任务、产品事实、参考快照、目标市场、用户已确认事实。
- **输出**：`poster`、`caption`、`hashtags`、`fieldsToConfirm`。同步回写 `renderBrief` 和 `imageTextContract`。
- **恢复**：策划模型超时/格式错误可返回可编辑的确定性文案草案；未核实商业声明必须被清理并保留到 `fieldsToConfirm`，不得在成片中偷渡。

### 节点 D1：分层确定性首稿

仅用于已具备企业产品资产的爆款产品海报。

1. `POST /tasks/:id/compile-layered`：把参考区域、遮罩透明度、图层前后关系、产品资产和文案编译为 `layerGraph`。
2. `POST /tasks/:id/render-layered`：使用 Sharp 确定性渲染 PNG，写入租户隔离的 `data/social-image-renders/<tenant>/`，生成 `sha256`和 `quality_checking` 输出节点。
3. `POST /tasks/:id/quality/preflight`：进入质检。

分层编译或渲染失败时，页面可回到通用 GPT Image 2 路线，但通用路线仍必须携带原企业产品 ID/身份图。产品主图不可读时必须停止，不得用无产品请求降级。

### 节点 D2：普通单图付费生成

- **预写入**：客户端通过任务 PATCH 创建 `queued` job，含唯一 `jobId` 与 `idempotencyKey`。
- **接口**：`POST /api/overseas/studio/fb-poster/render`。
- **服务端顺序**：校验企业事实→读取产品/素材/参考图→计算付费输入 hash→原子认领 job→消耗配额→调用 GPT Image 2→先写企业素材库→再完成 job。
- **图像接口**：无参考图调 `/v1/images/generations`；有参考图调 `/v1/images/edits`。模型固定为 `gpt-image-2`。
- **成功输出**：素材回执、租户内 `mediaUrl`、`materialId`、provider/model、已关联任务。

### 节点 D3：轮播与 GIF 付费单元

1. `POST /tasks/:id/plan-units`：校验产品字节并冻结最多 4 个单元，写入 `renderPlan.sourceHash`、每个单元的 `plannedInputHash` 和 job。
2. 按 `unit.index` 串行调用 `/studio/fb-poster/render`，请求只传 `imageTaskId` 和 `imageJobId`；服务端从冻结计划重建真实付费输入。
3. 前一单元已生成且产物持久化后，才能认领下一单元。
4. GIF 底图齐全后调 `POST /tasks/:id/finalize-gif`：读取已持久化底图，确定性叠加产品、遮罩、文字与品牌层，存档合成帧和最终 GIF。`finalize-gif` 本身不调付费图片供应商。

计划需要废弃时调 `POST /tasks/:id/abandon-plan`。只能废弃确知未运行的单元；`running`/`outcome_unknown` 存在时禁止废弃和重新计划。已生成的历史素材与付费回执不删除。

### 节点 E：质量预检

- **接口**：`POST /tasks/:id/quality/preflight`。
- **确定性检查**：产品 ID 绑定、事实状态、文字容量、参考快照/复刻配方。
- **千问视觉检查**：包装可见性、主体可见性、OCR、图文一致、品牌一致、安全区和参考结构。
- **合并规则**：确定性 `fail`/`pass` 不被模型覆盖；模型只能解决 `uncertain`；未返回的项仍为 `uncertain`。
- **输出**：每个产物的 `qualityChecks`、`approved`/`repair_required` 状态和可执行 `repairInstructions`。
- **模型不可用**：保留不确定结果并进入审阅，不冒充自动通过。

### 节点 F：定向修订与交付

- **分层修订**：`POST /tasks/:id/repair-layered`，支持产品大小/位置、遮罩位置/透明度、标题和敏感商业声明删除；修订后再渲染、再预检。
- **普通重生成**：新建 job 和新的幂等键，不复用上一个结果未知的 job。
- **交付准入**：任务合同、多输出完整性和所有当前交付物的硬质量项必须通过。模拟事实、缺产品、缺输出或任一 `uncertain` 都不得声称可发布。

## 5. 付费请求状态机与恢复决策

| 观察到的状态 | 含义 | 数字员工动作 |
| --- | --- | --- |
| `queued` | 已写任务，供应商请求尚未被服务端认领 | 只允许服务端原子认领；不自行改 job |
| `running` | 付费请求可能已开始 | 等待或查供应商/素材库回执；不重提 |
| `output_ready` / `quality_checking` | 成片已持久化并关联任务 | 运行质量预检 |
| `completed` | 付费单元已完成并进入质量流程 | 继续审阅；不把 job 完成等同于成片可发布 |
| `failed` | 明确的提交前拒绝或供应商确定拒绝 | 核对原因后可以新 job 重试 |
| `outcome_unknown` | 网络/超时/回执丢失，无法证明成功或失败 | 停止后续付费请求；先查供应商回执和企业素材库 |

当素材库中已存在唯一匹配产物时，调用 `POST /tasks/:id/jobs/:jobId/reconcile-material`。该接口校验租户、task/job/input hash、来源、内容 SHA、可解码性和唯一性，只关联已有素材，永不再调图片供应商。无匹配、多匹配、hash 错或素材库盘点不完整时停止并升级给人工。

## 6. 稳定错误与处置

| 错误/类型 | 处置 |
| --- | --- |
| `409` 任务版本冲突 | GET 最新任务，重新计算下一步；不覆盖 |
| `social_image_atomic_store_required` | 当前 store 不支持安全原子认领；未调供应商，由管理员修复 store |
| `IMAGE_REFERENCE_ADMISSION_FAILED` | 产品/参考资产不可读或产品身份图不完整；修复企业资产后新建请求，不清空产品 ID |
| `social_image_paid_inputs_frozen` | 已冻结；先核对回执，只在无运行/未知 job 时显式废弃计划 |
| `provider_submission_unknown:*` | 不重试；查 provider receipt 和素材 provenance，必要时调 reconcile |
| HTTP `422` 输入/资产准入失败 | 修正输入或企业资产；证明未调付费供应商后才可重试 |
| HTTP `503` store/质检不可用 | 保留当前任务与产物；不推断质检通过，不盲目重提付费生成 |

## 7. 已验证与待联调清单

### 已有源码/隔离证据

- 图片领域单元与合同测试 53/53 通过。
- 图片 HTTP 集成测试 1/1 通过：伪造证据被拒绝，GIF 底图持久化后可幂等合成。
- 轮播/GIF 冻结计划、逐单元原子认领、未知结果停止、素材恢复和计划废弃已有回归覆盖。
- 遮罩透明度、图层 z-order、分层渲染与 GIF 固定叠层已用像素级隔离测试验证。
- 千问默认分析、GPT 按条件复核的触发逻辑、原图传递和几何归一化已通过隔离测试。
- 2026-10-23 修复产品主图不可读时清空 `productIds` 重试的身份绕过；工作台合同和完整图片管线测试通过。

### 真实联调前仍缺失

- 真实千问图文分析的遮罩/图层准确率、延迟与单图成本。
- 低置信样本触发真实 GPT 复核的模型可用性、结构化输出稳定性和费用。
- 真实 `gpt-image-2` 生成与编辑的模型开通、参考图限制、幂等回执、延迟和成本。
- 真实企业产品/Logo/参考图从对象存储读取及租户隔离。
- 登录后浏览器完整流程：单图、分层复刻、4 页轮播、4 底图 GIF、中断恢复、质检与下载。
- 真实运行中 PocketBase/store 的原子 CAS 能力和多实例并发行为。
- 一组固定参考图的视觉验收：遮罩轮廓/透明度、图层前后、产品身份、字号/信息层级与品牌位置。
- 发布链路和生产部署均未验证，也不在本手册开发任务的授权范围内。

## 8. 真实联调时的唯一执行次序

1. 仅在功能分支已按正常评审合入、集成基线冻结后开始；联调现场不直接修架构。
2. 为单一租户、单一产品、单一参考图建立唯一 run，记录输入指纹与预算。
3. 先跑图文分析，核对是否走千问直出或 GPT 复核，保存 provider/model/reviewReasons。
4. 再跑单张产品海报，记录 task/job/material/provider receipt 和费用。
5. 验证超时恢复：只查询任务与素材，不再调生成；若唯一素材存在，调 reconcile。
6. 单图通过后再分别执行轮播和 GIF，每次只验证一种交付物。
7. 记录每个输出的确定性检查、千问复核和人工判定；不把人工觉得“看起来可以”写成自动质量门通过。
8. 分别交接源码 SHA、服务版本、store 记录、run/task/job/material ID、供应商回执、成本、输出 SHA 与未决问题。

发现新漏洞、租户越权、产品身份绕过、重复付费风险、伪造质检或结果未知被当成失败时，立即停止当前 run，保留任务与回执，回开发分支修复并重跑回归。不得在真实联调现场修改门禁、换供应商或扩大重试。
