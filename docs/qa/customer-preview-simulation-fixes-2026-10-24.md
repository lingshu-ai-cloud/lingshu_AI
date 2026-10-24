# 客服本地模拟链路修复与复验（2026-10-24）

结论：当前分支的本地受控模拟链路已在实际预览走通：入站 → 草稿 → 翻译 → 人工接管 → 模板配置与审批 → 持久发送账本 → 会话写入失败恢复 → 模拟送达回执。刷新和后端重启后仍可读取原记录，传输次数始终为 1。此结论不代表真实模型、Meta 模板审批或真实渠道 E2E 通过。

后续更正：本文原隔离结论仅覆盖当时已包装的 HTTP 入口；测试启动器传递、底层 socket 和子进程覆盖后来发现缺口。完整误触复核及当前默认阻断证据见 [渠道隔离复核](customer-channel-isolation-audit-2026-10-24.md)，不能用本文的旧 guard 启动方式单独证明完整隔离。

## 工作位置与入口

- 目录：`/Users/julia1/Documents/ChatGPT/1024客服`
- 分支：`feature/customer-service-20261024`
- HEAD：`89b175109149d4551aeb3ce590fe9c42c46bf23c`，本轮改动未提交。
- 验收 URL：`http://127.0.0.1:5225/?page=conversion&customerSimulation=1`
- 使用本地账号登录，选择“空白海外客户”，打开“本地模拟链路”。普通会话 URL 不显示模拟入口。
- 后端仅在 `NODE_ENV=development`、`LINGSHU_LOCAL_PREVIEW=1`、`CUSTOMER_SIMULATION_ENABLED=1` 同时满足时挂载模拟路由。路由另校验 loopback、允许的本地 Origin、真实本地登录身份、会话 owner/tenant；生产环境、外站 Origin、其他用户及 PocketBase 身份均不能进入。
- 当前后端仍通过 `scripts/customer-isolated-test-guard.mjs` 启动，外部 HTTP 请求被拒绝；worker 未启用。

## 复用边界

没有新增入站队列、发送队列、接管模型或审批状态机。

| 业务 | 复用的原实现 | 本轮必要接线 |
| --- | --- | --- |
| 入站及回执投影 | `handleMessengerWebhook`、`upsertMessengerMessage` | 增加可注入的 DataStore 与会话 repository，默认生产调用保持原实现 |
| 草稿及原请求恢复 | `createCustomerReplyRequests`、`customerReplyEnvelope`、`readCustomerReply` | 注入明确标记的受控生成器；读取增加完整 fetch/body 时限与 requestId 校验 |
| 人工接管 | `createCustomerManualTakeoverService` | 注入本地会话作用域，仍使用原版本、owner、持久 lease 及人类发送权限检查 |
| 客群及逐客草稿 | `createCustomerSegmentSnapshot`、`createFollowupBatch` | 原函数补齐 DataStore 参数传递；不替换运行时全局 store |
| 模板配置 | `supportedFollowupTemplate`、`configureFollowupItemTemplate` | 受控模板目录 resolver；沿用原变量校验、正文冻结、版本更新及审批撤销规则 |
| 人工审批 | `createDigitalEmployeeApprovalDecisionApplication`、`applyFollowupBatchDecision` | 原审批请求、版本及内容 hash 校验；保存原审计和事件 |
| 发送与恢复 | `createCustomerChannelSendRequestService` 的 execute/get/repairHistory/recordSignedChannelReceipt | 本地受控传输和回执适配器；原请求身份防重放及恢复逻辑保持不变 |
| 持久存储 | 当前 DataStore | 仅增加 collection 名称前缀适配器，全部模拟 users/accounts/leases/approvals/ledger 都存入 `customer_preview_*`；不会写入正式集合 |

模拟发送身份为 `mid.preview-*`，回执注明 simulation。受控能力记录仅存在上述隔离集合，不能被正式账号读取或改变正式周任务状态。模板目录中的 APPROVED 为本地受控测试输入，不是从 Meta 获取的审批证明。

## 实际浏览器复验

| 步骤 | 实际操作 | 结果 |
| --- | --- | --- |
| 接收消息 | 输入 `Hello, please send product information.`，点击接收 | 经原 Messenger 入站处理持久保存；主会话显示该买家消息 |
| 草稿 | 点击生成受控草稿 | 原请求账本记录 1 次生成；返回可编辑中文正文 |
| 翻译 | 点击翻译受控样例 | 显示英文译文，明确使用固定样例；未调用真实模型 |
| 保存及刷新 | 保存后刷新页面，重新打开同一客户 | 原草稿及买家消息恢复；生成次数仍为 1 |
| 人工接管 | 接管十分钟，刷新后恢复，再释放 | 刷新后仍显示“人工接管中”；原记录可释放，最终无活动接管 |
| 原请求恢复 | 点击读取原草稿 | 正文恢复，提示没有重新生成，加载结束 |
| 模板审批 | 配置原模板并提交，批准当前批次 | 模板变量渲染、冻结正文、批次 v2 和原审批请求均保存；界面显示已批准 |
| 发送及故障 | 开启一次会话记录写入失败，再发送批准内容 | 原账本为 accepted，historyWritebackPending=true；界面提示“传输已接受，会话记录写入待恢复”，传输次数 1 |
| 失败恢复 | 点击恢复原发送记录 | 调用原 repairHistory，补齐主会话；historyWritebackPending=false，传输次数仍为 1 |
| 送达回执 | 点击接收模拟送达回执 | 原账本 deliveryStatus=delivered，原会话回执投影为已送达 |
| 原聊天发送入口重放 | 对同一批准正文再点原会话直接发送 | 复用同一持久发送身份，未再传输；乐观消息由原持久会话替换，没有新增重复消息 |
| 后端重启 | 重启同一本地后端，保留隔离数据，刷新后恢复 | 审批、请求、会话及送达状态仍可读取，传输次数保持 1 |

普通原回复框另做两项回归：

- 中文翻译失败时，页面显示“翻译服务暂不可用，原文已保留……本次未发送”，原文仍可编辑和保存；不再将异常只留在控制台，也不因父组件重渲染反复请求。
- 在 Faisal 原回复框保存“原回复框持久草稿复验”，刷新后在原回复框及建议草稿中恢复。仅浏览器存储无法提供可靠刷新恢复时，本地预览改用同一隔离会话持久记录。客服总开关关闭也不再阻止展示已保存草稿。
- 原降级草稿的“读取原草稿结果”显示“原草稿已恢复，本次没有重新生成”，按钮结束加载。读取超时和错误身份不会采用新结果，也不会触发重新生成。

## 运行证据

证据 JSON：`tmp/customer-service-preview/simulation-runtime-evidence.json`。

- Session：`1f3cc7bcde160c3e23cf02b2`
- 草稿 requestId：`2d7892e8-00cc-45e8-a3a1-56098c2903fc`
- Batch：`customer_preview_followup_batches_72b419d0cc734fc3ae279d434e63b696`，v2
- Approval：`customer_preview_approval_requests_4a808a3ba71244bc8451926ccbc89e0b`，approved
- Send requestId：`preview-630c0993-f0e8-4a67-9197-2e4c95d63052`
- Send：accepted；delivery：delivered；historyWritebackPending：false
- 传输次数：1；生成次数：1；持久会话消息数：2
- 正式 customers API 返回 0 个客户；正式客服 enabled=false、canAutoSend=false，WhatsApp/Messenger/Instagram providerReady 均为 false。

## 验证命令

- `pnpm run test:customer-pipeline`：82/82 通过，0 跳过。新模拟 HTTP 集成及原草稿恢复测试已加入原隔离入口。
- 定向 frontend + 原 Messenger/模板/审批测试：24/24 通过。
- `NODE_OPTIONS=--import=.../scripts/customer-isolated-test-guard.mjs pnpm run test:customer-service`：退出 0；隔离日志中的外部请求被 guard 拒绝，不是渠道调用成功。
- `pnpm run lint`：通过。
- `ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`：通过。
- `pnpm run build`：通过，Studio chunk 368838/485000 bytes；保留既有大 chunk 提示。
- `git diff --check`：通过。

相应日志均在 `tmp/customer-service-preview/simulation-*.log`。集成测试额外验证：跨 owner/tenant/数据权限不越界、生产路由关闭、未批准或正文变化不发送、旧审批版本不通过、相同入站事件不重复入库、草稿请求重放不重新生成、读取完整响应超时有界，以及正式集合不被模拟流程修改。

## 改动与保留范围

本轮主要新增模拟服务装配与本地 HTTP 边界、同一客服页面的本地验收 Drawer、隔离草稿持久适配器及回归测试；为原入站和跟进函数补充存储端口，并修复原聊天翻译、草稿恢复及发送适配器接线。没有复活之前延期的广泛后端扩展。

工作区同时存在报价入口、客户右栏及聊天排版的并行修改，已保留，没有回退或认领为本轮修复；此前 CustomerWorkspaceTools 等未提交改动也保留。

本次故障场景覆盖“传输接受后会话写入失败”的安全恢复。真实渠道授权、真实平台模板审批、真实模型生成质量及真实平台未知结果的人工核验没有执行。本轮只声明受控本地链路通过。未合入基线、未提交、未推送、未部署。
