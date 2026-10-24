# 报价草稿归属与画像标签修复验收

日期：2026-10-24（Asia/Shanghai）。工作目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`，HEAD `89b175109149d4551aeb3ce590fe9c42c46bf23c`。在原未提交工作上继续，未执行基线合并、提交、推送或部署；保留其他任务已有修改。

## 本轮实现

- `pendingDraft` 仅恢复到回复框，不据此推断 AI 来源。移除在恢复、草稿变化及查看草稿时将任意保存文本写入 AI 建议的逻辑；明确请求生成的 AI 结果仍正常显示。建议气泡移除前三段截断，完整展示/编辑正文。
- 报价插入复用原草稿保存方法。本地预览沿用现有按租户、用户、模拟客户限定的草稿存储；不新增报价或发送主流程。
- 跟进状态独立显示；金额/意向评估、需求及来源归因独立于标签。标签分客户属性、产品需求、采购信号、风险关注，默认最多四个，可展开全部。
- AI 标签仅由已有 `contextTagEvidence` 标记，不凭标签文字推断来源。详情显示原文、消息 ID、当前会话核验结果；无证据的旧标签明确说明来源未标注。维度兼容分类是展示规则，不产生采购事实。
- 人工可修改标签名称、维度或移除标签，理由必填；保存原标签、证据快照、理由和时间。后续分析及授权客户投影继续应用纠正；过期编辑拒绝覆盖。退订、黑名单等联系限制不能通过此入口解除。
- 真实客户纠正复用原客户 PATCH、鉴权及渠道客户存储；模拟客户纠正复用现有隔离预览会话存储及读取接口。模拟标签改动刷新后不依赖临时前端状态。
- 已有模拟报价样例补充可核对买家原文的 AI 标签样例，界面标记“AI 模拟样例”；未调用模型来冒充此次样例生成。

主要新增文件：`shared/contracts/customerTags.ts`、`src/components/customers/customerTagPresentation.ts`、`CustomerProfileTags.tsx`、`CustomerProfileTags.test.tsx`、`src/lib/customerTagCorrection.ts`。现有草稿 Effect、会话页、右栏、模拟客户加载和原渠道资料投影/存储接入上述契约。产品规范新增 16.11。

## 浏览器验收

当前预览 `http://127.0.0.1:5225/?page=conversion&mock=quote`，使用已有 Alex 模拟客户。

1. 跟进状态“待报价”独立展示；初始四个标签按属性、需求、信号分组，展开可查看六个标签。
2. 打开“明确交期 · AI”：展示原文 `within 30 days`、消息 `mock-quote-debug-1-message-2`，核验匹配买家原文。
3. 人工纠正为“交期需人工确认”，归入风险关注，填写理由“模拟验收：30天为客户期望，产能排期需销售确认。”。再次打开可查看原标签、证据和理由。
4. 打开原已确认报价 `QT-20261024-127AB9`（V1，USD 6250），点击插入报价回复。主回复框包含完整 652 字符文本，付款、15 天有效期和末尾说明均存在；DOM 内 `[data-draft-suggestion]` 数量为 0。
5. 刷新页面后，报价全文及人工纠正标签仍保留，AI 建议气泡仍为 0。本地隔离会话记录存有 652 字符全文、原文证据快照与纠正记录，`transport_calls=0`。

证据截图：`tmp/customer-service-preview/quote-tags-fixed-workspace.png`、`tmp/customer-service-preview/tag-correction-evidence.png`。当前预览标签保留供用户查看。

## 验证与边界

- `node --import ./scripts/customer-isolated-test-guard.mjs --import tsx --test ...`：32 项定向测试通过。包含完整多段正文渲染、状态/来源与标签分离、默认四个标签、纠正快照保留、后续分类投影继续生效、过期更新拒绝、未知保存响应不清空标签、只读及联系权限限制、模拟持久化和身份隔离，以及原报价/发送边界。
- `pnpm run test:customer-pipeline`：83/83 通过，保持网络隔离。
- `pnpm run lint`（TypeScript）、`ARCHITECTURE_BASE_REF=89b17510 pnpm run check:architecture`、`pnpm run build`、`git diff --check` 通过。普通生产文件不超过 800 行，Studio 368838/485000 字节；原大 chunk 构建警告保留。
- 首轮发现 macOS 文件名大小写解析冲突，已将展示规则辅助文件改为 `customerTagPresentation.ts`。同时补齐 WhatsApp 存储字段类型，并将既有预览 AI 端口结果类型对齐共享 `ReplyGeneratorResult`，没有改变模型行为或调用范围。
- 日志：`tmp/customer-service-preview/quote-tags-tests-final.log`、`quote-tags-pipeline-final.log`、`quote-tags-lint-final.log`、`quote-tags-architecture-final.log`、`quote-tags-build-final.log`。

未调用真实消息渠道，未点击发送，不声明真实客户账号/供应商 E2E 或发布就绪。真实渠道纠正通过隔离规则和投影测试验证，未借用真实账号进行写入。无新外部 run/task/receipt，无数据库迁移。恢复点仍为当前 HEAD 及保留的未提交差异。
