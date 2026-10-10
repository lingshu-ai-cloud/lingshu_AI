# M1 新周连续生产专项验收

## 范围与身份

独立测试：`server/runtime/weeklyM1ContinuousProduction.integration.test.ts`。

以 B2B 零基础、外部参考 100% 的单视频为范围，调用正式服务创建新周任务包、修订接待要求、初始化编导排期、确认初始容量、重新派单并激活。保留该周原始执行图，正常 worker 领取各任务；不替换成已完成任务表，不拼接其他周的成片。

素材通过真实字节读取、人工上传请求服务的提交/审核/绑定、产品身份核验后，执行同一内容任务、同一 run、同一 durable job 的脚本暂停、分镜、素材复核及资产续跑。受控本地供应端生成两条真实 MP4，系统语音与正式剪辑生成成片。审核和发布读取实际产物，校验发布视频 SHA256 与 source claim 相同。

尾链通过逐镜 G4、独立 G5 审核 API、G6 五项发布预检、真实用户审批 API、发布包扫描及正式 TikTok 发布适配器。WhatsApp、Messenger、Instagram 就绪卡由默认权限 reader、真实加密配置、绑定服务、正常 worker 和就绪 adapter 完成。发布端口仅返回受控收据；重复执行不得再次发布。

## 受控边界

- 参考分析由已有受控 fixture 准备，不证明在线模型分析质量。
- 企业产品类别是预置测试事实，在新周及脚本冻结前确认，不虚构性能。
- G4/G5 输入明确标记为受控审核，只验证服务、证据保存和门禁；不证明真实人工审核或内容商业质量。
- 客服 goal/plan/run 和 queued tasks 是预置待执行输入。正式 `bindWeeklyCustomerRun` 验证并绑定；本测试不覆盖客服 HTTP 创建入口、不分群或发送私信。
- 客服运行四张任务保持 queued，未创建 followup 发送项；就绪不等于消息已发送。
- 无付费生成、真实发布或部署。不能据此宣称上线端到端完成。

## 故障矩阵

| 检查点 | 预期证据 |
| --- | --- |
| 产品身份未审核 | 准备任务 blocked，提前 recheck 拒绝 |
| 资产任务未到期 | 原 durable job paused，供应调用为 0 |
| 到期恢复 | 原 job ID 不变，内容任务只有一个 job |
| G4 未提交 | 质量卡 blocked，不能提前人工审批 |
| 实际字节质量硬失败 | 服务拒绝绕过，必须改进实际素材 |
| 权限证据过期 | 发布预检不能通过；发布时点重新复核后再创建 G6 |
| 三渠道就绪 | 三张不同 channel 证据，客服执行任务仍 queued，无发送项 |
| 正常发布 | 单一受控 provider post，真实成片 hash 一致 |
| 重复发布卡执行 | 读取原终态收据，post 数量仍为 1 |

专项执行命令：`./node_modules/.bin/tsx --test server/runtime/weeklyM1ContinuousProduction.integration.test.ts`。

## 本次实测

2026-10-10：专项测试 1 项通过、0 项失败，约 23.45 秒。观察到 `M1_CONTINUOUS_PUBLISHED`，post 数为 1，原作业与成片身份连续。三渠道集合及未发送断言均通过。未修改业务实现；未运行重复全库类型检查，全库检查由主集成统一执行。
