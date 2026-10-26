# 灵小枢三场景复用与执行边界（2026-10-26）

状态：功能分支实施记录；不是基线或真实 E2E 验收。

## 全局复用审计

| 场景所需能力 | 仓库现有权威模块 | 本次接法 |
| --- | --- | --- |
| 企业产品与多产品事实 | `creationEvidencePorts`、`guidedEnterpriseContext`、`verifiedSocialScriptContext` | 对话只传稳定产品 ID；服务端重新读取租户知识库。 |
| 对标视频与原口播 | `contentCreationTurn`、`buildSocialTaskReferencePackage`、`buildSocialReferenceReuseBinding` | 对标参考由真实逐镜分析和 ASR 提供；编辑稿逐句绑定原句 ID，提交时复算证据指纹。 |
| 开场与活动素材匹配 | `buildSocialWorkflowMaterialCandidates`、`materialRoutingRequests`、`guidedMaterialRoutingRequests` | 上传进入原素材库；只允许有真实片段、权限和视觉证据的候选。开场另核对精确起止范围；活动素材由现有匹配器放入说明性分镜。 |
| 创作与持久化队列 | `createSocialContentTask`、`addSocialTaskSource`、`startSocialContentTask`、现有幂等键与执行回执 | 场景沿用 `guided-creation/submit`，无第二套执行器。局部预览仍受原付费保护。 |
| 内容任务与日历 | `creationTaskRows`、`creationTaskCalendar`、`digitalEmployeeApi.overview`、原任务 Drawer | 助手同源读取任务分页和周任务；结果进入内容创作任务详情。计划时间与实际发布回执分开。 |
| 周排期修订 | `socialWeeklyScheduleRevisions` 和 `WeeklyOperatingWorkbench` | 仅冻结周任务包可沿用容量提案、版本确认与撤销发布授权；普通场景任务不得伪装成周包或直接改期。 |

## 决定

活动对话顺序为上传视频或卖点、名称/产品/优惠、对标视频、逐句口播、最终确认。用户上传素材没有匹配到合适说明镜头时留在待介入状态。用户修改的口播仅更新当前创作方案稿，原片 ASR 与分析保持不变。活动优惠属于用户确认的业务输入；脚本仍接受原产品事实与执行门禁，不把营销承诺自动视为已核验知识。

开场的用户自有视频必须定位到租户原素材库和可生产片段，分镜执行保持用户所选起止秒数。已授权的真人口播开场沿用现有 reviewed-material binding 入口，并在最终路由时重新核验租户、版本、商用及改编授权；它不会被“画外音”选项改写成产品补画面。仅供参考的视频在缺少对应原片分析时阻塞，不能拿参考片充当企业画面。对标视频是后续口播和镜头结构来源，和用户提供开场的素材身份各自保存、核验。

卡片创建成功、队列接收、开始运行、素材/证据阻塞分别显示。服务端回执是执行真相；HTTP 成功或任务 ID 不能自动表示“已在创作”。日历展示计划发布，不推断平台真实发布。真实供应商、发布、生产迁移及部署须独立授权和验收。
