# 灵枢 AI 产品开发文档

> 文档类型：产品定义、功能规格、技术架构、开发规范与验收基线
> 文档状态：当前代码快照说明，可持续维护
> 审查日期：2026-09-10
> 代码分支：`前端大修改终极版`
> 基线提交：`eb21a0b3583155fe30d1a9cf8cd809df02555ae3`（`feat: 统一全局视觉系统`）
> 仓库：`lingshu-ai-cloud/lingshu_AI`
> 面向环境：本地开发、`lingshu.site` 测试环境、Docker Compose 自托管环境

## 1. 文档说明

### 1.1 目的

本文档以当前分支的实际源码、路由、数据迁移、测试脚本和部署配置为依据，用于统一以下工作：

- 产品经理理解当前产品边界、用户角色、业务闭环和真实交付状态。
- 设计师理解信息架构、视觉令牌、交互原则和响应式约束。
- 前端、后端和测试人员按同一套领域模型、状态机、API 与验收标准协作。
- 运维人员完成环境配置、部署、监控、备份、升级和故障排查。
- 后续开发者区分“已经实现”“依赖外部配置”“实验/遗留代码”“建议规划”，避免把界面、模拟数据或旧方案文档误当作线上能力。

### 1.2 事实优先级

当资料出现冲突时，按以下顺序判断：

1. 当前基线提交中的运行代码和数据库迁移。
2. 当前基线提交中的自动化测试与契约测试。
3. 本文档。
4. `docs/` 下的专项方案、验收报告和部署手册。
5. 截图、历史 README、演示数据与口头描述。

本文档不是 `main` 分支的滚动说明。切换分支、合并功能或发布新版本后，应同步更新“基线提交、能力状态、数据迁移和验收结果”。

### 1.3 能力状态标记

| 标记 | 含义 | 判断标准 |
| --- | --- | --- |
| 已实现 | 当前代码已装配到产品主路径 | 有可达页面或服务入口、真实处理逻辑及明确状态 |
| 条件可用 | 实现存在，但依赖环境、租户授权或第三方能力 | 缺少 Key、OAuth、Worker 或开关时必须显示不可用/阻塞 |
| 实验/遗留 | 代码存在但未进入正式主路径，或仍返回未实现 | 不得对外宣称为正式能力 |
| 建议 | 本文提出的后续产品或工程工作 | 尚不能作为验收结论 |

### 1.4 本次静态核验结果

| 检查项 | 结果 |
| --- | --- |
| TypeScript 严格类型检查 | 通过：`tsc --noEmit`，退出码 0 |
| Vite 生产构建 | 通过：2,895 个模块，退出码 0 |
| 构建提示 | `vite.config.ts` 使用 `__dirname`，Vite 后续原生配置加载器会要求改为 `import.meta.dirname` |
| 完整回归测试 | 本次文档任务未重新执行 `npm test`；发布前仍须执行第 18 节测试矩阵 |
| 线上第三方联调 | 本次未验证真实 OAuth、发布、消息、数字人和爬虫凭据，不据此承诺线上成功率 |

## 2. 产品定义

### 2.1 产品定位

灵枢 AI 是面向中国制造企业全球增长团队的经营工作台。它把企业知识、行业洞察、社媒内容生产、跨平台发布、客户对话、订单记录和周期复盘连接为可追溯工作流，并通过数字员工在明确授权和人工审批边界内推进任务。

产品核心不是“多生成几段文案”，而是让每个增长动作都具备：

- 明确的业务目标、负责人和执行周期。
- 可追溯的事实来源、输入资产和版本。
- 可观察的任务状态、失败原因和外部回执。
- 对发布、批量触达、报价与商业承诺的人工控制。
- 从内容到客户、再到订单与复盘的闭环证据。

### 2.2 目标客户

- 需要运营 YouTube、TikTok、Instagram、Facebook 等海外渠道的制造企业。
- 需要统一管理产品资料、素材、FAQ、销售话术和社媒策略的外贸团队。
- 需要承接 WhatsApp 等渠道询盘，并降低重复客服工作的销售/客服团队。
- 需要查看业务过程、审批关键动作和衡量交付质量的企业负责人。
- 需要为多个客户租户配置账号、凭据、订阅与运维协助的灵枢交付团队。

### 2.3 主要价值

1. **事实一致**：内容、回复与智能体决策优先使用企业确认资料，不把模型猜测写成事实。
2. **全链路执行**：从趋势采集、内容生产到发布、询盘承接、客户跟进和复盘形成任务链。
3. **人机边界清晰**：低风险读取、分析、草稿可自动推进；对外发布、批量触达和商业承诺必须审批。
4. **过程可观察**：任务事件、运行状态、浏览器执行画面、平台回执、人工纠偏均可追踪。
5. **租户隔离**：企业数据、账号、素材、记忆、工作流和凭据按租户归属。

### 2.4 当前非目标

以下内容不应被表述为当前产品承诺：

- 不是完整 ERP、支付或财务系统；订单页登记业务结果，不执行真实收付款。
- 不保证内容发布必然带来询盘或成交，发布成功与市场验证成功是不同状态。
- 不允许 AI 自主报价、承诺折扣、付款条件、交期、认证或售后责任。
- Agent 浏览器监控不是面向任意网站的通用浏览器机器人。
- `PluginsPage.tsx` 不是已交付插件市场；正式入口是“集成中心”。
- 第三方平台没有凭据、权限或可用 Worker 时，不以演示状态代替真实成功。

### 2.5 建议的产品指标

以下是后续产品运营建议，不是当前代码中的计费承诺：

| 层级 | 建议指标 | 口径 |
| --- | --- | --- |
| 北极星 | 每租户每周完成的“有真实回执增长闭环”数量 | 目标建立到复盘完成，关键外部动作具平台回执 |
| 激活 | 首次配置后 7 天内完成企业资料、账号授权和首个执行包审批的租户比例 | 三个条件全部满足 |
| 内容 | 通过质量门并获人工批准的内容包数量 | 不把脚本或渲染中状态计入 |
| 发布 | 有平台 ID 或明确 `published` 回执的发布成功率 | 排期成功不等于发布成功 |
| 客户 | 有来源、阶段和下一步动作的有效客户比例 | 未知来源单列 |
| 转化 | 有人工确认订单结果的客户占比 | 不由 AI 推断成交 |
| 自动化 | 无人工接管且有证据完成的低风险任务比例 | 审批等待不算失败 |
| 质量 | 退回、重试、人工纠偏、外部失败和数据缺口率 | 按模块和供应商拆分 |

## 3. 用户、租户与权限

### 3.1 核心对象

- **租户（Tenant）**：一家客户企业，是业务数据与凭据的一级隔离边界。
- **用户（User）**：属于一个租户，拥有组织角色。
- **平台管理员**：灵枢内部运营/交付身份，由专用管理员账号或管理员订阅资格识别，不等同于普通租户的 `admin` 角色。
- **支持会话**：平台管理员经授权临时进入客户租户；会话带请求 ID、管理员身份和到期时间，并在界面持续提示。
- **试用账号**：受试用时长、Token、生成、渲染和视频任务额度限制。

### 3.2 组织角色

| 角色 | 中文定位 | 主要权限 |
| --- | --- | --- |
| `super_admin` | 企业超级管理员 | 全部普通业务页面；管理员工、角色与组织权限 |
| `admin` | 企业管理员 | 全部普通业务页面；不能创建第二个超级管理员 |
| `social_operator` | 社媒运营 | 首页、智能经营、监控、社媒运营和定时任务 |
| `customer_service` | 客服/销售 | 首页、智能经营、监控、客户会话、订单和定时任务 |

### 3.3 页面权限矩阵

| 页面域 | super_admin | admin | social_operator | customer_service |
| --- | :---: | :---: | :---: | :---: |
| 首页 / 经营概览 | ✓ | ✓ | ✓ | ✓ |
| 智能经营 / 运行监控 | ✓ | ✓ | ✓ | ✓ |
| 灵感、内容创作、脚本、账号 | ✓ | ✓ | ✓ | — |
| 我的会话、订单 | ✓ | ✓ | — | ✓ |
| 企业知识库、智能体记忆 | ✓ | ✓ | — | — |
| 定时任务 | ✓ | ✓ | ✓ | ✓ |
| 集成中心 | ✓ | ✓ | — | — |
| 组织与权限（查看） | ✓ | ✓ | — | — |
| 组织成员增删与改角色 | ✓ | — | — | — |
| 平台账号总控 / 客户运维 | 需额外平台管理员资格 | 需额外平台管理员资格 | — | — |

注意：

- 前端白名单只负责导航与体验，安全边界必须由后端逐接口校验。
- 当前前端对平台管理员资格和组织角色存在两套判断；发布前要验证“菜单可见但页面被重定向”的组合。
- `traffic`、`channels`、`youtube` 等页面 ID 保留兼容入口，但当前导航主要使用聚合后的页面。

## 4. 产品信息架构

### 4.1 公共入口

| 路径 | 用途 | 鉴权 |
| --- | --- | --- |
| `/` | 登录后工作台；未登录显示登录/注册页 | 业务页需要 |
| `/register?invite=...` | 邀请码注册 | 邀请码校验 |
| `/assist/:token` | 客户协助入口 | 短期协助令牌 |
| `/privacy` | 隐私政策 | 无 |
| `/data-deletion` | 数据删除说明 | 无 |
| `/admin/delivery` | 客户运维直达入口 | 平台管理员 |

产品没有引入 React Router。`src/App.tsx` 通过页面状态、`?page`、History API、`localStorage.ow_page` 和 `lingshu:navigate` 事件总线完成导航；`retention` 会统一迁移到 `conversion`。

### 4.2 主导航

| 导航分组 | 当前页面 | 内部 Page ID / 组件 | 说明 |
| --- | --- | --- | --- |
| 独立首页 | 首页 | `strategy` / `StrategyPage` | 经营概览与策略工作台 |
| 经营管理 | 智能经营 | `digitalEmployees` / `DigitalEmployeePage` | 数字员工目标、执行、交付与复盘 |
| 社媒运营 | 灵感中心 | `socialInspiration` / `TrafficPage` | 趋势、爆款、素材和拍摄清单 |
| 社媒运营 | 内容创作 | `smartAssets` / `TrafficPage` + `AiCreateStudio` | AI 创作、我的创作、内容发布 |
| 社媒运营 | 脚本库 | `scriptLibrary` / `ScriptLibraryPage` | 真分析脚本与 Studio 草稿 |
| 社媒运营 | 账号管理 | `accountManagement` / `TrafficPage` | 授权账号、数据和评论 |
| 客户管理 | 我的会话 | `conversion` / `ConversionPage` | 客户列表、对话、画像和跟进 |
| 客户管理 | 订单管理 | `orders` / `OrderManagementPage` | 订单状态、凭证、售后和统计 |
| 智能体管理 | 企业知识库 | `enterprise` / `EnterprisePage` | 企业事实、产品、FAQ 与客服规则 |
| 智能体管理 | 智能体记忆 | `agentMemory` / `AgentMemoryPage` | 风格、客户、策略记忆治理 |
| 智能体管理 | 定时任务 | `scheduled` / `ScheduledPage` | 调度、执行结果、PDF 与交接 |
| 系统设置 | 集成中心 | `plugins` / `IntegrationsPage` | OAuth 应用和平台连接 |
| 系统设置 | 组织与权限 | `organizationPermissions` | 员工与角色 |
| 平台管理员 | 账号总控 | `admin` / `AdminDashboard` | 租户、试用、订阅与协助 |
| 平台管理员 | 客户运维 | `adminDelivery` / `AdminDeliveryPage` | 平台凭据、交付 SOP 与验收 |
| 上下文入口 | 实时生产监控 | `agentMonitor` / `AgentMonitorPage` | 从智能经营进入，不单独占主导航 |

`TrafficPage` 被多个入口复用，通过初始视图和标题区分；`DigitalEmployeePage`、内容创作和监控采用保活装配，避免离开页面后丢失执行现场。

## 5. 关键业务流程

### 5.1 总体闭环

~~~mermaid
flowchart LR
    A[企业事实与产品资料] --> B[经营目标与执行包]
    B --> C[趋势/竞品采集]
    C --> D[爆款与素材分析]
    D --> E[脚本/配音/分镜/数字人/渲染]
    E --> F{人工审批}
    F -->|通过| G[发布日历与平台发布]
    F -->|退回| E
    G --> H[平台回执与互动]
    H --> I[客户归因与分层]
    I --> J[逐客跟进草稿]
    J --> K{批量触达审批}
    K -->|通过| L[按时区发送与回执]
    K -->|退回| J
    L --> M[人工接管/订单结果]
    M --> N[真实数据周复盘]
    N --> B
~~~

“完成”的判断必须来自对应事实源：

- 内容生产完成：Studio 项目及渲染/质量状态。
- 发布完成：平台帖子 ID 或账号级 `publishResults=published`。
- 消息发送完成：提供方消息 ID；送达、已读和失败继续由 Webhook 回写。
- 成交完成：人工登记的订单生命周期与凭证。
- 周复盘完成：真实业务快照；缺失数据明确显示为缺口。

### 5.2 新租户激活

1. 平台交付人员创建租户并生成一次性邀请码。
2. 客户通过邀请链接注册首个超级管理员账号。
3. 客户补齐公司、行业、主要业务、目标市场、核心客户、产品和素材。
4. 交付人员或客户配置平台应用并完成 OAuth/WhatsApp 授权。
5. 系统评估运营成熟度：起步验证、体系运营或协同优化。
6. 客户设置内容、客户跟进、复盘频率和审批负责人。
7. 系统推荐首个执行包，客户确认范围后审批上线。
8. 首周只按已授权能力运行；缺少凭据或资料的节点保持阻塞并给出修复入口。

验收底线：

- 邀请码不可重复使用。
- 企业资料和平台凭据按租户隔离。
- 未确认真实发布/消息授权时，不得产生外部动作。
- 任何缺失条件不得伪装成“已完成”。

### 5.3 内容生产与发布

1. 从“素材生成”“爆款复刻”“产品生成”选择生产路径。
2. 选择企业产品、目标市场、语言、平台、主题、时长和表达方式。
3. 数字员工或人工生成/编辑脚本，并保存版本。
4. 生成分镜、配音、字幕对齐、素材匹配、封面和 BGM。
5. 可选纯素材、纯数字人口播或数字人+素材混剪。
6. 执行事实、品牌、素材覆盖、脚本泄漏、语言和画面质量检查。
7. 渲染并人工预览当前版本。
8. 创建发布草稿，选择账号、平台文案、时间、首评和 WhatsApp 追踪。
9. 完成发布预检和人工审批。
10. 由定时发布器或立即发布逻辑执行，保存账号级平台回执。

关键约束：

- 爆款复刻必须有 `exact analysis` 和完整时间线，不能只凭标题/封面复刻。
- 产品生成默认先产出脚本；没有合格素材时不能假装成片完成。
- 修改作品、文案、账号或排期后，原审批失效并需重新审批。
- 排期状态、作品完成状态和平台发布状态必须分开。
- 多语言产品契约支持英语、中文、西班牙语、法语、德语、葡萄牙语、阿拉伯语、印尼语、越南语、日语、韩语、俄语和意大利语；实际可用性仍取决于模型与 TTS 提供方。

### 5.4 客户承接与订单

1. 平台评论、私信或 WhatsApp 消息进入客户视图。
2. 系统写入来源、客户阶段、意向信号、BANT、语言、时区和历史消息。
3. AI 基于已确认企业知识和客户上下文生成回复草稿。
4. 草稿展示置信度、证据、风险边界与转人工原因。
5. 低风险回复可由人工确认发送；符合严格自动客服条件时可有限自动发送。
6. 高价值商机、报价、付款、交付、认证、争议和能力边界强制转人工。
7. 批量跟进先冻结客群，再逐客生成草稿、校验 24 小时窗口/模板/时区，最后审批。
8. 发送后保存提供方回执；失败回滚，部分发送不盲目整批重试。
9. 成交与售后由人工登记到订单，系统记录状态变更证据。

### 5.5 平台交付与支持

1. 管理员在账号总控查看试用、正式客户、用量和订阅状态。
2. 客户运维按 Meta、Google、TikTok、企微等平台 SOP 配置租户级应用。
3. 完成回调地址、Webhook、Token 类型、长期授权和连通性测试。
4. 对客户生成一次性邀请码或限时协助链接。
5. 支持会话进入客户空间时持续显示身份和到期信息。
6. 完成验收后记录清单，不把未配置或只保存草稿视为“已交付”。

## 6. 功能规格

### 6.1 登录、注册与试用

状态：已实现。

- 登录支持邮箱和密码，网络失败会有限重试并显示“服务正在启动”提示。
- 注册必须提供管理员邀请码；公司名由邀请信息带入。
- 密码至少 8 位；支持显示/隐藏。
- 登录态启动时通过 `/auth/me` 恢复，并每 5 分钟刷新。
- 试用账号支持到期阻断及 AI 对话、生成、渲染、视频、Token 等额度。
- 支持修改密码、退出登录和首次引导完成标记。
- 登录/注册共用固定表单锚点；左侧品牌图在桌面约占 30%，移动端改为上下布局。

当前实现将 Bearer Token 存在 `localStorage`。这是现状，不是安全最佳实践；安全加固见第 20 节。

### 6.2 首页与经营策略

状态：已实现。

- “经营概览”按社媒、询盘和 CRM 聚合账号、视频、客户与订单快照。
- “策略工作台”支持与策略 Agent 对话并带入真实业务上下文。
- 顾问回答可携带来源链接。
- 数据缺失时不估算表现；应明确提示待补数据。

边界：

- `AgentWorkspace` 中的 Token 是本地会话近似估算，不是服务端实时计费数据。
- 部分 Agent 运行状态属于界面状态，不能直接用作后台 SLA 证明。

### 6.3 智能经营（数字员工）

状态：已实现，外部执行为条件可用。

页面提供“今日、实时、总览、复盘”等业务视图，并支持：

- 入职配置、成熟度评估和授权边界。
- 周目标创建、执行包推荐、编辑、保存与审批。
- 业务线、平台、日期和任务状态筛选。
- SSE 实时事件、运行进度和阻塞原因。
- 暂停、恢复、取消、纠偏、重试、跳过、人工完成。
- 任务证据提交、人工接管、返回 Agent。
- 跳转企业、定时任务、灵感、内容创作、发布和客户页面，并保留返回上下文。
- 客群快照、跟进批次、发布审批和周复盘。

对外发布、批量客户触达和商业承诺在服务端规范化配置中固定要求人工审批，不能通过前端参数关闭。

### 6.4 实时生产监控

状态：已实现，真实浏览器执行需环境开关。

- 按任务状态和业务组过滤运行任务。
- 显示任务事件、等待检查、失败原因和业务工作区入口。
- 可查看隔离 Chromium 上下文的连续截图和真实指针事件。
- SSE 断开后重连，并以 15 秒轮询补偿。
- 支持全屏聚焦和返回生产任务。
- 浏览器读取会话使用临时只读身份，不复用用户日常浏览器资料。

该能力只服务灵枢现有业务页面的执行与观察，不是任意第三方网页自动化平台。

### 6.5 灵感中心

状态：已实现；外部采集为条件可用。

- 提供灵感、素材库和拍摄清单。
- 支持真实抓取结果或用户上传内容、服务端分页、搜索和筛选。
- 支持关键词、竞品账号、平台、内容形式和时间范围。
- 以账号相对基线而非固定绝对阈值判断表现。
- 图片分析要求可见证据；视频支持全片 `exact analysis`。
- 支持纠错、暂停、重新分析、下载、收藏、编辑和删除。
- 素材可自动分段与分类；缺镜可进入补拍或 Seedance 生成。
- 缺失浏览、互动等指标时明确为空，不伪造估算。

### 6.6 内容创作与作品库

状态：已实现；AI、TTS、数字人和视频生成依赖配置。

支持视频与海报两类产物。

视频工作流：

1. 设置：起点、产品、主题、市场、语言、平台、时长、呈现方式。
2. 分镜与声音：脚本、翻译、配音、字幕、数字人和逐镜来源。
3. 素材：上传、分析、分类、固定、匹配与缺口处理。
4. 封面与预览：封面、BGM、渲染、质量门、人工审核。
5. 发布：生成发布草稿并转入发布队列。

主要能力：

- 产品脚本、爆款结构迁移、素材导向脚本。
- 多语言翻译、批量翻译、TTS、音色样本、字幕转写与对齐。
- 素材上传、分段、分类、固定、查询与删除。
- AI 图片/视频、Seedance、封面、Facebook 海报和线索内容包。
- BGM 曲库、旁白、故事板检查与渲染质量检查。
- 项目自动保存、版本、变体批次、作品导出和发布效果记录。
- 约 10 秒自动保存；保活挂载避免切页丢失工作现场。

### 6.7 数字人

状态：条件可用。

- 正式新建任务使用 HeyGen；代码保留历史私有推理服务读取/兼容能力。
- 支持人物列表、能力检查、创建、查询、重试、取消和人工确认。
- 每租户最多 2 个并发生成任务。
- 必须选择人物并确认使用权；商业权利状态必须为已清晰授权。
- HeyGen 完成后先做文件和画面检查，再进入人工质量复核。
- 用户必须预览并确认人物、口型与声音，才转为完成并进入素材库。
- 私有推理服务输出还会检查允许域名、视频类型、110MB 上限和商业质量门。
- 数字人片段可作为纯数字人口播，也可在混剪中逐镜选择数字人或具体素材。

当前数字人任务索引保存在 `data/digital-human-jobs.json`，不适合多实例并发部署，需按第 20 节迁移。

### 6.8 脚本库

状态：已实现。

- 只纳入具备 `exact analysis` 和完整脚本的真实分析视频。
- 同时展示 Studio 项目草稿。
- 支持筛选、详情、继续创作、复制、删除和从爆款进入创作。
- 翻译会创建新脚本记录，不覆盖原语言版本。

### 6.9 账号管理、评论和社媒数据

状态：YouTube、Meta、TikTok 账号核心链路条件可用。

- 账号概览展示已授权账号、基础资料、内容和分析数据。
- 评论管理支持账号、平台、意向和处理状态过滤。
- 支持真实同步、最多 50 条批量译中、AI 意图分析和三版回复。
- 回复必须可编辑并由用户确认；批量结果区分成功和失败。
- YouTube 支持频道资料、视频、评论、Analytics、Super Chat 和同步。
- Facebook/Instagram/TikTok 支持 OAuth、账号资料、视频、洞察和上传。

边界：

- TikTok 评论读取和评论回复需要额外平台权限，当前接口会返回 501。
- “添加 WhatsApp 后自动进入客户”在账号活动组件中只是说明，不是直接创建客户的操作。

### 6.10 内容发布

状态：已实现；实际发布取决于账号授权和平台权限。

- 选择作品或上传本地成片。
- 支持多平台、多账号和账号时区。
- 生成通用文案并进行平台适配。
- 支持立即、弹性和定时发布。
- 支持首评、WhatsApp 追踪链接、发布预检、人工审批。
- 发布队列状态至少区分草稿、就绪、发布中、已排期、成功、部分失败和失败。
- 支持失败重试、帖子发布尝试查询和回执对账。
- 发布日历与通用“定时任务”是不同领域，不可混为同一状态。
- 个性化最佳发布时间需要 `posting_stats` 积累至少 50 个样本；不足时使用通用策略。

### 6.11 我的会话

状态：已实现；WhatsApp 真实收发取决于 Meta 配置。

- 视图包含收件箱、线索、成交、沉默 30 天和沉默 60 天。
- 支持客户列表、对话、画像三栏；窄屏改为单面板。
- 客户具来源、阶段、意向分、意向信号、BANT、SPIN 阶段、语言、时区、订单和跟进信息。
- AI 草稿包含置信度、知识证据、安全边界、策略建议和转人工理由。
- 支持翻译、人工编辑、发送前撤销、提供方状态和失败回滚。
- 页面可见时客户数据约每 30 秒刷新。
- WhatsApp 24 小时窗口外必须使用合规模板。
- 自动客服启用前需要 3 天观察、明确授权和至少 5 条已批准 FAQ；只有高置信、低风险场景可自动发送。

强制人工场景包括：

- 价格、折扣、MOQ、付款方式、账期、交期和运费。
- 认证、质量争议、售后责任和企业能力边界。
- 高价值商机、低真实性或风险等级 L4。
- 知识库缺失、证据冲突或模型不确定。

### 6.12 订单管理

状态：已实现，属于业务记录系统。

- 状态：待付款、已付款、生产中、已发货、已完成、退款、已取消。
- 合法状态迁移由共享领域逻辑限制。
- 付款和退款状态必须附证据，且仅登记线下结果。
- 支持售后开启与关闭，并保留历史。
- 支持 GMV、AOV、利润、待处理、退款等指标与图表。
- 支持 CSV 导入/导出。
- 只有待处理、未绑定客户且无审计记录的订单可以删除。

### 6.13 企业知识库

状态：已实现。

- 企业资料：公司、行业、市场、产品、优势、限制和素材。
- 社媒策略：目标市场、目标人群、平台、主题、语气和发布策略。
- 智能客服规范：报价边界、FAQ、销售风格、接待、通知与转人工规则。
- 支持产品表导入、产品素材、订单 CSV、知识补全、FAQ 结构化和行业包。
- 支持从真实对话提炼销售风格。
- 支持产品 API Key 创建/轮换及批量产品 API。

企业资料是内容和客户 Agent 的事实源；AI 推断内容必须与人工确认事实分层。

### 6.14 智能体记忆

状态：已实现。

- 内容/风格证据：记录原草稿、最终发送、修改、证据来源和学习范围。
- 客户记忆：记录客户事实、置信度、冲突、过期、确认和替代关系。
- 策略记忆：候选、启用、暂停、归档、版本、灰度比例和回滚。
- 模型检查与重新学习。
- 审计日志、租户备份和恢复。
- 企业风格和客户私有记忆明确分域；历史高胜率内容只能学习风格，不得复制旧客户事实。

### 6.15 定时任务

状态：已实现；不同任务依赖不同外部能力。

- 模板覆盖社媒关键词/竞品/趋势采集、汇率日报、市场周报、CRM 唤醒和节日触达。
- 支持周期、日期、北京时间、启停、立即执行、删除和重跑。
- 支持视频统计、业务动态、执行结果、业务页面交接和 PDF 导出。
- 页面约每 5 秒轮询状态。
- 调度任务会写入 `scheduled_tasks`，同时保留本地 `data/tasks.json` 镜像/兼容数据。

部分“去互动页处理”按钮只更新本地结果提示，不代表已执行外部回复。

### 6.16 集成中心

状态：专用平台连接已实现；通用集成协议部分为实验/未完成。

- 租户可保存 Google、Meta、TikTok 应用配置。
- 支持 YouTube、Instagram、Facebook、TikTok 和 WhatsApp 连接状态。
- 提供 OAuth 回调地址和 Meta Webhook 地址。
- 平台状态可区分顾问配置中、等待客户授权、导入历史、已连接和需要处理。
- 断开配置时会清理相关租户账号连接。

必须使用专用路由完成真实连接、同步与发布。统一的
`/platform-integrations/:provider/connect`、`sync`、`publish` 当前返回 501，不得当作已实现。

### 6.17 组织与权限

状态：已实现。

- 所有企业管理员可查看组织成员和角色说明。
- 只有 `super_admin` 可新增员工、修改角色或删除员工。
- 不允许创建第二个 `super_admin`，也不允许把普通员工提升为 `super_admin`。
- 员工始终归属当前租户。

### 6.18 平台后台

状态：已实现，限平台管理员。

账号总控：

- 查看试用与正式租户、订阅、用量、功能和行业聚合。
- 刷新演示数据、试用转正式、进入协助会话。
- 约每 10 秒刷新可见数据。

客户运维：

- 按 Meta、Google、TikTok、企微等平台展示交付 SOP。
- 管理租户级 App ID、Secret、Token、回调、Webhook 和验证状态。
- 执行连通性测试、长期 Token 检查和交付完成确认。
- 生成一次性邀请码与约 24 小时协助链接。
- 未保存草稿离页时提示。

### 6.19 全局助手

状态：已实现。

- 使用 Zustand 管理策略、内容、客户、留存四类线程。
- 注入当前页面、企业事实和业务对象上下文。
- 服务端恢复/保存助手线程，支持 SSE 流式回答。
- 支持来源、动作建议、语音和可拖拽位置。
- 可触发业务页面导航和任务启动。

`App.tsx` 仍保留一套基于 `ow_convs` 的旧会话模型，当前主流程基本由 `GlobalAssistant` 与 Zustand 承担；旧模型应在确认无调用后清理。

## 7. 数字员工领域模型

### 7.1 配置模型

每个租户的数字员工配置至少包含：

| 配置域 | 关键字段 |
| --- | --- |
| 企业事实 | 企业名称、行业、主要业务、目标市场、核心客户、重点产品 |
| 运营阶段 | 起步验证、体系运营、协同优化及证据化问卷 |
| 自主模式 | `suggest`、`collaborate`、`managed`、`automatic` |
| 工作流 | 定时社媒、爆款裂变、产品内容、素材内容、内容发布、客户分层、批量跟进 |
| 节奏 | 社媒采集、客户跟进、周复盘规则 |
| 发布目标 | 平台、账号 ID、账号名称、时区 |
| 团队 | 经营、行业、内容、客户四类 Agent |
| 授权 | 真实发布、真实客户消息、生成视觉素材 |
| 审批 | 计划激活、范围变化、事实声明、内容发布、批量跟进、商业承诺 |
| 连续周期策略 | 新客户进入、漏发补偿、周期重叠、发布时区 |

必填项为企业名称、行业、主要业务、目标市场、核心客户和审批负责人。配置激活时保存不可变版本，并绑定事实版本、策略版本和有效运行策略。

### 7.2 自主模式

| 模式 | 内部读取/分析 | 创建草稿 | 创建排期 | 外部发布/发送 |
| --- | :---: | :---: | :---: | :---: |
| `suggest` | ✓ | — | — | — |
| `collaborate` | ✓ | ✓ | — | — |
| `managed` | ✓ | ✓ | ✓ | — |
| `automatic` | ✓ | ✓ | ✓ | 仍受强制审批红线 |

`automatic` 只表示运行策略具备外部动作资格，不代表可以绕过审批。当前规范会把内容发布、批量跟进和商业承诺审批固定为 `true`，因此这三类动作仍需负责人批准。

### 7.3 周目标

周目标包含：

- 业务线：全链路经营、内容增长、客户转化。
- 内容平台：Facebook、Instagram、TikTok、YouTube。
- 目标名称、目标说明、指标、基线、目标值、单位、起止日期、范围和限制。
- 可选的逐条视频制作计划：路径、产品、主题、语言、时长、平台、素材、参考内容、呈现方式、人物、声音和审核要求。

目标值必须高于基线；视频计划必须满足对应路径的必填条件。

### 7.4 标准任务图

系统按业务线和已启用工作流裁剪任务，完整目录最多包含 16 个节点：

| 顺序 | Task Key | 任务 | 事实源 / 完成依据 | 外部影响 |
| ---: | --- | --- | --- | --- |
| 1 | `context_readiness` | 盘点企业、产品与授权边界 | 企业资料与平台账号 | 无 |
| 2 | `goal_decomposition` | 拆解目标与成功标准 | `weekly_plans` | 无 |
| 3 | `scheduled_source_collection` | 建立社媒定时采集 | `scheduled_tasks` + `crawl_jobs` | 排期 |
| 4 | `viral_analysis` | 分析并筛选可用爆款 | `trend_videos.aiAnalysis` | 无 |
| 5 | `content_mode_routing` | 选择内容生产路径 | `content_batch_plans.orders` | 草稿 |
| 6 | `content_production` | 脚本、素材与成片生产 | `studio_projects` + 渲染任务 | 草稿 |
| 7 | `content_quality_gate` | 内容质量门 | Studio 质量状态 | 无 |
| 8 | `content_release_approval` | 审批作品、文案、账号和时间 | `approval_requests` | 发布审批 |
| 9 | `publishing_calendar` | 写入发布日历 | `posts.stats.status=scheduled` | 排期 |
| 10 | `platform_publish` | 等待真实平台回执 | 平台 ID + `publishResults` | 发布 |
| 11 | `customer_attribution` | 回流互动与客户来源 | `whatsapp_customers.sourcePostId` | 无 |
| 12 | `customer_segmentation` | 冻结客户分层快照 | `customer_segments` + members | 无 |
| 13 | `followup_batch_draft` | 生成逐客跟进草稿 | `followup_batches` + items | 草稿 |
| 14 | `followup_batch_approval` | 审批批量跟进 | 审批与批次当前版本 | 发送审批 |
| 15 | `followup_dispatch` | 按客户时区执行跟进 | item 状态 + 提供方回执 | 发送 |
| 16 | `weekly_review` | 真实周复盘与下周草案 | `weekly_reviews` + 业务快照 | 无 |

依赖关系会按所选业务线重写。例如没有爆款裂变时，内容生产仍可从产品或素材路径继续；周复盘依赖本周期最后一个实际启用的内容/客户节点。

### 7.5 状态机

周目标状态：

`draft → pending_approval → active → paused/completed/cancelled`

任务状态：

| 状态 | 含义 | 用户可执行动作 |
| --- | --- | --- |
| `pending` | 依赖未满足或等待调度 | 查看依赖 |
| `running` | 正在执行 | 查看事件、必要时暂停 |
| `waiting_external` | 等待外部数据、凭据、Worker 或人工材料 | 修复条件、重新对账 |
| `waiting_approval` | 等待当前版本审批 | 通过或退回 |
| `handed_off` | 已由人工接管 | 人工处理、返回 Agent |
| `skipped` | 经授权跳过 | 查看原因 |
| `succeeded` | 有完成证据 | 查看产物和回执 |
| `failed` | 已失败 | 纠偏或重试 |
| `cancelled` | 随运行取消 | 只读查看 |

运行控制：

- 暂停后，后台编排和客户发送都不得继续。
- 取消后不再自动恢复。
- 人工接管时保存快照、接管人和开始时间。
- 纠偏会增加任务纠偏版本，并使受影响的下游审批失效。
- 重试必须复用可幂等的业务引用，避免重复发布、重复发送和重复创建订单。
- 手工完成必须提交可审计证据，不能仅改一个前端状态。

### 7.6 事件与实时更新

- `run_events` 为追加式事件流，包含租户、运行、任务、序号、类型、级别、摘要、负载和发生时间。
- 同一运行的事件追加使用本地队列串行化，数据库对 `tenant_id + run_id + sequence` 建唯一索引。
- `GET /digital-employees/runs/:runId/stream` 提供运行 SSE。
- 浏览器执行另有任务级 `browser-stream` 和 UI 事件上报。
- 前端 SSE 断开时使用重连和有限轮询恢复，不应重复触发业务操作。

### 7.7 跟进批次安全链

跟进执行顺序：

1. 冻结客户分层和排除原因。
2. 为每个客户生成独立草稿、语言、时区、发送模式和内容哈希。
3. 审批当前批次版本；草稿变化会导致审批失效。
4. 只读预检租户授权、数字员工状态、客户状态、号码、频率、风险、模板和时间窗口。
5. 逐客领取任务，记录幂等键和发送尝试。
6. 只有 Meta 返回消息 ID 后计为已发送。
7. Webhook 更新送达、已读或失败。
8. 进程中断且结果不明时标记阻塞，禁止自动重发。

默认后台扫描关闭，`FOLLOWUP_WORKER_ENABLED=true` 后才以约 15 秒间隔执行。生产环境只能有一个主动发送 Worker，或者引入数据库租约/队列实现分布式互斥。

## 8. 技术架构

### 8.1 总体架构

~~~mermaid
flowchart TB
    subgraph Client[客户端]
      Web[React SPA / 浏览器]
      Desktop[Electron + 本机 FFmpeg]
    end

    subgraph App[Node.js 应用进程]
      Express[Express API 与静态站点]
      Domain[业务领域服务]
      Workers[调度/发布/采集兜底/跟进/数字员工 Worker]
      SSE[SSE 与浏览器监控]
    end

    subgraph Data[数据与文件]
      PB[(PocketBase)]
      Local[(data/ 本地兼容状态)]
      Object[(S3 兼容对象存储)]
    end

    subgraph Providers[外部能力]
      Models[Qwen / Gemini / Seedance / MiniMax]
      Avatar[HeyGen]
      Social[Meta / WhatsApp / TikTok / YouTube]
      Crawl[yt-dlp / Apify / Mac Worker]
    end

    Web --> Express
    Desktop --> Express
    Express --> Domain
    Express --> SSE
    Domain --> PB
    Domain --> Local
    Domain --> Object
    Domain --> Models
    Domain --> Avatar
    Domain --> Social
    Workers --> PB
    Workers --> Providers
    Desktop -->|渲染 manifest| Domain
~~~

### 8.2 技术栈

| 层 | 技术 |
| --- | --- |
| Web | React 19、TypeScript 5.8、Vite 8、Tailwind CSS 4 |
| UI/状态 | Motion / Framer Motion、Lucide、Recharts、Zustand、dnd-kit |
| API | Express 4、Node.js 22、Axios / Fetch、`node-cron` |
| 数据 | PocketBase HTTP API、后端中立 `DataStore` 接口 |
| 文件 | PocketBase 文件字段、本地受控目录、S3 兼容对象存储 |
| AI | OpenAI 兼容客户端、DashScope/Qwen、Google GenAI、Seedance、MiniMax |
| 数字人 | HeyGen；保留历史私有数字人服务兼容 |
| 抓取 | yt-dlp、Apify、本地 Mac Worker |
| 视频 | `ffmpeg-static`、Electron 本机渲染、服务端渲染接口 |
| 部署 | Docker、Docker Compose、Caddy、PocketBase |
| 测试 | TypeScript 可执行契约/单元/集成测试、Electron 渲染测试 |

### 8.3 前端架构

- `src/App.tsx` 是页面装配、鉴权恢复、页面权限、深链和错误边界入口。
- 大业务页面使用 `lazy` 动态导入，减少首次登录后的解析开销。
- `Layout.tsx` 负责侧栏、账户、额度、协助态和全局右侧区域。
- `GlobalAssistant` 使用 Zustand 保存四类 Agent 线程并与服务端同步。
- 生产任务通过 History API、`sessionStorage` 和自定义事件在业务页面间交接。
- `DigitalEmployeePage`、`TrafficPage` 等复杂工作台使用保活，开发时必须防止隐藏页面继续执行昂贵副作用。
- 大部分领域状态由页面和服务端 API 管理；本地偏好使用 `localStorage`，一次性交接使用 `sessionStorage`。

当前没有 URL 级路由库。新增可分享页面时必须同时处理：

- 直接打开、刷新、前进/后退。
- 页面权限与未授权回退。
- 文档标题、页面主标题焦点和屏幕阅读器播报。
- 生产任务的返回栈与一次性交接数据清理。

### 8.4 后端架构

- 单一 Express 进程提供 API、静态站点、私有媒体代理和多数后台 Worker。
- 路由只依赖 `DataStore`/`AuthProvider`，当前实现切到 `pbStore`/`pbAuth`。
- PocketBase 客户端不使用 SDK，而是通过 Fetch 调用管理和记录 API。
- 生产服务启动依赖 PocketBase 版本化 migration；部署入口在 migration 后单独运行只写账号记录的幂等工作台管理员 bootstrap，不执行全量 `setup:pb`，应用副本也不在运行时补表。
- Webhook 请求保留原始请求体，便于签名校验。
- JSON 请求上限为 120MB，主要为管理上传兼容；普通接口仍应限制业务字段。
- SSE 和 TTS 响应跳过压缩，避免缓冲或长调用阻塞。
- 生产环境静态资源带长期不可变缓存，`index.html` 禁止缓存。

### 8.5 后台进程

应用启动时初始化：

- 通用定时任务调度器。
- 内容定时发布器。
- 爬虫运维队列和 PocketBase 视频回填。
- 本地爬虫离线后的云端接管。
- 租户平台 Token 监控。
- WhatsApp 历史记录维护。
- 数字员工逐客跟进 Worker。
- 数字员工运行编排器。
- 数字人已提交任务的恢复轮询。

每个 Worker 都必须具备开关、并发上限、幂等、失败状态、退避和可观察日志；外部写操作还必须具备租户授权与审批证据。

## 9. API 设计

### 9.1 约定

- 主业务前缀：`/api/overseas`。
- 产品导入 API：`/api/v1/products`。
- Webhook：`/api/webhooks`。
- 鉴权：`Authorization: Bearer <token>`；媒体元素通过 HttpOnly 同站资源会话或短期签名 URL。
- 租户 ID 从认证身份取得，禁止信任客户端提交的租户 ID。
- 写接口必须校验对象确属当前租户。
- 列表接口应支持分页；大对象避免无界 `perPage`。
- `409` 用于版本、前置条件和状态冲突；`402` 用于订阅/试用限制；`501` 仅表示明确未实现的外部操作。
- SSE 响应使用 `text/event-stream`，不得被 gzip 缓冲。

### 9.2 路由域总表

| 基础路径 | 主要能力 | 鉴权/状态 |
| --- | --- | --- |
| `/api/overseas/health` | 服务健康、Demo、能力锁 | 公共，只返回非敏感状态 |
| `/api/overseas/auth` | 邀请、注册、登录、会话、密码、员工、退出 | 公共+登录态 |
| `/api/overseas/admin` | 租户、试用转正、协助、告警、OAuth、交付 | 平台管理员 |
| `/api/overseas/support-access` | 客户默认协助授权 | 登录态 |
| `/api/assist-links` | 限时协助链接启动/完成 | 令牌/管理员 |
| `/api/overseas/strategy` | 策略生成与持久化 | 登录态 |
| `/api/overseas/agents` | 各 Agent 对话、主动建议、客户回复草稿 | 登录态 |
| `/api/overseas/assistant-threads` | 助手线程恢复与保存 | 登录态 |
| `/api/overseas/agent-memory` | 记忆、证据、策略、审计、备份恢复 | 登录态 |
| `/api/overseas/videos` | 采集、导入、分析、素材下载、纠错、运维队列 | 登录态 |
| `/api/overseas/trends` | 每日趋势推送、选择与查询 | 登录态 |
| `/api/overseas/competitor-accounts` | 竞品账号 CRUD 与采集 | 登录态 |
| `/api/overseas/competitor` | 兼容的竞品分析与创意洞察 | 遗留接口 |
| `/api/overseas/scripts` | 生成、查询、编辑、翻译、删除 | 登录态 |
| `/api/overseas/studio` | Studio 全流程、素材、TTS、数字人、渲染、项目 | 登录态；部分受订阅门禁 |
| `/api/overseas/assets` | 从脚本生成并查询资产 | 登录态 |
| `/api/overseas/publishing` | 日历、排期、发布、文案适配、回执恢复 | 登录态 |
| `/api/overseas/social` | TikTok/Meta OAuth、账号、洞察、内容、上传 | 登录态；回调公共 |
| `/api/overseas/youtube` | OAuth、频道、视频、评论、分析、上传、同步 | 登录态；回调公共 |
| `/api/overseas/social-engagement` | 评论翻译、分析、回复、转客户 | 登录态 |
| `/api/overseas/social-metrics` | 社媒汇总与趋势 | 登录态 |
| `/api/oauth/whatsapp` | Embedded Signup 配置和 code 交换 | 登录态 |
| `/api/webhooks` | Meta 与企微验证/事件 | 签名或验证 Token |
| `/api/overseas/customers` | 客户、建议、知识缺口、夜间简报、Outbox | 登录态 |
| `/api/overseas/enterprise` | 企业资料、产品、FAQ、客服、订单、资产 | 登录态 |
| `/api/v1/products` | 外部产品批量写入、查询、删除 | 租户 API Key |
| `/api/overseas/scheduler` | 任务 CRUD、启停、执行、业务结果、PDF | 登录态 |
| `/api/overseas/crawl-worker` | 云端任务、Worker 领取、心跳、完成 | 用户或 Worker Token |
| `/api/overseas/digital-employees` | 配置、目标、运行、审批、交接、复盘、SSE | 登录态 |
| `/api/overseas/digital-employees/followup` | WhatsApp 跟进模板与逐客模板配置 | 登录态 |
| `/api/overseas/platform-integrations` | 应用配置和统一提供方状态 | 部分接口仅骨架 |
| `/api/overseas/channels` / `/api/channels` | 通用消息渠道兼容路由 | 混合，需逐步收口 |
| `/api/overseas/plugins` | 旧插件配置、汇率、翻译 | 实验/兼容 |
| `/api/overseas/copywriting` / `translation` | 旧文案与翻译入口 | 遗留接口 |

### 9.3 关键数字员工接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /digital-employees/overview` | 当前配置、目标、运行、任务、审批与快照 |
| `POST /digital-employees/onboarding/complete` | 激活配置并保存版本 |
| `GET /digital-employees/planning-options` | 规划选项 |
| `POST /digital-employees/goals` | 创建目标与草案 |
| `POST /digital-employees/goals/:goalId/package/recommend` | 推荐执行包 |
| `PUT /digital-employees/goals/:goalId/package` | 保存执行包 |
| `POST /digital-employees/goals/:goalId/approve` | 审批并启动 |
| `GET /digital-employees/runs/:runId/stream` | 运行事件 SSE |
| `POST /digital-employees/runs/:runId/reconcile` | 依据真实业务数据对账 |
| `POST /digital-employees/approvals/:approvalId/decide` | 当前版本审批 |
| `POST /digital-employees/tasks/:taskId/corrections` | 提交纠偏 |
| `POST /digital-employees/tasks/:taskId/retry` | 重试 |
| `POST /digital-employees/tasks/:taskId/skip` | 跳过 |
| `POST /digital-employees/tasks/:taskId/complete` | 带证据人工完成 |
| `POST /digital-employees/tasks/:taskId/handoff` | 人工接管 |
| `POST /digital-employees/tasks/:taskId/return-to-agent` | 返回 Agent |
| `POST /digital-employees/runs/:runId/pause` | 暂停 |
| `POST /digital-employees/runs/:runId/resume` | 恢复 |
| `POST /digital-employees/runs/:runId/cancel` | 取消 |
| `POST /digital-employees/runs/:runId/customer-segments` | 冻结客群 |
| `POST /digital-employees/customer-segments/:id/followup-batches` | 创建跟进批次 |
| `GET /digital-employees/followup-batches/:id/dispatch-preflight` | 只读发送预检 |
| `POST /digital-employees/followup-batches/:id/dispatch` | 授权后执行 |
| `POST /digital-employees/runs/:runId/reviews/generate` | 生成真实周复盘 |
| `GET/PUT/POST /digital-employees/review-todos...` | 复盘待办与派发 |

### 9.4 Studio 接口分组

Studio 路由规模较大，按职责维护：

| 分组 | 代表接口 |
| --- | --- |
| 脚本与洞察 | `/script`、`/insight`、`/select`、`/translate`、`/translate/batch` |
| 视频与图像 | `/gemini-video`、`/covers`、`/fb-poster`、`/lead-content-package` |
| 分镜质量 | `/storyboard-quality-check`、`/transformations/assess` |
| 渲染 | `/render`、`/render/local`、`/render/open-output` |
| 数字人 | `/digital-human/capabilities`、`/avatars`、`/jobs`、审批/重试/取消 |
| 素材 | `/materials`、文件上传、分段分析、分类、固定、修改、删除 |
| 语音 | `/tts/capabilities`、`/tts`、`/tts/batch`、对齐、转写、音色样本、旁白 |
| BGM | `/bgm` 查询、上传、删除 |
| 项目 | `/projects` 查询、创建、保存、删除 |
| 版本/变体 | `/video-versions`、`/variation-batches` |
| 发布效果 | `/publish-records`、推荐、追踪链接和表现 |

目前没有生成的 OpenAPI 规范。新增或修改公开接口时，应同步补充请求/响应 Schema、错误码和契约测试，并逐步产出机器可读 API 文档。

## 10. 数据模型与持久化

### 10.1 数据访问

业务路由依赖后端中立接口：

- `getById(collection, id)`
- `create(collection, data)`
- `update(collection, id, data)`
- `delete(collection, id)`
- `list(collection, query)`
- `verifyToken(authorization)`

当前实现是 PocketBase。非生产环境允许 PocketBase 失败时回退到 `data/local-store/*.json`；生产环境默认关闭本地认证回退。

需要注意：当前 `pbStore.list` 在远端返回 0 条时也会读取本地集合。开发数据与空集合判断可能互相影响，测试时应明确环境并清空对应本地数据。

### 10.2 核心集合

| 领域 | 主要集合 |
| --- | --- |
| 租户与用户 | `tenants`、`users`、`tenant_profiles`、`tenant_support_settings` |
| 平台与凭据 | `tenant_platform_apps`、`youtube_accounts`、`social_accounts`、`competitor_accounts` |
| 内容洞察 | `trend_videos`、`daily_trends`、`scripts`、`generated_assets`、`materials` |
| Studio | `studio_projects`、`content_batch_plans` |
| 发布与指标 | `posts`、`publishing_schedules`、`posting_stats`、`recycle_lists`、`social_metric_snapshots` |
| 客户 | `whatsapp_customers`、`whatsapp_interactions`、`social_comment_states` |
| 订单与产品 | `tenant_orders`、`tenant_api_keys` |
| 记忆 | `style_memory`、`customer_memory`、`response_strategy_memory`、`style_adoption_stats`、`agent_memory_audit` |
| 助手 | `assistant_threads` |
| 调度与采集 | `scheduled_tasks`、`crawl_jobs` |
| 审计与支持 | `audit_logs`、`assist_links`、`support_access_requests` |
| 数字员工配置 | `digital_employee_configs`、`digital_employee_config_versions` |
| 数字员工计划 | `weekly_goals`、`weekly_plans`、`workflow_runs`、`workflow_tasks` |
| 数字员工事件 | `run_events`、`approval_requests`、`handoff_sessions`、`workflow_corrections` |
| 数字员工客户 | `customer_segments`、`customer_segment_members`、`followup_batches`、`followup_batch_items` |
| 复盘 | `weekly_reviews`、`review_todo_boards` |

### 10.3 关键完整性规则

- 所有租户业务集合必须携带 `tenantId` 或 `tenant_id`，查询和写入必须校验当前身份。
- 目标、计划、运行、任务、审批和事件通过 ID 串成证据链。
- 配置版本、任务版本、纠偏版本和内容哈希用于判断旧审批是否失效。
- 运行事件序号、任务键、批次客户和幂等键具唯一索引。
- 客户分层保存纳入/排除原因和客户快照，后续客户变化不能重写历史批次口径。
- 跟进条目保存提供方 ID、原始回执、尝试次数、发送/送达/已读时间和最后错误。
- 订单付款/退款证据属于人工记录，不能从聊天内容自动伪造。

### 10.4 文件与对象存储

当前同时存在三类文件路径：

1. PocketBase 文件字段：趋势视频、封面、生产素材等。
2. `data/` 本地目录：媒体、BGM、TTS、音色样本、封面、临时分析、导出和兼容 JSON。
3. S3 兼容对象存储：通过 `OBJECT_STORAGE_*` 或 R2 兼容变量启用。

租户私有对象 Key 使用经过编码的租户标识；浏览器访问私有文件时通过：

- Bearer 认证后的媒体代理。
- 同站 HttpOnly 资源会话。
- 绑定租户、请求路径和过期时间的 HMAC 短期 URL。

私有媒体响应应使用 `Cache-Control: private, no-store`，并设置 `Vary: Cookie, Authorization`。

### 10.5 仍使用本地 JSON 的状态

当前部分能力仍使用本地 JSON 或同时维护本地镜像，例如：

- 数字人任务、Studio 变体、发布链接、BGM 和音色索引。
- 通用渠道、旧插件配置、社媒发布历史。
- 调度任务兼容文件和导出任务。
- 演示账号、额度、Seedance 预算、告警、OAuth 配置和支持访问兼容数据。

这些文件随 Docker 的 `./data:/app/data` 卷持久化，但不天然支持多实例一致性、事务、数据库查询和故障转移。生产扩容前必须迁移到 PocketBase/关系数据库或正式队列。

### 10.6 数据命名兼容

历史集合混用 `tenantId/tenant_id`、`createdAt/created_at` 等命名。当前适配代码可以工作，但新增领域应统一使用 snake_case 持久化字段，并在 API 边界显式映射，避免继续扩大兼容成本。

## 11. 外部能力与配置

### 11.1 集成成熟度

| 能力 | 当前代码状态 | 上线前置条件 |
| --- | --- | --- |
| DashScope / Qwen | 条件可用；用于文本、脚本、视觉分析等 | Key、模型名、网络连通性 |
| Google Gemini | 条件可用；文本、视觉和可选视频能力 | Key、地区网络、模型与功能开关 |
| Seedance / ModelArk | 条件可用；补镜与视频生成 | Key、开关、模型、租户月预算 |
| MiniMax TTS / 音色克隆 | 条件可用 | Key、端点、模型；音色使用权 |
| Piper / XTTS | 本地可选降级 | 本机二进制和对应语言模型 |
| HeyGen | 条件可用；当前正式数字人提供方 | 服务端 Key、人物可用、用户授权 |
| YouTube | 专用 OAuth、同步、分析、评论和上传链路已实现 | 租户 Google App、回调和平台审核 |
| Facebook / Instagram | 专用 Meta OAuth、账号、洞察、上传链路已实现 | 租户 Meta App、权限、长期 Token |
| TikTok | OAuth、账号与上传链路已实现 | TikTok App 与相应权限；评论能力仍受限 |
| WhatsApp Cloud API | Embedded Signup、历史导入、收发和 Webhook 已实现 | Meta 配置、号码、模板、永久 Token、真实发送授权 |
| Apify | 采集/下载兜底 | Token、Actor、配额和超时 |
| yt-dlp / Mac Worker | 本地采集已实现 | 本机运行环境、Worker Token、合法 Cookie 来源 |
| S3 兼容对象存储 | 已实现 | Endpoint、Bucket、Access Key；私有访问策略 |
| 飞书、钉钉、微信、企微、Telegram、Shopify | 存在适配器或交付配置代码 | 并非全部装配为正式端到端主流程，需逐项验收 |

统一 `platform-integrations/:provider/connect|sync|publish` 当前仍返回 501；正式社媒功能使用 YouTube、Social、WhatsApp 等专用路由。开发新平台时不应只修改统一状态页，而应提供实际授权、同步、执行、回执和断开链路。

### 11.2 环境变量分类

以下只列变量名称与用途，不记录任何真实值。

#### 应用与数据库

- `PORT`、`APP_DOMAIN`、`PUBLIC_BASE_URL`
- `PB_URL`、`PB_VERSION`、`PB_DATA_VOLUME_NAME`
- `PB_ADMIN_EMAIL`、`PB_ADMIN_PASSWORD`
- `WORKBENCH_ADMIN_EMAIL`、`WORKBENCH_ADMIN_PASSWORD`、`WORKBENCH_ADMIN_NAME`
- 本地可选：`PB_AUTO_START`、`PB_BIN`、`PB_DATA_DIR`、`LOCAL_STORE_DIR`

#### 安全与鉴权

- `SUBSCRIPTION_ENFORCED`、`DISABLE_LOCAL_AUTH_FALLBACK`
- `RENDER_TOKEN_SECRET`、`ASSET_ACCESS_SECRET`
- `SUPPORT_ACCESS_SECRET`、`OAUTH_STATE_SECRET`
- `TENANT_PLATFORM_APP_KEY`、`REGISTRATION_CREDENTIAL_KEY`
- `CRAWL_WORKER_TOKEN`、`AGENT_WORKER_TOKEN`
- `ADMIN_DASHBOARD_EMAILS`

#### 模型、脚本、语音与视频

- `OVERSEAS_LLM_BACKEND`、`STUDIO_SCRIPT_BACKEND`、`VIDEO_ANALYSIS_PROVIDER`
- `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`QWEN_TEXT_MODEL`、`QWEN_VL_MODEL`
- `GEMINI_API_KEY`、`GEMINI_MODEL`、`GEMINI_VIDEO_ENABLED`、`GEMINI_VIDEO_MODEL`
- `SEEDANCE_API_KEY`、`SEEDANCE_BASE_URL`、`SEEDANCE_MODEL`、`SEEDANCE_VIDEO_ENABLED`、`SEEDANCE_TENANT_MONTHLY_BUDGET_CNY`
- `MINIMAX_API_KEY`、`MINIMAX_BASE_URL`、`MINIMAX_TTS_MODEL` 及音色/语速/采样配置
- `PIPER_BIN`、`PIPER_MODEL_*`、`XTTS_BIN`、`XTTS_MODEL_NAME`
- `HEYGEN_API_KEY`
- 历史兼容：`DIGITAL_HUMAN_API_URL`、`DIGITAL_HUMAN_API_KEY`、`DIGITAL_HUMAN_PROVIDER`、`DIGITAL_HUMAN_OUTPUT_HOSTS`

#### 平台与 OAuth

- `YOUTUBE_OAUTH_CLIENT_ID`、`YOUTUBE_OAUTH_CLIENT_SECRET`
- `META_SOCIAL_APP_ID`、`META_SOCIAL_APP_SECRET`
- `TIKTOK_CLIENT_KEY`、`TIKTOK_CLIENT_SECRET`
- `ADVANCED_MANUAL_CONNECT_ENABLED`

#### 采集与 Worker

- `APIFY_TOKEN`、`APIFY_*_ACTOR`、`APIFY_*_FALLBACK_ENABLED`
- `APIFY_TIMEOUT_MS`、`APIFY_VIDEO_TIMEOUT_MS` 及平台/租户日额度
- `YT_DLP_COOKIE_FILES`
- `CRAWL_WORKER_SERVER_URL`、`CRAWL_WORKER_ID`、`CRAWL_WORKER_POLL_MS`
- `CRAWL_WORKER_CLOUD_FALLBACK_ENABLED` 及接管时限
- `FOLLOWUP_WORKER_ENABLED`、`FOLLOWUP_WORKER_INTERVAL_MS`、`FOLLOWUP_WORKER_MAX_ATTEMPTS`、`FOLLOWUP_WORKER_RECIPIENT_DELAY_MS`
- `DIGITAL_EMPLOYEE_RUNTIME_ENABLED`、`DIGITAL_EMPLOYEE_RUNTIME_INTERVAL_MS`、`DIGITAL_EMPLOYEE_RUNTIME_MAX_RUNS`
- `DIGITAL_EMPLOYEE_BROWSER_EXECUTION`、`AGENT_BROWSER_EXECUTABLE_PATH`、`AGENT_BROWSER_MAX_SESSIONS`、`AGENT_BROWSER_APP_ORIGIN`

#### 对象存储与备份

- `OBJECT_STORAGE_ENDPOINT`、`OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_ACCESS_KEY_ID`、`OBJECT_STORAGE_SECRET_ACCESS_KEY`、`OBJECT_STORAGE_BUCKET_NAME`
- R2 兼容：`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET_NAME`、`R2_PUBLIC_URL`
- `R2_BACKUP_PREFIX`、`R2_BACKUP_LOCAL_RETENTION_DAYS`
- `MATERIAL_SIGNED_URL_TTL_SECONDS`

#### Demo 与本地前端

- `DEMO_MODE`、`DEMO_ALLOWED_ACCOUNTS`、`DEMO_INVITE_CODE`
- `DEMO_DAILY_*_LIMIT`、`DEMO_TOTAL_TOKEN_LIMIT`、`DEMO_VIDEO_GENERATION_LIMIT`
- `DEV_PORT`、`DEV_API_TARGET`、`DEV_HMR_HOST`、`DEV_HMR_PORT`、`DEV_HMR_CLIENT_PORT`、`DISABLE_HMR`

### 11.3 配置原则

- 所有服务端密钥只放在未提交的环境文件或秘密管理系统中。
- 不使用 `VITE_*` 暴露服务端密钥；所有第三方调用经后端代理。
- 生产环境必须替换示例值，并禁止本地认证回退。
- 平台 App Secret、Access Token 等租户级凭据使用 `TENANT_PLATFORM_APP_KEY` 加密后持久化。
- HMAC 密钥按用途隔离，不能用同一个字符串同时签资源、渲染、OAuth 和支持会话。
- 环境启动时输出“能力是否配置”，但不得输出密钥、完整 Token 或客户消息。
- Key 轮换后需验证旧会话、Webhook、Worker 和计划任务的恢复行为。

## 12. 安全、隐私与租户隔离

### 12.1 当前安全控制

- 业务路由普遍通过 `requireAuth` 解析用户和租户。
- PocketBase Token 通过 `auth-refresh` 校验；支持会话使用独立签名身份。
- 非生产才允许 `local-demo.` Token 和本地 JSON 回退。
- 租户平台凭据支持加密存储，并向前端返回脱敏公共视图。
- OAuth state、资源访问、渲染和支持会话使用独立签名机制。
- 私有资产路径限制租户、请求路径和有效期。
- 数字员工浏览器会话使用隔离上下文和只读 Token。
- 对外消息有同步关键词规则和二次意图分类，拦截价格、折扣、付款、交期、合同和补偿承诺。
- 平台发布、批量跟进和商业承诺固定审批。
- Mock、fixture、placeholder、demo 等内部标记会被内容质量与验收逻辑识别，禁止进入真实成片或业务验收。

### 12.2 必须遵守的租户开发规则

1. 任何 API 都不能接收一个租户 ID 后直接信任它。
2. 读取单条记录时，必须同时验证记录租户与认证租户。
3. 列表查询必须把租户条件放入数据访问层，而不是只在前端过滤。
4. 对象存储 Key、导出目录、临时文件和队列键必须包含安全编码后的租户范围。
5. 跨租户平台管理员操作必须写审计日志，并携带管理员、目标租户、理由和到期时间。
6. 支持会话结束后恢复原身份，并清理临时令牌。
7. 自动化测试数据必须使用显式测试租户，不能混入真实经营统计。

### 12.3 当前风险与改进要求

| 风险 | 当前现状 | 要求 |
| --- | --- | --- |
| 浏览器 Token | Bearer Token 存 `localStorage` | 评估 HttpOnly Secure SameSite 会话、短期访问令牌和刷新令牌轮换 |
| 后端角色授权 | 多数业务路由有登录鉴权，但角色校验分散 | 为管理写操作建立统一 RBAC 中间件和否定用例 |
| 管理级数据访问 | PocketBase 由服务端管理令牌访问 | 强制租户 Repository，不允许新路由直接漏写租户过滤 |
| 本地 JSON | 多个状态仍在单机文件 | 迁移到事务性存储；迁移前只允许单实例 |
| Webhook | Meta/企微入口已存在 | 逐平台验证签名、重放保护、时间窗和幂等 |
| 大请求 | Express JSON 上限 120MB | 上传改为流式/分片，普通 JSON 路由设置更小业务限制 |
| 日志 | 多处记录外部错误 | 统一敏感字段脱敏，禁止记录正文、密钥和完整提供方响应 |
| 依赖与供应链 | Node、Python、yt-dlp、FFmpeg、多云 API | 固定版本、生成 SBOM、定期漏洞扫描和许可证审查 |

### 12.4 隐私与数据生命周期

- 客户对话、电话号码、订单、企业资料和平台 Token 均属于敏感租户数据。
- 产品应在客户授权后才导入历史 WhatsApp 消息；无授权时状态应为跳过或等待。
- 客户退订、黑名单或“不要联系”信号必须阻止自动触达。
- 客户记忆需要来源、置信度、确认、冲突、过期和替代关系。
- 导出文件、分析临时文件、语音和媒体缓存应设置保留期；删除租户时要覆盖数据库、对象存储、本地卷和备份生命周期。
- `/privacy` 和 `/data-deletion` 当前提供公开说明；若对外承诺自助删除，还需补齐可审计的真实执行流程。

## 13. 视觉系统、交互与可访问性

完整视觉规范见 [`design-system/lingshu-visual-system.md`](design-system/lingshu-visual-system.md)。

### 13.1 品牌与视觉令牌

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| Brand / Primary | `#117F51` | 主操作、当前状态、关键数据 |
| Brand Deep | `#173D31` | 标题和品牌文字 |
| Canvas | `#F6F8F5` | 全局工作区 |
| Surface | `#FFFFFF` | 面板、输入、弹层 |
| Border | `#DFE8E1` | 边框和分隔 |
| Muted | `#617169` | 次级说明 |
| Support Apricot | `#E98268` | 洞察、提醒、人工介入 |
| Support Soft | `#FFF3E7` | 暖色信息背景 |
| Support Action | `#A45A3B` | 需白字的暖色动作 |

视觉原则：

- 明亮、克制、可信；绿色为主色，暖杏为洞察和人工介入辅色。
- 信息先于装饰，一个页面只突出一个主操作。
- 用留白、细分隔和稳定栏宽建立层级，避免大面积渐变、发光和卡片墙。
- 常规控件圆角 6–8px，登录输入框 12px；常规面板不用重阴影和悬浮上移。
- 状态同时用文字和颜色表达。
- 水纹影像只用于品牌场景，不扩散到密集业务页。

### 13.2 页面骨架

- 侧栏由品牌、首页、分组导航和账户区组成；可收起到约 64px。
- 工作区使用统一标题、说明、底线标签和最大宽度。
- 同层指标优先使用连续数据带和竖向分隔，不使用独立浮卡墙。
- 洞察/人工介入使用单一暖杏信息区。
- Studio 在宽屏显示多面板工作台，窄于 `xl` 时切为单面板标签。
- 客服在宽屏显示客户/会话/画像三栏，窄于 `lg` 时切单面板。
- 登录页桌面双栏，左图约 30%；低于 768px 改为上下布局。
- 动效只解释状态变化，并尊重 `prefers-reduced-motion`。

### 13.3 交互规则

- 异步动作必须显示加载、成功、失败和可恢复入口。
- “保存”“审批”“发布”“发送”“删除”不能只依赖 Toast；关键结果要进入持久状态。
- 所有外部副作用必须有预检页面或确认区。
- 修改已审批内容后必须明确提示审批失效。
- 表格在移动端应转换为卡片/分组行或提供可见横向滚动提示。
- 全局助手拖拽位置属于用户偏好，响应式避让不能覆盖用户坐标。
- 页面深链打开后应提供明确返回路径，并保留上页筛选和滚动位置。

### 13.4 可访问性基线

已具备：

- 全局 `focus-visible` 样式和 reduced-motion 降级。
- 通用模态焦点循环、Escape、嵌套栈和关闭后焦点恢复 Hook。
- 导航 landmark、`aria-current`、折叠按钮名称。
- 登录表单标签、动态密码按钮名称和 `role=alert`。
- 部分标签页具 `tab/tabpanel` 关联。

待修复的 P1 问题：

1. `index.html` 当前声明 `lang="en"`，中文主界面应改为 `zh-CN`。
2. SPA 切页未统一更新 `document.title`、焦点主标题、路由播报，也没有“跳至主内容”链接。
3. 部分子页面在 `Layout` 的 `main` 内再次使用 `main`，造成嵌套 landmark。
4. 全局助手、额度弹层、邀请码弹窗和部分 Studio/发布弹窗未全部使用统一焦点陷阱。
5. 账户触发器声明 `aria-haspopup="menu"`，弹层却没有 `menu/menuitem` 语义。
6. 部分表单文字未与控件建立程序化标签关系。
7. 标签组缺少方向键与 roving tabindex；图表缺少数据表或文本等价物。
8. 侧栏只在初始化判断视口，窗口尺寸变化时不会自动响应；移动端仍保留约 64px 占位。
9. 尚未集成 axe/jest-axe 等自动可访问性测试。

## 14. 非功能需求

### 14.1 性能

当前优化：

- 大业务页面懒加载。
- 内容创作和数字员工保活，减少重新构建工作现场。
- `data/` 写入不触发 Vite 整页刷新。
- 生产静态资产长期缓存，入口 HTML 不缓存。
- 媒体支持 Range/代理与对象流式读取。

当前构建中较大的未压缩 Chunk 包括：

- 主入口约 419KB。
- `AiCreateStudio` 约 444KB。
- UI/Recharts 相关约 363KB。
- Emoji Picker 约 364KB。
- 产品表导入约 334KB。

建议预算：

- 首屏只加载认证、布局、首页必要代码。
- 非首屏业务 Chunk 单块目标小于 250KB（压缩前可按项目实际调整）。
- 表格和长列表必须分页或虚拟化。
- 图片生成缩略图，视频默认不预加载完整文件。
- 大上传改为直传对象存储或分片，不走 120MB base64 JSON。

### 14.2 可靠性

- 外部创建类接口必须携带幂等键。
- 发布和发送的“请求超时”不能直接当作失败重试，应先查询提供方回执。
- 定时 Worker 必须有单实例租约或数据库级领取机制。
- 任务恢复必须区分“尚未提交”“已提交待查询”“结果不明”。
- 审批绑定内容哈希和版本；任何业务输入变化都要重新审批。
- 本地文件写入使用临时文件再原子替换。
- 依赖服务异常时展示真实降级状态，不返回虚假成功。

### 14.3 可观察性

当前已有健康检查、任务事件、审计记录、提供方回执和进程日志。生产建议补充：

- 结构化 JSON 日志和统一请求/运行/任务关联 ID。
- API 延迟、错误率、队列长度、Worker 心跳、发布/消息成功率。
- 外部供应商按平台和错误码拆分的指标。
- OpenTelemetry trace 或等价链路追踪。
- 磁盘、内存、CPU、容器重启、证书和 Token 到期告警。
- 不含客户正文和密钥的错误样本。

### 14.4 容量与扩展

当前 Docker Compose 是单应用实例 + 单 PocketBase + Caddy，适合测试和早期小规模客户。扩容前必须：

- 把本地 JSON 状态迁到共享数据存储。
- 将调度、发布、爬虫、数字人轮询和跟进拆到有租约的 Worker。
- 媒体统一对象存储，应用节点只保留短期缓存。
- 对大模型、视频和平台 API 建立租户级并发、速率和预算控制。
- 评估 PocketBase 写并发与备份恢复目标，再决定是否迁移数据库。

### 14.5 国际化

- 产品 UI 当前以简体中文为主。
- 内容生产支持 13 种语言，但模型、TTS 和字体覆盖需逐语种验收。
- 日期、时区、数字和货币展示应基于租户/账号/客户设置。
- 阿拉伯语等 RTL 内容需单独验证脚本编辑、字幕、预览和导出。

## 15. 本地开发

### 15.1 前置环境

- Node.js 22。
- pnpm 11.19.0（由 `packageManager`/Corepack 固定，按 `pnpm-lock.yaml` 安装）。
- PocketBase 0.39.x 或 Docker。
- 需要本地视频处理时准备 FFmpeg/`ffmpeg-static`。
- 需要真实外部功能时准备对应服务端 Key 和 OAuth 应用。

### 15.2 初始化

~~~bash
git checkout 前端大修改终极版
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
~~~

只填写当前开发所需变量，不要复制生产密钥到仓库。

### 15.3 启动 PocketBase

推荐二选一：

1. 使用已有 PocketBase，设置 `PB_URL`、`PB_ADMIN_EMAIL`、`PB_ADMIN_PASSWORD`。
2. 本地设置 `PB_AUTO_START=true`、`PB_BIN` 和 `PB_DATA_DIR`，让服务在需要时启动。

本地 PocketBase 应从 `pb_migrations/` 执行版本化 migration。校验 migration：

~~~bash
pnpm run check:digital-employee-migrations
~~~

`pnpm run setup:pb` 仅保留给隔离开发库的人工修复，不属于正常启动或生产升级流程。

### 15.4 启动前后端

推荐本地端口：

~~~bash
# 终端 1；在 .env.local 中设置 PORT=8790
pnpm run dev:server

# 终端 2
pnpm run dev
~~~

打开 `http://127.0.0.1:5177/`，健康检查为 `http://127.0.0.1:8790/api/overseas/health`。

注意：Express 源码默认端口是 8788，而 Vite 默认代理目标是 8790。必须在 `.env.local` 设 `PORT=8790`，或把 `DEV_API_TARGET` 改为实际后端地址，两端必须一致。

### 15.5 本地最小配置

仅检查 UI 和本地业务状态时，至少配置：

- `PORT`
- `PB_URL`、`PB_ADMIN_EMAIL`、`PB_ADMIN_PASSWORD`
- 一个文本模型提供方，或接受相关 AI 功能明确不可用
- 本地随机的资源/渲染/注册签名密钥

不得在开发文档、截图、Issue、日志或提交中放入真实 GitHub Token、模型 Key、平台 Token、客户密码或 PocketBase 管理密码。

### 15.6 常见问题

| 现象 | 检查 |
| --- | --- |
| 登录提示服务启动中 | 后端端口、`DEV_API_TARGET`、健康检查、PocketBase |
| 登录后无数据 | 当前租户、PB 集合、非生产本地回退目录 |
| 页面能开但 AI 失败 | 对应模型 Key、网络/代理、模型名、预算和开关 |
| 视频/音频 401 | 资源会话、签名 URL、租户路径、反向代理 Cookie |
| OAuth 回调错误 | `PUBLIC_BASE_URL`、平台控制台回调、state 密钥 |
| 计划任务不执行 | 任务启用、Cron、应用时区、Worker 日志 |
| 发布或发送阻塞 | 租户授权、当前版本审批、平台 Token、账号/模板状态 |
| 数字人不可用 | `HEYGEN_API_KEY`、人物、使用权、并发上限 |
| Vite 构建警告 | 将 `vite.config.ts` 的 `__dirname` 迁移到 `import.meta.dirname` |

## 16. 部署与运维

### 16.1 生产拓扑

Docker Compose 启动：

| 服务 | 端口/暴露 | 数据 |
| --- | --- | --- |
| `app` | 容器 8788，宿主回环探针端口默认 18788 | `./data:/app/data` |
| `pocketbase` | 容器 8090，仅宿主 `127.0.0.1:8090` | `PB_DATA_VOLUME_NAME` 指定的外部命名卷 |
| `caddy` | 80/443 | 证书与配置卷 |

Caddy 使用 `APP_DOMAIN` 自动 HTTPS，并反向代理到 `app:8788`。PocketBase 不得直接暴露公网。

### 16.2 首次部署

~~~bash
cp .env.production.example .env.production
# 填写真实环境变量并检查权限，然后通过唯一部署入口启动
chmod 600 .env.production
bash deploy/start.sh
docker compose --env-file .env.production ps
curl -fsS https://lingshu.site/api/overseas/ready
~~~

不要用裸 `docker compose up` 代替 `deploy/start.sh`：部署入口负责命名 volume 校验、migration 后的管理员记录 bootstrap 和最终 readiness 门禁。

### 16.3 更新流程

1. 确认目标分支和提交 SHA。
2. 备份 PocketBase 数据、本地 `data/` 与对象存储关键索引。
3. 在 CI 或隔离环境完成类型检查、构建、迁移预检和回归测试。
4. 拉取代码并重建镜像。
5. 由 PocketBase 单一迁移器执行版本化 migration，确认 checksum 与向后兼容；应用副本不得运行时补表。
6. 启动应用并检查健康、登录、核心页面和 Worker。
7. 执行一个不产生真实外部动作的 Smoke Test。
8. 在明确授权的验收租户执行发布/消息等真实通道验收。
9. 观察错误率、队列、磁盘和外部回执。
10. 异常时使用已验证备份和上一镜像回滚；不得用破坏性 Git 命令覆盖业务数据。

### 16.4 备份与恢复

- 使用 `AGE_RECIPIENT=age1... ./deploy/backup.sh` 或 `AGE_RECIPIENT=age1... pnpm run backup:production-data`。
- 备份应包含 PocketBase SQLite/文件、本地 `data/` 必要状态和对象存储清单。
- 本地备份默认保留天数由 `R2_BACKUP_LOCAL_RETENTION_DAYS` 控制。
- 恢复使用 `AGE_IDENTITY=... pnpm run restore:production-data -- <backup.tar.gz.age>` 前，必须先在隔离目录演练；替换线上数据还需显式双重确认，并会先创建新的加密回滚备份。
- 每次发布前备份，至少每周做一次可恢复性验证。
- 备份也属于敏感数据，必须加密、限制访问和设定保留期。

### 16.5 生产监控

至少配置：

- `/api/overseas/health` 外部拨测。
- 磁盘 80% 预警、85% 严重告警。
- CPU、内存、Swap、容器重启和 OOM。
- PocketBase 健康、卷容量和备份时间。
- 发布、消息、爬虫和数字人任务积压。
- OAuth/平台 Token 临期与失效。
- TLS 证书和域名解析。
- 单个日志文件上限与保留数量。

服务器资源较小时，视频分析、生成、渲染和批量采集必须限并发；不要在 2GB 内存实例同时开启高并发视频任务。

### 16.6 环境文档说明

`docs/vps-deploy.md` 等旧部署文档包含历史 IP、仓库路径或早期流程，执行前必须以当前 `docker-compose.yml`、环境示例和本节为准。任何真实服务器地址、账号或密钥都不应继续写入通用开发文档。

## 17. 开发规范

### 17.1 分支与提交

- 一个分支聚焦一个可验收目标。
- 提交使用清晰前缀：`feat`、`fix`、`refactor`、`test`、`docs`、`chore`。
- 提交前检查 `git diff`，不得带入 `data/`、导出、日志、密钥和无关用户文件。
- 数据迁移与代码必须同一变更交付，并提供回滚或向前修复方案。
- 修改本文档时更新基线、状态和验收结论。

### 17.2 前端

- 新页面优先复用工作区标题、标签、面板、字段和状态组件。
- 不新增大面积渐变、发光、悬浮卡片墙和过度圆角。
- 所有页面必须实现加载、空、失败、权限不足和外部条件缺失状态。
- 不用颜色作为唯一状态信号。
- 副作用与保活页面解耦，隐藏页面不得重复轮询或提交。
- 新模态统一使用 `useModalFocus`，并验证 Escape、焦点恢复和移动端视口。
- 可分享状态优先进入 URL；临时交接数据明确 TTL 和一次性消费。
- 对大列表做服务端分页；不要一次加载所有租户数据。

### 17.3 后端

- 路由只从认证身份取租户，写操作再次验证记录归属。
- 领域逻辑从 Express Handler 拆出，便于单元测试。
- 外部调用设置超时、取消、限流和可判定的重试策略。
- 创建类操作必须幂等；结果不明时先对账。
- 错误响应提供稳定错误码和安全的人类可读说明。
- 不在日志或返回中泄露 Secret、Token、密码、客户全文。
- 外部效果状态只能由真实回执推进。
- 迁移为追加式；生产已使用字段不得无计划删除或改义。

### 17.4 AI 与内容质量

- Prompt 不得覆盖产品的权限、审批和事实边界。
- 企业确认事实与模型推断明确分层。
- 缺少证据时返回“未知/待补充”，不生成伪事实。
- 脚本、字幕和成片不得泄露 Prompt、内部规则、Mock 标记和占位符。
- 多语言输出做语言一致性、长度、字幕时序和字体检查。
- 高风险客户回复由确定性规则和模型分类双重拦截。
- 模型、知识、Prompt 和配置版本进入审计或任务证据。

### 17.5 外部平台

- 每个平台实现：授权、状态、刷新、断开、执行、回执、Webhook、错误映射和验收。
- OAuth 回调必须与公开域名完全一致。
- 真实发送/发布只在明确租户授权和当前版本审批后发生。
- 平台限流只在明确拒绝时重试；网络超时先查状态。
- 测试账号、沙盒和真实客户账号必须分开。

## 18. 测试与验收

### 18.1 测试层级

| 层级 | 目的 | 示例 |
| --- | --- | --- |
| 类型/构建 | 确保代码可编译和产出 | `npm run lint`、`npm run build` |
| 单元 | 领域规则和纯函数 | BANT、SPIN、订单迁移、发布时间、风险规则 |
| 契约 | UI/API/状态字段不回退 | Studio、数字员工、发布、客户回复 |
| 集成 | 数据层和跨模块行为 | 租户隔离、审批失效、发布回执、跟进 Worker |
| Mock 全链路 | 验证编排 DAG，不访问真实平台 | `test:full-chain-mock` |
| Smoke | 验证配置和主要入口 | 数字员工入职、非 Meta 路径 |
| 真实通道验收 | 验证 OAuth、发布、消息和回执 | 专用验收租户、小范围、人工审批 |
| 视觉/A11y | 响应式、键盘、焦点、对比度 | 桌面/平板/手机、axe、真机 |

### 18.2 常用命令

~~~bash
npm run lint
npm run build
npm test

npm run test:customer-service
npm run test:studio-script
npm run test:studio-media
npm run test:tenant-isolation
npm run test:digital-employees
npm run test:production-workflows
npm run test:agent-monitor
npm run test:weekly-package
npm run test:execution-gaps
npm run test:full-chain-mock

npm run check:digital-employee-migrations
npm run smoke:digital-employee-onboarding
npm run smoke:digital-employee-non-meta
~~~

真实、有授权的验收命令：

~~~bash
npm run verify:digital-employee-e2e
npm run verify:whatsapp-real-send
npm run test:tenant-sync-smoke
~~~

不得在未确认租户、收件人、平台账号和审批范围时执行真实验收。

### 18.3 核心验收场景

#### 鉴权与租户

- A 租户无法读取、修改或下载 B 租户的记录和文件。
- 过期/无效 Token 返回 401；无有效订阅按配置返回 402。
- 普通员工不能访问平台后台或修改组织角色。
- 支持会话到期后失效，退出后恢复管理员原会话。

#### 内容

- 三种生产路径的必填校验正确。
- 爆款复刻无 exact 证据时被阻塞或切换合法路径。
- 每种语言脚本、TTS、字幕和时长一致。
- 缺素材时不能把占位内容标记为完成。
- 修改成片/文案/账号/排期后审批失效。

#### 发布

- 排期成功不被显示为平台发布成功。
- 多账号结果可部分成功，并能单账号重试/对账。
- 超时且结果不明时不重复发布。
- 回执带平台 ID、账号、时间和原始安全摘要。

#### 客户

- 24 小时窗口内外正确选择会话消息或获批模板。
- 退订、黑名单、频控、号码变化、L4 风险均阻断。
- AI 不直接报价或承诺交付。
- 发送成功必须有提供方消息 ID；Webhook 正确回写送达和已读。
- 客户历史、记忆和风格证据不跨租户。

#### 数字员工

- 任务只在依赖满足后执行。
- 暂停、取消和人工接管会阻止后台继续外部动作。
- 重试不产生重复记录或外部动作。
- 每次纠偏有版本和审计，旧审批自动失效。
- 周复盘只引用真实数据，缺失项显示数据缺口。

### 18.4 Mock 与真实验收分界

- Mock 全链路用于验证领域编排、依赖、状态和安全门，不能证明真实平台可用。
- Demo 页面只能作为培训和交互验证，不能进入生产指标。
- 真实验收必须保存平台 ID、Webhook 回执或可验证文件。
- 测试报告要明确：真实覆盖、模拟覆盖、未覆盖和是否修改真实业务数据。

## 19. 发布清单

### 19.1 合并前

- [ ] 需求、非目标和审批边界明确。
- [ ] 数据迁移可重复执行，兼容当前线上数据。
- [ ] 类型检查、生产构建和相关测试通过。
- [ ] 新 API 有鉴权、租户校验、错误码和契约测试。
- [ ] 外部创建动作具幂等和结果对账。
- [ ] 页面具加载、空、失败、权限和外部能力不可用状态。
- [ ] 桌面、平板、手机和键盘操作通过。
- [ ] 未提交密钥、业务数据、导出、日志或临时媒体。
- [ ] 更新本文档和对应专项文档。

### 19.2 部署前

- [ ] 确认目标 SHA、环境和发布负责人。
- [ ] 数据与对象存储备份完成并可读取。
- [ ] 生产环境所有示例密钥已替换。
- [ ] OAuth 回调、Webhook 和域名证书正确。
- [ ] 只启用一个逐客发送 Worker。
- [ ] 发布、消息、视频生成和采集预算已设置。
- [ ] 真实验收租户与真实客户生产租户隔离。
- [ ] 回滚镜像、数据库恢复和联系人准备完毕。

### 19.3 部署后

- [ ] 健康检查、登录、首页和主导航正常。
- [ ] 企业资料、素材、客户和订单仍按租户可见。
- [ ] SSE、定时任务和 Worker 心跳正常。
- [ ] 私有图片、视频和音频可播放且不可跨租户访问。
- [ ] OAuth 状态和平台 Token 未因更新失效。
- [ ] 小范围发布/消息验收取得真实回执。
- [ ] 观察 30–60 分钟无异常错误、积压或资源突增。

## 20. 已知限制与开发路线

### 20.1 P0：生产安全与真实性

1. **统一服务端 RBAC**：为员工管理、企业治理、平台配置、支持会话和外部动作建立可复用角色中间件，并补齐 403 否定测试。
2. **收口本地 JSON 状态**：优先迁移数字人任务、调度、渠道、发布历史、支持访问和 Studio 变体；迁移前保持单应用实例。
3. **Worker 分布式互斥**：用数据库租约或队列替代进程内 Map，保证发布、发送、数字人和编排不会重复领取。
4. **真实通道门禁**：每次上线前用专用租户验证 OAuth、发布、消息、Webhook 和结果对账，不能用 Mock 结论替代。
5. **会话安全**：评估从长期 `localStorage` Bearer Token 迁移到 HttpOnly 会话/短期 Token，并设计 CSRF 与刷新策略。
6. **Webhook 安全**：逐个平台完成签名、时间窗、重放、幂等和原始请求体测试。
7. **关键 A11y**：修复页面语言、路由焦点/播报、Skip Link、模态焦点和嵌套 landmark。
8. **端口契约**：统一本地后端默认端口与 Vite 代理，避免首次启动即登录失败。

### 20.2 P1：可维护性与质量

1. 拆分超大文件：
   - `AiCreateStudio.tsx` 约 12,921 行。
   - `server/routes/videos.ts` 约 8,406 行。
   - `server/routes/studio.ts` 约 7,449 行。
   - `DigitalEmployeePage.tsx` 约 4,414 行。
   - `server/routes/digitalEmployees.ts` 约 3,525 行。
2. 产出 OpenAPI/JSON Schema，统一请求、响应、分页和错误码。
3. 统一 `tenant_id`、时间字段和状态枚举，减少兼容分支。
4. 将外部提供方适配器与路由、领域状态、重试策略解耦。
5. 补充结构化日志、指标、trace、队列监控和供应商错误面板。
6. 优化大 Chunk、Emoji/图表按需加载、产品表导入 Worker 化。
7. 清理不可达/休眠代码：旧 `ow_convs`、旧企业 UI、未路由 Plugins、疑似不可达 ScriptPanel。
8. 把通用 `platform-integrations` 的 501 骨架改为真实编排或移除误导入口。
9. 为图表提供表格替代，为标签组和复杂工作台补全键盘模型。

### 20.3 P2：产品完善

1. 当 `posting_stats` 达到样本阈值后启用租户/账号个性化发布时间模型。
2. 将 UI 文案纳入正式 i18n，同时保持内容语言与界面语言分离。
3. 引入统一前端 Router，前提是完整迁移生产深链、返回栈和保活行为。
4. 建立可视化工作流版本对比、审批差异和运行成本面板。
5. 建立供应商路由、质量、延迟、成本和降级策略中心。
6. 将产品指标定义落到可验证事件模型和经营分析看板。

## 21. 完成定义（Definition of Done）

一个功能只有同时满足以下条件才算完成：

### 产品

- 用户、场景、前置条件、成功标准、失败处理和非目标明确。
- 界面不会把草稿、排期、模拟或请求已提交显示为外部成功。
- 高风险动作具清晰人工控制。

### 数据与 API

- 数据模型、迁移、租户字段、索引和回滚策略完成。
- API 有稳定输入/输出、错误码、鉴权、租户验证和幂等。
- 关键状态由真实事实源推进，并保存审计证据。

### UI 与可访问性

- 遵循全局视觉令牌和页面骨架。
- 桌面、平板、移动端布局可用。
- 键盘、焦点、标签、错误播报、对比度和 reduced-motion 通过。
- 加载、空、失败、权限和能力缺失状态完整。

### 质量

- 类型检查和构建通过。
- 单元、契约和相关集成测试通过。
- 涉及第三方的功能完成真实小范围验收。
- Mock 与真实证据在报告中明确区分。

### 运维与文档

- 环境变量、开关、监控、告警、备份、恢复和回滚就绪。
- 不输出密钥或客户敏感数据。
- 本文档、API 说明、迁移说明和操作手册同步更新。

## 22. 源码索引

### 22.1 产品与前端

- [`src/App.tsx`](../src/App.tsx)：页面装配、鉴权、权限、导航和深链。
- [`src/components/Layout.tsx`](../src/components/Layout.tsx)：全局导航、账户、试用和协助态。
- [`src/components/AuthScreen.tsx`](../src/components/AuthScreen.tsx)：登录与注册。
- [`src/components/StrategyPage.tsx`](../src/components/StrategyPage.tsx)：首页与策略。
- [`src/components/DigitalEmployeePage.tsx`](../src/components/DigitalEmployeePage.tsx)：智能经营。
- [`src/components/AgentMonitorPage.tsx`](../src/components/AgentMonitorPage.tsx)：实时监控。
- [`src/components/TrafficPage.tsx`](../src/components/TrafficPage.tsx)：社媒复合页面与发布。
- [`src/components/InspirationDashboard.tsx`](../src/components/InspirationDashboard.tsx)：灵感和素材。
- [`src/components/AiCreateStudio.tsx`](../src/components/AiCreateStudio.tsx)：内容创作工作台。
- [`src/components/ConversionPage.tsx`](../src/components/ConversionPage.tsx)：客户对话。
- [`src/components/OrderManagementPage.tsx`](../src/components/OrderManagementPage.tsx)：订单。
- [`src/components/EnterprisePage.tsx`](../src/components/EnterprisePage.tsx)：企业知识。
- [`src/components/WorkspaceManagementPages.tsx`](../src/components/WorkspaceManagementPages.tsx)：脚本、记忆、组织权限。
- [`src/components/ScheduledPage.tsx`](../src/components/ScheduledPage.tsx)：定时任务。
- [`src/components/IntegrationsPage.tsx`](../src/components/IntegrationsPage.tsx)：集成中心。
- [`src/components/GlobalAssistant.tsx`](../src/components/GlobalAssistant.tsx)：全局助手。
- [`src/index.css`](../src/index.css)：视觉令牌和全局样式。

### 22.2 后端与领域

- [`server/index.ts`](../server/index.ts)：应用入口、路由、Worker 和静态资源。
- [`server/digitalEmployees/domain.ts`](../server/digitalEmployees/domain.ts)：配置、目标和任务图。
- [`server/digitalEmployees/runtimePolicy.ts`](../server/digitalEmployees/runtimePolicy.ts)：自主与审批策略。
- [`server/routes/digitalEmployees.ts`](../server/routes/digitalEmployees.ts)：数字员工 API。
- [`server/digitalEmployees/followupDispatchWorker.ts`](../server/digitalEmployees/followupDispatchWorker.ts)：逐客发送安全链。
- [`server/routes/studio.ts`](../server/routes/studio.ts)：Studio 与数字人 API。
- [`server/routes/videos.ts`](../server/routes/videos.ts)：采集和分析。
- [`server/routes/publishing.ts`](../server/routes/publishing.ts)：发布日历与执行。
- [`server/whatsapp/historyImport.ts`](../server/whatsapp/historyImport.ts)：客户与 WhatsApp。
- [`server/routes/enterprise.ts`](../server/routes/enterprise.ts)：企业、产品和订单 API。
- [`server/routes/auth.ts`](../server/routes/auth.ts)：账号、邀请、员工与会话。
- [`server/middleware/auth.ts`](../server/middleware/auth.ts)：请求身份。
- [`server/storage/datastore.ts`](../server/storage/datastore.ts)：数据访问契约。
- [`server/storage/pbStore.ts`](../server/storage/pbStore.ts)：PocketBase 与本地回退。
- [`scripts/setup-pb.ts`](../scripts/setup-pb.ts)：集合初始化。
- [`pb_migrations/`](../pb_migrations/)：PocketBase 迁移。

### 22.3 部署与专项文档

- [`docker-compose.yml`](../docker-compose.yml)：生产容器拓扑。
- [`Dockerfile`](../Dockerfile)：应用镜像。
- [`Caddyfile`](../Caddyfile)：HTTPS 入口。
- [`docs/design-system/lingshu-visual-system.md`](design-system/lingshu-visual-system.md)：视觉体系。
- [`docs/数字员工-经营任务编排与生产现场开发方案.md`](数字员工-经营任务编排与生产现场开发方案.md)：数字员工专项。
- [`docs/Agent浏览器监控.md`](Agent浏览器监控.md)：浏览器监控。
- [`docs/HeyGen与多语言验收.md`](HeyGen与多语言验收.md)：HeyGen 与语言验收。
- [`docs/platform-integrations-api.md`](platform-integrations-api.md)：平台集成接口背景。
- [`docs/server-ops-checklist.md`](server-ops-checklist.md)：服务器巡检。
- [`docs/backup-restore-r2.md`](backup-restore-r2.md)：备份与恢复。

## 23. 术语表

| 术语 | 含义 |
| --- | --- |
| 执行包 | 根据周目标、配置和有效策略生成的任务集合 |
| 运行（Run） | 一次经审批启动的执行包实例 |
| 任务（Task） | 运行内可观察、可纠偏、可交接的最小业务节点 |
| 业务引用 | 任务关联的项目、帖子、客户、批次等真实对象 ID |
| 事实源 | 判定状态和结果的真实数据位置 |
| 质量门 | 内容进入审批或发布前必须通过的规则集合 |
| 当前版本审批 | 与内容哈希/任务版本绑定、变更后自动失效的审批 |
| 外部效果 | 发布、发送等会改变第三方系统或触达客户的动作 |
| 人工接管 | 暂停 Agent 对该任务的控制，由人员继续处理 |
| 对账 | 根据业务对象与提供方回执重新判断任务状态 |
| Exact Analysis | 基于完整可验证视频时间线的精确分析 |
| 客群快照 | 在一个时间点冻结的客户集合、纳入/排除理由和事实 |
| 24 小时窗口 | WhatsApp 会话消息可自由回复的合规时间窗 |
| 支持会话 | 平台管理员在授权和有效期内临时进入客户租户 |

## 24. 文档维护

以下变更必须更新本文档：

- 新增、删除或重命名主导航和用户角色。
- 修改数字员工任务图、状态机、审批红线或事实源。
- 新增外部平台、模型、Worker 或真实外部动作。
- 新增/删除核心集合、字段、索引或数据存储类型。
- 修改鉴权、租户隔离、资源签名或支持会话。
- 修改部署拓扑、默认端口、域名、备份和恢复流程。
- 修改视觉令牌、响应式断点或可访问性基线。
- 发布时改变能力的“已实现/条件可用/实验”状态。

每次更新至少记录新的分支、提交 SHA、审查日期、测试结果和未验证范围。
