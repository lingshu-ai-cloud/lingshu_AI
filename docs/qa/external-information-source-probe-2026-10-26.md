# 外部资讯取数与交付样本验收

本轮目标：公开示例「越南 / 美妆、防晒」，验证来源能否取回数据，以及哪些内容可进入前端结论。不是黄金业务链路 E2E，也不代表供应商 SLA 或生产就绪。

## 代码与运行身份

- 工作树：`/Users/julia1/Documents/ChatGPT/1026对话界面外部信息`
- 分支：`feature/external-info-cards-workflow-20261026`
- HEAD：`ff43ca6192dbd12c47e7456f31a4581ebf6f017e`，有本地未提交改动，包括此前用户要求删除首页快捷标签的改动，均保留。
- 取数 run：`2026-10-26T03-04-24-284Z`，北京时间 2026-10-26 11:04。
- 私有本地证据：`artifacts/external-information/2026-10-26T03-04-24-284Z/`，该目录被 Git 忽略。
- 未读取或向供应商传送企业私有上下文；未启动生产任务、迁移、推送或部署。

## 实际结果

| 来源 | 传输结果 | 可用于结论的范围 |
| --- | --- | --- |
| ExchangeRate-API 开放接口 | 成功；复用现有共享读取器 | 2026-10-26 每日参考汇率：1 USD = 6.677446 CNY；10,000 USD 精确换算为 66,774.46 CNY。更新时间为北京时间 08:02:31。不是银行成交价。 |
| Google News RSS | 成功；44 条有日期的近7天候选，6 条词面匹配 | 标题和发布时间仅可发现线索，不能直接推导行业事实。排除了仅包含 beauty 的选美新闻误匹配。 |
| Google Trends 越南 RSS | 成功；10 条，0 条产品词匹配 | 证明热搜源可访问，不能替代指定产品的历史搜索兴趣曲线。各主题共用 feed URL，去重使用 URL + 标题。 |
| Gemini + Google Search | 一次真实请求成功，responseId `OcPeasr6N6HGjuMPpcbEmQk` | 返回政策候选缺越南主管机构原文，且包含明确标为示例的链接，候选被质量规则拒绝；不输出政策内容、生效日或合规动作。 |
| 海关总署官网 | 失败 `SELF_SIGNED_CERT_IN_CHAIN`；启用系统证书信任后的补测仍失败 | 没有取得统计数据；未关闭 TLS 验证，不以其他网站转载冒充海关直连成功。 |

供应商文本、RSS 与规范化汇率快照保存在本地。SDK 密钥和完整含凭证请求不落盘、不输出；SDK 单次请求禁止自动重试，maxOutputTokens=1200。

## 媒体原文补验

人工检索定位 Thanh Niên Việt 的 ULACHOI / IPCR / KEHETO 报道，然后程序实际取回正文（HTTP 200），保存正文、抓取回执和 SHA-256。核对发布日期为 2026-10-19，文中事件为 2026-10-01，不把报道日期当成事件日期。

这证明一篇媒体原文及其企业个案可读取，不代表 Google News 聚合链接自动解析、原文匹配与全量核验已经打通。该报道不作为政策原文，也不用于推断防晒市场增长。

## 前端交付

- `report.json`：原始本轮探测记录；不修改。
- `reviewed-report.json`：修正 feed 去重与匹配规则后的复核结果，政策候选标记为拒绝。
- `delivery.json`：经 Zod 校验的结果快照；facts 引用 sourceIds，结论、推断和建议引用 evidenceIds。discovery_only 来源不能支持 facts，来源限 HTTPS。
- `index.html`：基于该 JSON 的本地交付原型，有「用户交付 / 来源验收 / 交付 JSON」三个可操作视图，尚未接入正式助手消息流。用户视图保留事实、推断、建议及默认折叠的缺口和来源；不展示未通过的生成候选。
- 结论：可以准备企业个案调研与参考换算；没有证据支撑越南防晒需求增长、市场规模或新政策已生效。

## 复现与验证

公开来源探测：`tsx scripts/probe-external-information.ts`。只有明确追加 `--google-search` 才调用一次模型搜索。该命令创建新 run，不覆写已有证据；每次真实模型调用仍需对应任务授权。

交付样本构建（仅读取保存的证据，不调用供应商）：`tsx scripts/build-external-information-delivery.ts artifacts/external-information/2026-10-26T03-04-24-284Z/report.json`。此构建器是本次固定证据样本，不是通用业务报告生成器，需要已保存的原文补验文件。

定向检查：`tsx --test server/externalInformation/sourceProbe.test.ts server/externalInformation/externalInformation.test.ts`，12/12 通过。覆盖无效日期、过期/未来条目、重复主题、词面误判、示例链接、来源安全与证据引用约束，以及现有汇率/贸易统计读取回归。

`tsc --noEmit` 通过；两个新增脚本另行使用 ES2022/ESNext/bundler/strict 参数检查通过。`node scripts/check-architecture.mjs` 对 2864 个生产 TypeScript 文件通过，未设置相对基线 ratchet；`git diff --check` 通过。Browser 实际打开并切换三个视图核验。没有运行全仓 quality/verify 或真实业务任务 E2E。

后续边界：海关受信证书链或正式可用数据通道、Google Trends 指定关键词曲线授权、聚合条目到原文的自动匹配，以及逐条证据支持与业务相关性判断仍待完成。不得把本样本写为五类来源全部跑通。
