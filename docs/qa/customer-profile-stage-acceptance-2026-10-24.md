# 多阶段模拟客户画像验收

时间：2026-10-24（Asia/Shanghai）。目录 `/Users/julia1/Documents/ChatGPT/1024客服`，功能分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。原有未提交修改保留；本轮仅新增分析回归测试及本验收记录。未推进治理文档中的集成基线，未提交、合并、推送、部署或迁移。

## 当前预览实测

使用 Chrome 当前预览 `http://127.0.0.1:5225/?page=conversion`，以及原报价模拟页 `&mock=quote`，登录账号为既有本地预览账号。未点击生成、翻译、发送或真实渠道入口。

| 模拟客户 | 独立跟进状态 | 标签与展开结果 |
| --- | --- | --- |
| Faisal | 询盘中 | 默认四个标签，按客户属性、采购信号、风险关注分组；展开显示第五个“负责人接管”，可收起 |
| Piotr | 已报价 | 默认四个；人工将风险标签“报价异议”改为“竞品报价待同口径核验” |
| Rina | 已成交 | “已成交”仅展示为状态，标签保留三个；人工将“复购”改为采购信号“二期扩产已确认” |
| Camila | 沉默30天 | 状态独立，四个标签按属性和需求展示 |
| Alex（报价样例） | 待报价 | 默认四个、总计六个；原 AI 样例“明确交期”的人工纠正仍为风险标签“交期需人工确认” |

Piotr 纠正理由为“阶段验收：竞品低价尚未核对配置，人工确认前保留风险。”；Rina 为“阶段验收：客户确认二期增加三套设备，按扩产采购跟进。”。这两项在本轮通过界面保存。Piotr → Rina → Camila → Piotr 切换后保留各自内容；随后显式刷新，再选择 Piotr 和 Rina，两个标签均保留且互不串用。重新打开 Piotr 详情，原标签、风险维度、纠正理由、保存时间均可见。

重新进入报价样例后，Alex 的纠正仍存在。详情保留原文 `within 30 days`、消息 `mock-quote-debug-1-message-2`，显示“已匹配买家原文”，人工维度和理由未丢失。来源未标注的 Piotr / Rina 旧标签明确提示无可核验 AI 依据，不冒充模型结果。Alex 原报价全文也仍在回复框中。

只读检查既有 `data/local-store/customer_preview_sessions.json`：上述三个已纠正客户均存在独立 `tagProfile`，`transport_calls=0`、`generation_calls=0`。本轮无真实渠道、模型或供应商请求，无外部 run/task/receipt。

截图（本地忽略目录）：

- `tmp/customer-service-preview/profile-correction-after-refresh.png`：Piotr 刷新后的纠正详情。
- `tmp/customer-service-preview/profile-ai-evidence-retained.png`：Alex 原 AI 消息依据和人工纠正同时保留。

## 后续 AI 分析覆盖验证

当前精简侧栏没有“重新分析标签”按钮，模拟入站也显式关闭自动标签分析。因此未声称在浏览器里完成真实模型重新分析。通过 `server/messenger/conversations.test.ts` 新增回归，用三个独立模拟客户调用原生 `analyzeMessengerCustomerTags` 写入流程；模型端口注入受控结果，原 `classifyContextTags` 校验买家原文：

1. 分析产生“明确交期”，随后保存人工改名、风险维度、理由及原文快照。
2. 重新分析再次返回原标签，再返回空结果，再模拟失败，最后再次返回原标签。
3. 从磁盘重新读取客户并执行 `projectCustomerBusinessProfile`。人工标签和完整纠正记录均保留，原标签不会重新出现；原始模型证据保留可审计。
4. 三个客户分别保留自己的纠正，不相互污染。测试客户仅位于系统临时目录，结束后恢复测试文件。

这证明原分析写入与读取规则的人工优先级，属于受控分析回归，不等于真实模型/真实客户 E2E。

## 实际验证

- 定向回归：`server/messenger/conversations.test.ts`、`src/components/customers/CustomerProfileTags.test.tsx` 共 14/14 通过。
- 首次直接使用 `tsx` 时，新加入的子进程隔离规则阻止 esbuild 编译进程启动；未放宽隔离。先用本地已安装 esbuild 将两个测试打包到忽略目录，再以 `node --import ./scripts/customer-isolated-test-guard.mjs --test --test-concurrency=1 ...` 执行，测试期间保留网络及子进程隔离。包含路由的初次打包因 `import.meta.url` 资产相对路径变化失败，未把该路由测试算入本轮通过数；原路由既有验证见上一份报价与标签报告。
- 最终定向日志：`tmp/customer-service-preview/profile-acceptance-tests-final.log`；编译产物在 `tmp/customer-service-preview/profile-tests/`。本轮未改生产代码，未重新构建页面。
- `ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture` 通过，2698 个生产 TypeScript 文件，预算 ratchet 通过。
- `pnpm run lint`（`tsc --noEmit`）退出码 0，`git diff --check` 通过；日志 `tmp/customer-service-preview/profile-acceptance-lint.log`。

安全恢复点为当前 HEAD 与保留的未提交差异；模拟数据改动仅为上述两项可再次人工修改的标签。不触碰其他客户的草稿、发送账本或审批数据。无新增业务阻塞；真实模型重新分析未在本轮调用。
