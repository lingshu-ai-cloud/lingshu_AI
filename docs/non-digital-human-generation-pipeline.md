# 非数字人素材生成管线与“我的生成”开发设计

## 1. 文档目标

本文定义非数字人素材生成的产品边界、技术管线、执行节点和素材沉淀规范，并说明它与数字人三条管道、已有素材加工及代拍流程的关系。

本次建设需要达到以下结果：

1. 非数字人生成拥有独立、稳定的产品入口和技术路由，不再散落为多个隐式素材策略。
2. 产品场景、概念画面和动态图文使用各自明确的输入契约、生成器和质量门禁。
3. 所有可复用生成结果在生成成功后进入“我的素材 > 我的生成”，当前分镜只保存素材引用。
4. 供应商任务、生成规格、输入素材、质量证据和最终素材之间可以完整追溯。
5. 失败可以从原节点恢复，不能因为重试产生重复付费任务或重复素材。

## 2. 产品边界

内容生产分为四类一级路径。

| 路径 | 产品用途 | 是否生成新画面 |
| --- | --- | --- |
| A. 素材加工 | 对企业已有素材进行剪辑、裁切、字幕、调色和组合 | 否 |
| B. 数字人生成 | 生成人物口播、人物替换或参考动作复刻 | 是 |
| C. 非数字人素材生成 | 生成产品场景、概念辅助画面和动态图文 | 是 |
| D. 代拍任务 | 输出可执行拍摄清单并接收人工拍摄素材 | 否 |

### 2.1 数字人管道边界

数字人内部继续保留三条管道：

| 管道 | 路由条件 | 技术路径 |
| --- | --- | --- |
| 数字人管道 1 | `method=talking` | HeyGen 视频分身或照片口播 |
| 数字人管道 2 | `method=replace`，或 `method=reenact + direct_reference` | 本地人物替换、Kling、Runway Act-Two 等参考驱动适配器 |
| 数字人管道 3 | `method=reenact + sentence_first_frame` | 分句抽帧、动作识别、目标首帧重建、背景锁定、逐句生成与拼接 |

数字人管道 3 的动作提示词、背景锁定和逐句首帧质量协议不得应用到普通真人口播或非数字人素材生成。

### 2.2 非数字人生成模式

非数字人管线的产品标识统一为 `non_person_generation`，内部通过 `assetGenerationKind` 区分三种模式。

| assetGenerationKind | 产品名称 | 适用场景 | 关键约束 |
| --- | --- | --- | --- |
| `product_scene` | 产品场景生成 | 产品展示、包装、展台、产品运镜、使用演示 | 锁定产品身份、Logo、标签、包装结构和产品槽位 |
| `concept_visual` | 概念辅助画面 | 情绪、痛点、氛围、转场、抽象说明 | 不得充当客户工厂、案例、认证或效果证据 |
| `motion_graphics` | 动态图文 | 流程、参数、事实卡、字幕动画、CTA | 只允许使用已经确认的文案和事实 |

产品场景生成与概念辅助画面必须作为两个不同入口。产品场景生成强调产品身份准确；概念辅助画面允许较大视觉自由度，但必须明确其非证明性属性。

## 3. 统一生产状态机

所有生成管线共享同一组生命周期状态：

```text
draft
  -> planned
  -> preflight_passed
  -> submitting
  -> provider_pending
  -> generated
  -> quality_checking
  -> accepted | repair_required | failed | uncertain
  -> archived
  -> adopted
```

状态含义：

- `draft`：输入尚未完整。
- `planned`：已确定管线、生成模式、供应商候选和费用预估。
- `preflight_passed`：授权、预算、输入版本和供应商能力检查通过。
- `submitting`：正在创建供应商任务。
- `provider_pending`：供应商已返回任务 ID，等待结果。
- `generated`：已经取得可读取的媒体文件。
- `quality_checking`：正在执行自动质量检查。
- `accepted`：质量门禁通过，可以复用和采用。
- `repair_required`：生成完成但质量不合格，保留素材与证据供定点返工。
- `failed`：供应商明确失败或输入无法执行。
- `uncertain`：是否成功提交无法确认，只允许恢复原任务，禁止重新提交。
- `archived`：媒体和元数据已经进入“我的生成”。
- `adopted`：某个项目分镜已经引用该素材。

`archived` 与 `adopted` 必须分离。素材先进入素材库，再由一个或多个项目引用。

## 4. 统一执行节点

### N1. 镜头任务识别

输入：分镜目的、视觉主体、动作、台词、参考画面、产品和人物要求。

输出：

```ts
type VisualSubject =
  | 'presenter'
  | 'product'
  | 'environment'
  | 'information'
  | 'transition';

interface GenerationIntent {
  subject: VisualSubject;
  requiresProductIdentity: boolean;
  requiresPresenterIdentity: boolean;
  requiresCustomerEvidence: boolean;
  allowsSyntheticVisual: boolean;
  shotFunction: string;
}
```

### N2. 真实性边界

在供应商调用前确定：

- 是否允许合成画面。
- 合成画面是否只能作为非证明性辅助画面。
- 哪些事实、认证、客户案例和使用效果禁止无依据生成。
- 素材中是否出现竞品 Logo、品牌、包装、产品、字幕、水印或设备铭牌。
- 是否必须在成片或素材详情中显示 AI 来源标识。

现有 `SocialShotTruthBoundary` 继续作为社媒生产的权威契约，其他入口需要映射到同一语义。

工厂、生产线和仓库等说明性分镜不按素材来源区分“客户真实素材”与“行业素材”。候选可以来自“我的素材”、灵枢素材库、已导入爆款素材或“我的生成”。来源只记录血缘，不作为是否可选的条件。统一排除以下候选：

- 出现竞品 Logo 或品牌名称。
- 出现明显属于其他品牌的产品或包装。
- 字幕、水印、设备铭牌暴露竞品或与当前产品冲突的信息。
- 素材授权不允许当前用途。

通过上述检查后，候选可以用于介绍工厂、生产线或仓储流程。产品和工厂画面仍不得虚构可验证的认证、参数、客户案例或使用结果。

### N3. 输入锁定

根据生成模式冻结输入版本：

- 产品参考图及产品身份组。
- 参考视频、起止时间和参考镜头 ID。
- 环境、背景、布光、构图和产品槽位。
- 镜头起始状态、运动轨迹、结束状态和时长。
- 已确认文案和事实引用。
- 画幅、分辨率和语言。

任何影响生成结果的输入发生变化，都必须生成新的 `inputFingerprint`，旧结果不能自动复用。

### N4. 管线路由

```ts
type ProductionPipelineId =
  | 'material_processing'
  | 'digital_human_1'
  | 'digital_human_2'
  | 'digital_human_3'
  | 'non_person_generation'
  | 'shooting_plan';
```

非数字人生成的基础路由规则：

```text
先检索可用视频候选
  -> 候选能完成同样表达且没有竞品/授权冲突：复用素材

关键钩子、特殊动作、特殊运镜，或没有合格视频候选的产品场景
  -> product_scene / video AIGC

有已确认事实且适合图形表达
  -> motion_graphics / verified_fact_card

普通说明画面没有合格视频候选
  -> concept_visual 或重新设计分镜
```

禁止把静态产品图片通过平移、推拉、缩放、景深或简单转场包装成视频分镜。产品图片只能作为产品身份参考输入，供产品场景 AIGC 使用；也可以作为事实卡片的辅助视觉元素，但不能单独充当视频镜头。

### N4.1 多来源候选选择

同一个分镜出现多个来源候选时，先做资格排除，再在合格候选中选片。不得因为素材来自“我的素材”就天然优先，也不得因为素材是 AIGC 就天然判定质量更高。

第一步只排除硬冲突：

- 竞品品牌、Logo、包装或明显竞争产品。
- 与当前产品身份明显冲突。
- 不具备当前用途的授权。
- 无法形成可用视频区间，或媒体文件、质量状态不可用。
- 分镜要求关键动作时，候选没有完整动作过程。

第二步按以下固定优先级比较：

1. **表达作用是否一致**：候选能否完成当前分镜的钩子、展示、说明、证明、转场或 CTA 任务。
2. **动作与镜头是否接近**：动作路径、景别、构图和运镜是否接近参考分镜。关键钩子优先看这一项。
3. **主体是否正确**：产品、工厂、流水线、人物或环境是否符合需求。
4. **剪辑是否好用**：是否有完整起止点、足够时长，并能与前后镜顺畅连接。
5. **成本是否更低**：前四项接近时，优先已入库视频，其次本地处理，最后才调用付费视频生成。

不需要为每项建立复杂权重模型。实现上采用分层比较：先选“表达作用一致”的候选，再比较动作与镜头，仍然接近时选择更容易剪辑、成本更低的候选。

选择结果必须保存：

```ts
interface ShotCandidateDecision {
  selectedMaterialId: string;
  source: 'my_materials' | 'lingshu_library' | 'viral_import' | 'generated';
  reason: string;
  rejected: Array<{ materialId: string; reason: string }>;
}
```

素材复用不设置统一次数上限。高质量钩子可以跨经营包保留相同的 3～4 秒结构、动作、音画配合和核心台词，并通过替换人物、产品、色调、背景或字幕制作变体。通用口播、工厂、产品和流水线素材可以多次复用。系统只控制同一成片中的明显重复感：避免相同时间区间连续出现或无意高频重复；有意保留的钩子复用不受此限制。


### N5. 生成规格编译

禁止直接从一句业务描述拼接自由提示词。应先生成结构化规格，再由供应商适配器编译成最终提示词。

产品场景规格沿用 `SocialProductSceneReplicationSpec`，包括：

- `productIdentity`
- `sceneLock`
- `cameraLock`
- `tolerance`

概念辅助画面规格需要新增：

```ts
interface ConceptVisualSpec {
  schemaVersion: 'concept-visual.v1';
  purpose: string;
  subject: string;
  action: string;
  environment: string;
  mood: string;
  camera: string;
  durationSeconds: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  prohibitedClaims: string[];
  prohibitedCustomerReality: string[];
  disclosure: 'synthetic_non_evidentiary';
}
```

动态图文规格需要新增：

```ts
interface MotionGraphicsSpec {
  schemaVersion: 'motion-graphics.v1';
  verifiedFactRefs: string[];
  title: string;
  points: string[];
  visualStyle: string;
  brandAssetIds: string[];
  durationSeconds: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
}
```

### N6. 付费前预检

检查项：

- 供应商开关、凭证、模型和对象存储可用性。
- 输入素材属于当前租户且可读取。
- 外部模型处理授权和派生使用授权。
- 单镜预算、单次任务预算和周期预算。
- 供应商能力是否满足产品、背景、构图和动作保留要求。
- `idempotencyKey` 是否已经存在未结束或已完成任务。

### N7. 供应商执行

要求：

- 创建供应商任务前先写本地执行记录。
- 供应商返回任务 ID 后立即持久化。
- `uncertain` 状态只能查询原任务。
- 同一 `inputFingerprint + provider + model` 不得重复扣费。
- 多供应商回退只允许发生在供应商明确拒绝创建任务时。

### N8. 自动质量门禁

#### 产品场景

- 产品轮廓、颜色和材质一致性。
- Logo、标签和包装文字一致性。
- 产品数量与产品槽位一致性。
- 场景拓扑和构图一致性。
- 镜头轨迹和时长一致性。
- 黑帧、坏帧、跳变和几何变形检查。

#### 概念辅助画面

- 画面完整性和运动连续性。
- 无乱码、伪 Logo、虚构数据和伪认证。
- 不得出现客户真实工厂、案例或效果的暗示。
- 与镜头表达目的和画幅一致。

#### 动态图文

- 所有可读文字来自已确认文案。
- 数据、参数和声明均有事实引用。
- 字幕安全区、可读性和动画节奏合格。
- 无裁切、遮挡和超出画面。

自动质量结果统一为：

```ts
interface GeneratedAssetQuality {
  state: 'accepted' | 'repair_required' | 'failed';
  checks: Array<{
    key: string;
    status: 'passed' | 'failed' | 'unavailable';
    evidence: string;
  }>;
  checkedAt: string;
  policyVersion: string;
}
```

自动证据缺失时不得将素材标为 `accepted`。素材可以保留在“待修复”，但不能自动进入分镜。

### N9. 统一素材归档

生成器取得媒体并完成基础文件检查后，必须先调用统一的 `GeneratedAssetArchiveService`。

```ts
interface GeneratedAssetArchiveInput {
  tenantId: string;
  media: {
    type: 'video' | 'image' | 'audio';
    localPath?: string;
    objectKey?: string;
    mimeType: string;
    duration?: number;
    width?: number;
    height?: number;
    contentSha256: string;
  };
  generation: {
    pipelineId: ProductionPipelineId;
    assetGenerationKind: 'digital_human' | 'product_scene' | 'concept_visual' | 'motion_graphics' | 'final_video';
    pipelineVersion: string;
    provider: string;
    model: string;
    providerTaskId?: string;
    idempotencyKey: string;
    inputFingerprint: string;
    promptOrSpecHash: string;
    inputMaterialIds: string[];
  };
  lineage: {
    sourceTaskId?: string;
    sourceProjectId?: string;
    sourceAssemblyId?: string;
    sourceShotId?: string;
  };
  quality: GeneratedAssetQuality;
  rightsScope: string;
}
```

归档服务负责：

1. 验证文件真实存在且哈希一致。
2. 将临时文件复制或上传到租户私有持久存储。
3. 按 `tenantId + contentSha256` 去重。
4. 创建或更新统一素材记录。
5. 保存生成血缘、供应商回执、费用和质量报告。
6. 返回稳定 `materialId`。
7. 将 `accepted` 素材标记为可复用，将其他结果标记为待修复。

### N10. 分镜采用

项目和分镜只保存：

```ts
interface ShotMaterialReference {
  materialId: string;
  materialRevision: string;
  generationExecutionId?: string;
  adoptedAt: string;
}
```

项目删除、任务归档或分镜改写不得删除素材本体。素材删除需要独立执行引用检查。

## 5. “我的素材 > 我的生成”信息架构

建议采用虚拟集合，不使用物理目录字段作为来源真相。

```text
我的素材
├── 我的上传
├── 我的生成
│   ├── 全部
│   ├── 数字人
│   ├── 产品场景
│   ├── 概念画面
│   ├── 动态图文
│   └── 完整成片
├── 企业素材
└── 公共素材
```

“我的生成”的判断依据：

```ts
material.scope === 'own'
&& material.generation?.pipelineId
&& material.generation?.inputFingerprint
```

不得通过 `folder === 'upload'`、`folder === 'presenter'` 或文件名判断是否为生成素材。

### 5.1 默认显示规则

- `quality.state=accepted`：显示在“可复用”。
- `quality.state=repair_required`：显示在“待修复”，不能自动采用。
- `quality.state=failed`：默认折叠，可查看失败原因并从失败节点返工。
- 首帧、遮罩、动作参考、质量抽帧等中间件默认不显示在素材网格，只在素材详情的生成血缘中查看。

### 5.2 素材筛选字段

- 媒体类型：视频、图片、音频。
- 生成类型：数字人、产品场景、概念画面、动态图文、完整成片。
- 产品。
- 人物。
- 镜头功能。
- 场景。
- 语言。
- 画幅。
- 质量状态。
- 供应商和模型。
- 来源任务和项目。

## 6. 统一素材数据模型

在现有 Material 记录上增加：

```ts
interface GeneratedMaterialMetadata {
  generation: {
    pipelineId: ProductionPipelineId;
    assetGenerationKind: 'digital_human' | 'product_scene' | 'concept_visual' | 'motion_graphics' | 'final_video';
    pipelineVersion: string;
    executionId: string;
    provider: string;
    model: string;
    providerTaskId?: string;
    idempotencyKey: string;
    inputFingerprint: string;
    promptOrSpecHash: string;
    inputMaterialIds: string[];
    estimatedCostCny?: number;
    actualCostCny?: number;
  };
  lineage: {
    sourceTaskId?: string;
    sourceProjectId?: string;
    sourceAssemblyId?: string;
    sourceShotId?: string;
  };
  quality: GeneratedAssetQuality;
  reuse: {
    eligible: boolean;
    reason: string;
    usageCount: number;
    lastUsedAt?: string;
  };
  rightsScope: string;
}
```

现有 `sourceType` 暂时保留用于兼容，但新功能不得再以它作为唯一业务判断依据。

## 7. 现有实现盘点

| 能力 | 代码位置 | 当前状态 | 缺口 |
| --- | --- | --- | --- |
| 数字人三管道路由 | `src/lib/digitalHumanPlan.ts` | 已有明确映射 | 需要在所有入口统一展示管道名称 |
| 管道 3 首帧与背景锁定 | `server/lib/photoTalkingFirstFrames.ts` | 已接通 | 需要再次执行真实验收样片 |
| 非数字人素材供给路由 | `server/starter198/socialContentAssetSupplyExecution.ts` | 已接通 | 产品模型仍表现为内部策略集合 |
| 产品场景生成 | `server/starter198/socialContentSeedanceProductScene.ts` | 已接通 Seedream/Seedance 与质量检查 | 生成物未统一进入“我的生成” |
| 概念辅助画面 | `server/starter198/socialContentAiVisualAdapter.ts` | 已接通 Seedance/Veo/千问适配器 | 运行依赖环境配置；生成物未统一归档 |
| 动态图文 | 社媒生产现有本地适配器 | 基本可执行 | 缺少统一生成元数据和复用入口 |
| 工作台 AIGC 视频 | `server/routes/studio.ts` | 已写入素材库 | 当前混入 `upload` 文件夹 |
| 社媒逐镜生成物 | `server/starter198/socialContentProductionExecution.ts` | 可进入当次渲染 | 部分素材仍依赖临时工作区，不能稳定跨任务复用 |
| 社媒最终成片 | `server/starter198/socialContentFiles.ts` | 已进入任务文件记录 | 与统一素材库尚未完全合并 |

## 8. 需要修改的模块

### 8.1 新增

- `server/lib/generatedAssetArchive.ts`
  - 统一持久化、去重、质量状态和血缘记录。
- `shared/contracts/generatedMaterial.ts`
  - 定义生成素材元数据、质量状态和管线枚举。
- `src/lib/generatedMaterial.ts`
  - 前端分类、筛选和可复用状态投影。
- “我的生成”列表和素材详情中的生成血缘面板。

### 8.2 改造

- `server/routes/studio.ts`
  - `createGeneratedVideoMaterial` 与 `createGeneratedImageMaterial` 改为调用统一归档服务。
- `server/starter198/socialContentProductionExecution.ts`
  - `executeSocialAssetSupplyPlan` 返回的生成素材在离开临时工作区前统一归档。
- `server/starter198/socialContentHeyGenBridge.ts`
  - 数字人口播输出也写入统一生成元数据，同时继续显示在数字人筛选中。
- `server/lib/sentenceReplicationProduction.ts`
  - 管道 3 成片与逐句可复用镜头写入统一归档服务。
- `src/components/AiCreateStudio.tsx`
  - 新增“我的生成”入口，使用生成元数据筛选，不再把生成内容混在“本地素材”。
- 素材库列表接口
  - 增加 `origin=generated`、`assetGenerationKind`、`qualityState` 等过滤参数。

## 9. 迁移方案

### 阶段 1：统一契约和只读分类

1. 新增生成素材契约和前端分类函数。
2. 根据旧 `sourceType` 回填只读推断：
   - `heygen`、`digital-human-*`、`viral-sentence-replication` → `digital_human`
   - `ai-seedance` 且带产品场景规格 → `product_scene`
   - `ai-seedance`、`seedance-generated`、`qwen-*`、`gemini-*` → `concept_visual`
   - 本地图文生成结果 → `motion_graphics`
3. 增加“我的生成”虚拟集合，不移动原文件。

### 阶段 2：统一新生成物归档

1. 上线 `GeneratedAssetArchiveService`。
2. 创作工作台、社媒生成、数字人生成全部调用统一服务。
3. 新生成物必须有 `generation`、`quality` 和 `lineage`。
4. 分镜采用统一改为保存 `materialId`。

### 阶段 3：历史数据回填

1. 按租户扫描旧素材。
2. 以 `contentSha256` 去重。
3. 从现有 `sourceType`、`provenance` 和任务记录回填生成元数据。
4. 无法证明来源或质量的历史素材标记为 `repair_required`，不自动标记为可复用。

### 阶段 4：清理旧判断

1. 删除依赖文件夹名判断生成来源的业务逻辑。
2. `sourceType` 降级为兼容展示字段。
3. 所有新入口只读取统一生成元数据。

## 10. 幂等、成本与失败恢复

每次生成使用：

```text
idempotencyKey = hash(
  tenantId
  + pipelineId
  + assetGenerationKind
  + inputFingerprint
  + provider
  + model
)
```

恢复规则：

- 已有 `accepted + archived`：直接返回原 `materialId`。
- 已有 `provider_pending`：查询原供应商任务。
- 已有 `uncertain`：只允许核对原任务。
- 已有 `repair_required`：允许从失败质量节点定点返工。
- 供应商明确拒绝创建任务：可以按已计划顺序切换下一适配器。
- 供应商超时或提交结果未知：禁止切换供应商重新扣费。

## 11. API 建议

### 创建生成计划

```http
POST /api/generated-assets/plans
```

请求包含业务意图和输入素材，响应包含：

- `pipelineId`
- `assetGenerationKind`
- `inputFingerprint`
- `providerCandidates`
- `estimatedCostCny`
- `preflightIssues`

### 执行生成

```http
POST /api/generated-assets/executions
```

需要显式费用上限和请求幂等标识。

### 查询执行状态

```http
GET /api/generated-assets/executions/:id
```

### 查询“我的生成”

```http
GET /api/materials?origin=generated&assetGenerationKind=product_scene&qualityState=accepted
```

### 定点返工

```http
POST /api/generated-assets/executions/:id/repair
```

请求必须指出失败检查项，默认复用已通过节点和已付费结果。

## 12. 验收标准

### 产品验收

- 用户可以明确选择或看到系统选择的是数字人、产品场景、概念画面还是动态图文。
- “我的素材 > 我的生成”可以查看所有生成结果及来源。
- 一个生成素材可以被多个项目和多个分镜引用。
- 删除项目不会删除素材。
- 用户可以按产品、人物、生成类型和质量状态筛选。

### 技术验收

- 所有新生成结果在临时工作区释放前完成持久化。
- 所有记录具有内容哈希、输入指纹、幂等标识和生成血缘。
- 相同输入重复执行不会重复创建付费任务。
- `uncertain` 任务不会自动重新提交。
- 自动质量不通过的素材不会自动采用。
- 租户之间不能读取或引用彼此素材。
- 历史素材迁移不会移动或覆盖原始文件。

### 管线验收

- 数字人管道 1、2、3 分别完成一条真实端到端样片。
- 产品场景生成完成一条带产品身份和文字检查的真实样片。
- 概念辅助画面完成图片和视频各一条真实样片。
- 动态图文完成一条带事实引用的真实样片。
- 上述所有合格结果均自动出现在“我的生成”，并能在新项目中直接复用。

## 13. 发布顺序

建议按以下顺序实施：

1. 统一生成素材契约和只读分类。
2. 上线“我的生成”虚拟集合。
3. 实现统一归档服务。
4. 接入创作工作台的非数字人 AIGC 输出。
5. 接入社媒产品场景、概念画面和动态图文输出。
6. 接入数字人三条管道输出。
7. 回填历史素材并完成跨项目复用验收。
8. 删除旧文件夹来源判断和临时兼容逻辑。

这一顺序允许先提供可见的产品入口，再逐步收口写入路径，同时避免一次性迁移影响现有生产任务。

## 14. 与当前代码版本的兼容性

### 14.1 总体结论

本设计与当前代码的业务架构兼容度较高，可以增量实施，不需要推翻现有数字人、Storyboard AIGC 或社媒生产流程。但文档中的统一归档服务、统一生成 API 和统一生成元数据属于目标态，目前不能作为已经存在的接口直接调用。

按层评估：

| 层级 | 兼容度 | 说明 |
| --- | --- | --- |
| 产品管线划分 | 高 | 当前代码已经区分数字人、产品场景、概念画面、动态图文、素材剪辑和代拍清单，只是入口和名称尚未统一 |
| 供应商执行与幂等 | 高 | 现有数字人、Storyboard AIGC 和社媒生成均已有任务 ID、输入指纹、预算或幂等控制，可由统一执行记录进行投影 |
| 产品场景生成规格 | 高 | `SocialProductSceneReplicationSpec` 已覆盖产品身份、场景、机位和容差，无需重新设计 |
| 真实性边界 | 高 | `SocialShotTruthBoundary` 已在社媒生产中执行，可扩展为其他入口的统一语义 |
| 自动质量检查 | 中高 | 各管线已有质量报告，但字段、状态和值域不同，需要适配层，不应立即替换原模型 |
| 素材数据模型 | 中高 | 本地和云素材均允许写入 `sourceType` 与 `provenance`，适合增量增加 `generation`、`lineage`、`quality` 和 `reuse` |
| 统一状态机 | 中 | 当前存在多套状态值，应先建立统一投影视图，不能直接修改所有原状态字段 |
| “我的生成”入口 | 中 | 已有 AI 来源识别函数和可持久化素材，但创作工作台尚无统一入口，社媒逐镜生成物也未全部归档 |
| 统一归档服务 | 低 | `GeneratedAssetArchiveService` 尚不存在，是本设计的主要新增模块 |
| 统一生成 API | 低 | `/api/generated-assets/*` 尚不存在，应在归档服务稳定后增加，不应阻塞现有路由 |

### 14.2 可以直接复用的当前实现

以下模块可作为新架构的现有实现，不需要重写：

- `src/lib/digitalHumanPlan.ts`
  - 已有数字人管道 1、2、3 的明确映射。
- `server/starter198/socialContentAssetSupplyExecution.ts`
  - 已有逐镜策略路由、供应商适配器执行、回退控制和真实性边界检查。
- `shared/contracts/socialContentReplication.ts`
  - 已定义 `SocialShotSourceStrategy`、`SocialShotTruthBoundary` 和 `SocialProductSceneReplicationSpec`。
- `server/starter198/socialContentSeedanceProductScene.ts`
  - 已实现产品参考输入、Seedream/Seedance 执行和产品身份质量检查。
- `server/starter198/socialContentAiVisualAdapter.ts`
  - 已实现非证明性概念画面的受控提示词、费用上限、供应商回退和幂等键。
- `server/routes/studio.ts`
  - Storyboard AIGC 已保存输入指纹、供应商信息、项目/分镜血缘、质量报告和素材记录。
- `server/lib/materialLibrary.ts` 与 `server/lib/cloudMaterials.ts`
  - 已支持租户素材持久化、内容哈希、来源字段和扩展 `provenance`。
- `server/starter198/socialContentFiles.ts`
  - 已支持任务文件持久化、内容哈希校验、租户隔离及任务上传素材写入素材库。

### 14.3 必须调整的设计项

#### 避免 `generationMode` 命名冲突

当前创作工作台已经使用：

```ts
generationMode: 'material' | 'product' | 'clone'
```

该字段表示脚本/创作模式，不表示生成素材类别。因此本文目标模型中的字段改名为：

```ts
assetGenerationKind:
  | 'digital_human'
  | 'product_scene'
  | 'concept_visual'
  | 'motion_graphics'
  | 'final_video';
```

后续实现不得复用现有 `generationMode` 承载素材分类。

#### 统一状态机先做投影，不替换原状态

当前已有状态包括：

- 数字人执行：`submitting/pending/completed/failed/uncertain/cancelled`
- 逐句镜头：`pending/ready/failed`
- 社媒任务：执行阶段与 artifact 状态
- Storyboard AIGC：预算账本阶段、供应商任务状态和质量报告状态

第一阶段新增 `projectGeneratedAssetState(existingRecord)`，将原状态投影为文档中的统一状态。原记录继续保留其当前字段，待所有调用方迁移完成后再考虑收口。

#### 质量模型先做适配，不替换现有报告

当前已有 `SentenceCueQuality`、`StoryboardQaReport`、产品场景质量结果和社媒成片检查。`GeneratedAssetQuality` 应作为统一摘要，同时在 `rawReport` 或 `provenance` 中保留原始质量报告，避免丢失管线特有证据。

#### 归档服务需要兼容已有持久化结果

统一归档服务必须支持两种调用方式：

1. `archiveNewMedia`：把临时文件持久化并创建素材记录。
2. `attachExistingMaterial`：为已经入库的数字人或 Storyboard 素材补充统一生成元数据，不能复制文件或创建重复素材。

这可以避免 HeyGen、管道 3 和 `createGeneratedVideoMaterial` 已经完成持久化后再次上传。

### 14.4 当前尚未闭环的位置

- 创作工作台生成视频已经进入素材库，但通常使用 `folder: upload`，生成图片可能进入 `folder: product`，产品上看不到统一“我的生成”。
- `materialAssetTabOf` 已能通过 `sourceType` 识别部分 AI 素材，但目前不是创作工作台素材文件夹的统一数据源。
- 社媒数字人口播已经写入素材库；社媒产品场景和概念画面的逐镜结果仍可能只存在于临时渲染工作区。
- 社媒最终成片进入任务 artifact 文件记录，但没有保证同步成为统一可复用素材。
- `ConceptVisualSpec`、`MotionGraphicsSpec`、`GeneratedAssetArchiveService` 和 `/api/generated-assets/*` 尚未实现。
- 当前没有统一的素材引用计数和删除前引用检查。

### 14.5 推荐的兼容实施顺序

1. 新增共享生成元数据契约，使用 `assetGenerationKind`。
2. 实现旧素材到统一元数据的纯函数投影，不写数据库。
3. 在现有素材列表上增加“我的生成”虚拟集合。
4. 实现 `attachExistingMaterial`，为已持久化的新生成物补充元数据。
5. 实现 `archiveNewMedia`，首先接管社媒临时逐镜生成物。
6. 将社媒最终成片同步到统一素材库。
7. 最后增加统一生成 API；现有 `/studio/*`、数字人和社媒路由在迁移期继续可用。

采用该顺序时，第一至第五步均为增量改造，不需要修改已有供应商调用协议，也不会改变数字人管道 3 的生成质量逻辑。
