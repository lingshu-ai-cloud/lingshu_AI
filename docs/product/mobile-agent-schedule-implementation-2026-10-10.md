# 移动工作台 Agent 排期实施记录

日期：2026-10-10。状态：源码实现和自动化验证已完成，等待主会话统一实际服务联调与微信原生验证；没有部署。

## 产品行为

关键数据看板下仅展示 Agent 排期。按 Agent 分组，任务沿纵向时间线显示计划时间、截止时间、状态、当前节点、负责人、阻塞原因、最近真实事件、观察时间及下一步。没有设置时间时明确显示计划时间未提供；只有日期时只显示日期，不虚构时刻。数据源失败不显示空闲。

普通任务进入真实任务现场只读详情；匹配当前待处理队列（含稍后队列）的任务打开同一事项处理路线。稍后事项先向服务端撤销稍后，写入失败则保留原状态，不打开处理。排期状态本身不构成动作授权。

## 数据合同与复用来源

新增 overview.agentSchedule，只读投影，不创建排期表。items 包含 taskId、runId、role、title、status、plannedAt、dueAt、completedAt、observedAt、stage、blockedReason、nextAction、ownerId、ownerName、matterId、version、waitKind、waitMessage 和 lastEvent。

- workflow_tasks：复用网页 AgentExecutionStatus / AgentMonitor 的任务身份、状态、output.waitState 和当前执行记录。
- run_events：复用网页执行现场的最近 summary / occurred_at，严格匹配租户、任务和 run。
- AgentWorkspace 的工作日历实际读取 scheduled_tasks 的 cron / next_run，与工作流任务不是同一实体；本次不将重复调度计划伪装成运行任务。
- publishing/CalendarPlanner 读取 posts 发布计划。遵守最终共识，不把内容发布日历再次放到首页，也不将 posts 时间伪装成 Agent 的执行计划。

投影覆盖当前企业全部未完成任务，以及所选周完成的任务。所有时间仅从持久化字段读取，创建时间不作为计划时间。最近事件读取失败单独返回 eventAvailability，不抹掉已知任务状态。事项跳转优先以最新 queue.matters 的 source.entityId 或 matterId 关联。

## 验证

- 排期客户端 5/5：未知时间、日期型计划、普通任务真实详情、同事项处理跳转、撤销稍后失败保护。
- 服务端投影与概览 6/6：完成任务周范围、持续任务、租户隔离、缺字段不伪造、最近事件 run 隔离、源故障与完整分页。
- 旧客户端全量回归首次 36/38；另两项涉及已被其他会话移除的 starter 分流契约，已反馈主会话调整，不能视为全量通过。

源码不包含 Mock 回退。自动测试内使用隔离 fixture 检查合同；此记录不代表真机和真实企业端到端验收完成。
