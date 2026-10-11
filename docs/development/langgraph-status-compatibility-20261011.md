# LangGraph 状态与现有 UI/API 兼容设计

日期：2026-10-11。本文是待确认设计，不代表已接入 LangGraph。架构债务处理选择仍待用户确认；本次仅编写文档，不变更运行行为。隔离预览仅验证登录页可达，未完成认证后的浏览器验收。

## 兼容边界

保留数字员工 overview、内容队列、Studio 项目及现有控制接口。LangGraph 执行器经业务适配层写入现有任务与产物记录，页面继续读取现有投影。checkpoint 只表达执行进度，不作为预算、交付、发布或产物验收的业务事实依据。首版不新增一套 UI 百分比或将图节点完成直接解释成视频完成。

源码核查位置：`src/lib/digitalEmployees.ts`、`src/lib/digitalEmployeeApi.ts`、`src/lib/weeklyContentProgress.ts`、`src/lib/weeklyContentProgressSnapshot.ts`、`shared/weekly-work-status.mjs`。

## 可复用字段

| 现有契约 | 字段 | 适配职责 |
| --- | --- | --- |
| WorkflowRun | id、goal_id、plan_id、status、current_controller、pause_reason、started_at、completed_at | 保留业务运行身份和归属；图运行关联应由后端保存 |
| WorkflowTask | id、run_id、task_key、status、sequence、depends_on、agent_role、blocked_reason、output、updated_at | 使用现有节点依赖、执行回执和故障原因；output 保存可核验引用，不保存视频字节 |
| WorkflowTask | task_version、correction_version、business_refs、status_source、execution_mode、external_effect | 恢复前验证版本与引用；标记执行来源，保留审批与外部副作用边界 |
| ContentQueueItem | id、contentId、taskId、orderId、batchPlanId、projectIds、lineage | 按内容身份关联图节点，禁止同一任务下多个内容默认选第一个 |
| ContentQueueItem | status、stage、progress、reason、updatedAt、steps | 保留现有业务投影和进度算法，原因必须来自真实阻塞或执行证据 |
| ContentQueueItem | estimatedCostCny、settledCostCny、costStatus、outputSummary | 成本从现有预算/结算记录读取；输出状态从实际产物校验读取 |
| ContentQueueStep | key、state、responsibleAgent、estimatedMinutes、estimatedStartAt、estimatedFinishAt、actualStartedAt、actualFinishedAt | 预计时间与真实时间区分；done 必须有业务完成依据 |
| ContentExecutionRuntimeJob | id、taskId、runId、status、attempt、maxAttempts、nextAttemptAt、retryClass、publicReason、queuePosition、waitingOn | 队列等待、重试与容量继续由现有队列投影；图不能独立叠加一套重试次数 |
| DigitalEmployeeOverview | run、tasks、contentQueue、executionRuntime、events、approvals、handoffs | 保留总入口，人工审批与交接使用现有业务身份和权限 |

## 状态映射规则（待实现）

| 执行情境 | 业务状态建议 | 页面依据 |
| --- | --- | --- |
| 任务已入队但未领取 | runtime queued；task pending/queued | queuePosition、waitingOn；不得显示实际生产中 |
| 正在执行生产节点 | runtime running；对应 task running | 当前节点真实开始记录 |
| 供应商已接受、尚无可验证结果 | task waiting_external；必要时 runtime reconciling | providerTaskId/providerAcceptedAt；显示等待或核查，禁止再次提交付费请求 |
| 可安全重试的暂时故障 | runtime retry_wait | nextAttemptAt、retryClass、attempt；只由一个机制推进重试 |
| 人工审批中断 | task waiting_approval/waiting_human；run blocked | 现有 approvals/handoffs、blocked_reason；不能映射成异常失败 |
| 人工暂停 | runtime paused；run paused | pause_reason；保留已有产物 |
| 不可自动恢复故障 | runtime blocked/dead_letter；task blocked/failed | 公开原因和可执行恢复动作；不暴露供应商密钥或原始内部异常 |
| 图执行结束 | 根据业务回执决定 task/run 是否 succeeded | 完成图遍历不足以证明成片、质检或交付成功 |
| 取消 | runtime cancelled；run cancelled | 保留历史回执；不增加 completedTasks |
| 新增或未知状态 | 不推断为 running | 共享 weeklyWorkStatus 投影保留 unknown |

运行状态与队列状态是不同层次，不能机械一对一复制。例如共享周状态当前把 waiting_external 显示为 queued 阶段、标题为“等待外部服务”；该展示语义继续保留。未创建运行时，即使制作准备 ready，也只能显示“尚未开始生产”。

## 内容与镜头进度

继续使用 `buildWeeklyContentProgress`：阶段 key 为 benchmark、script、materials、voice、presenter、render、quality；状态为 pending、ready、running、waiting、blocked、completed、not_applicable、unavailable。

镜头回执已有 id、projectId、firstFrameMaterialId、videoMaterialId、adoptedMaterialId、qualityLabel、providerTaskId、providerAcceptedAt、updatedAt。适配层必须区分供应商接受、产物返回、产物被采用、完整成片与质检通过。镜头完成不能使所有此前阶段自动完成；质检失败须保留其真实检查项与受影响镜头。

单镜返工必须绑定内容、项目、镜头和方案版本。修改方案后按业务规则失效关联证据；图 checkpoint 不得恢复到另一方案版本，旧供应商回执不可自动采用到新镜头。

## 查询和控制接口

保留 `GET /api/overseas/digital-employees/overview?goalId=...` 与 `GET /api/overseas/studio/projects`。现有 `readWeeklyContentProgressSnapshot` 并发读取这两个只读入口，检查 goal、plan、run 归属，允许同一计划首次出现运行；保留取消、超时和项目过滤行为。GET 查询不得隐式启动、重试或核查触发供应商副作用。

`digitalEmployeeApi.retryTask(taskId)` 和 `controlExecutionJob(jobId, pause|cancel|resume|retry)` 的用户入口保留。后端路由根据创建任务时固定的 executor 所属派发；旧任务由旧执行器完成，新任务按开关选择执行器。单个任务不能同时交给两个执行器。恢复请求验证租户、业务身份、版本、审批记录与当前状态，重复请求需要幂等处理。

## 实施前确认与验收

1. 确认后端已有 run/task/queue/审批状态机的所有权，避免双写、双重重试与事件循环。
2. 决定图运行关联、方案版本与幂等恢复账本存储方式；不能仅依赖前端类型提供的身份字段。
3. 单元/集成验证：未开始、外部等待、未知状态、错误目标、取消计数、按镜返工、重复恢复、跨租户拒绝。
4. 查询故障验证：GET 只读，抽屉关闭和身份切换取消旧请求，挂起供应商结果不重复扣费。
5. 认证浏览器验收员工排期、18 条发布内容、Agent 设置、内容抽屉与 Studio 返回路径；目前尚未完成该验收。

验收时使用现有共享投影、真实业务回执与受控供应商模拟。实际付费调用和外部发布不由状态查询或本设计自动授权。
