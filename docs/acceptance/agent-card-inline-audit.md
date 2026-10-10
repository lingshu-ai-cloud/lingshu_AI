# 同页真实面板 Chrome 验收

日期：2026-10-10。只新增验收 fixture/harness；未修改主功能。复用真实 ConnectedAgentCalendar、真实日历及目标 panel；仅替换 SocialProgramContext 的项目选择并 mock 明确 GET 读集。阻断所有非临时 Vite origin 请求以及非 GET/HEAD 请求。未知 GET 返回 404。

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/agent-card-inline-ui.mjs
```

结果：exit 0；11 个真实卡片点击→真实任务详情动作→真实面板用例全部通过。逐例核对面板可见、精确 dataset 与焦点，出版执行额外等待真实 assignment/attempt GET 渲染。

| 类别 | 子用例 | 实测 |
| --- | --- | --- |
| 跨周素材 | 新消费者核验 | 原请求 original-material / 新消费者 new-consumer 精确定位 |
| 客服知识/报价补齐 | 知识提交、知识核验、报价提交、报价核验 | 原 bound-run / request / item / member 身份及真实请求面板定位 |
| 发布恢复 | 原发布人工核验 | 原 task / publication / attempt dataset 精确定位 |
| M/IG 恢复 | Messenger、Instagram | 各渠道原 run / task / request / channel 精确定位 |
| WA 恢复 | 原发送异常核验 | tenant / program / package / version / run / task / item / whatsapp 精确定位 |
| 库存复用 | 本周独立审批入口 | bound inventory binding + publication next 精确定位 |
| 发布执行 | 库存来源发布卡（双 target） | publication execution panel 精确定位，assignment/attempt 实际 GET 渲染 |

证据写入 `work/agent-card-inline-evidence.json`：每条 caseId、panelId、identityDataset、visible、focused、readRequests、sourceHash；另存页错误、禁止请求与失败清单。主智能体独立复跑三者皆空。运行前后 ConnectedAgentCalendar SHA256 一致：`4696acec04d34603e567ee1e65e2341b378661641c6ed674b104fc73ae5c46c6`。

本轮吸收共享最新功能源码，原 AC-PUB-ROUTE 库存发布误入库存分支已在实际浏览器测试中通过。该修改不是本专项实施；harness 没有修改主功能。

限制：fixture 是严格 API 形状的隔离测试数据，不代表真实平台回执或真实客户活动。没有执行创建、审批、核验恢复、上传、发送或发布操作。非目标辅助 panel 可出现缺失 GET fixture 的局部提示；本轮不验收整页所有辅助功能、移动布局、刷新或返回位置。
