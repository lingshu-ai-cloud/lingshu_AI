# 周 Agent 版本与接口协议

版本：1.0，2026-10-10。M1 固定范围：B2B 零基础、单账号、单条外部参考、无模板。本文是集成协议；实现或测试与协议不一致时保留失败并集中评审。

| 操作 | 版本/身份 | 允许写入 | 禁止隐含行为 |
| --- | --- | --- | --- |
| 首次容量预览 | 当前未执行 draft Vn，目标图 Vn+1 | 临时守卫租约 | 创建生产作业、绑定或修改草稿 |
| 生成提案 | 绑定源输入 hash、完整目标图 hash、显式容量、提案 ID | 持久提案 | 默认免费、默认工时/资源窗、自动批准迁移 |
| 明确确认 | 鲜核用户/租户、未执行草稿、输入/容量/目标 hash | snapshot、旧图 fence、新不可变 draft Vn+1、对应任务 | 自动激活、发布、把新任务标完成 |
| 确认重试/未知响应 | 同 proposal/snapshot/目标版本 | 原结果回查/幂等结算 | 第二次生成周版本或重复提交付费 |
| 激活及任务领取 | 实际确认容量的新版本，独立激活/权限 | 该版本真实 task/lease | 仅凭日历建议解除容量门禁 |
| 制作暂停/恢复 | 原 content task/run/job、原供应商回执 | 冻结意图、阶段检查点、真实 leased 资产准入 | 新 job/run 冒充恢复、未知结果重投 |
| 产物验收及发布 | 精确成片与冻结输入/账号/发布条目 | 验收、审批、实际发布回执 | 规划成功冒充成片或平台成功 |

M1 接口：`GET /operating-packages/:packageId/initial-schedule?version=n`；`POST .../initial-schedule/proposals` 输入 `{packageVersion, capacity}`；`GET .../initial-schedule/proposals/:proposalId?version=n` 回查；`POST .../initial-schedule/confirm` 输入 `{packageVersion, proposalId, expectedVersion, inputEvidenceHash}`。由真实父路由及服务鲜核身份；前端 token、tenant、周版本变化后旧异步结果失效。

容量只由显式剩余工时、缓冲、成本、resourceKey、可开始时间、工作窗和并发组成。估计时间不能替代确认容量。确认生成新版本；图 V2 的 `weekly_initial_capacity_schedule_required` 仅由鲜核持久 snapshot 清除，普通 unblock 不得绕过。所有生产前置和发布前 24h 约束必须落实到实际任务时间。

绑定迁移：旧素材、参考、模板、库存、承接绑定不自动扩大到新版本。依各类型真实协议生成新范围证据或明确待补，旧记录保留。M3 模板迁移需在 proposal 显示来源与旧→新绑定，用户逐项批准精确 planHash，再创建新不可变 binding；首稿尚未全链验证，不进入 M1。

已执行任务：保留旧图、task、run/job、产物和回执。旧图改造走明确修订；只有真实兼容输入和依赖证明可沿用结果，不能复制 succeeded 或假依赖完成。未知供应商/平台回执沿原 ID 对账；缺原 ID 转明确人工核对。

权限：确认排期不授权付费、外部消息、发布或部署。M1 受控运行与真实运行分别验收，完整目标只有全部里程碑及生产验收通过才可完成。
