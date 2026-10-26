# 助手固定官方资讯来源（本地开发）

用户于 2026-10-27 要求固定资讯采集路径并采集一批原文。本流程只 GET 公开页面，不调用模型，不部署，不发布、不抓取登录区或绕过反爬。

| 范围 | 固定栏目 | 原文路径约束 |
| --- | --- | --- |
| 美妆/个护原料 | https://personal-care-hygiene.basf.com/global/de/news-releases | www.basf.com/global/en/media/news-releases/YYYY/MM/p-* |
| 美国化妆品监管 | https://www.fda.gov/cosmetics/cosmetics-news-events | 同站 cosmetics/cosmetics-news-events/文章 |
| Facebook/Instagram | https://about.fb.com/news/tag/reels/ | about.fb.com/news/YYYY/MM/文章/ |

来源注册表：`server/externalInformation/authoritativeNews.ts`。仅跟随栏目内符合固定路径的 HTTPS 原文，每源最多三篇；无任意 URL、无重定向追随。每条保留标题、原文链接、页面发布时间、核验时间和短摘要；不保存整篇正文。来源内容按数据处理，不能覆盖助手指令。

手动采集：`NODE_USE_ENV_PROXY=1 node --import tsx scripts/collect-authoritative-news.ts`。

缓存：`data/local-store/authoritative-news/latest.json`；同目录保存时间戳快照，局部失败保留旧条目和旧核验时间。均为运行数据，不进入源码基线。正常查询先读缓存，超过六小时在该次查询中尝试刷新；这不是后台定时任务。用户取消请求会取消本轮采集。

匹配规则：美妆相关问题使用 BASF，明确美国/全球且美妆的问题可用 FDA；配置 Facebook/Instagram/Meta 才使用 Meta。最近七天无匹配发布则明确展示历史资料，不把栏目更新时间、抓取时间或 URL 日期当作文章发布时间。无适配来源时提供官方栏目入口而非编造新闻，扩展行业/平台需增加对应官方注册项及测试。

本次实际结果：6 条（BASF 3 条、Meta 3 条）。FDA 请求被站点重定向至反滥用拦截页，按失败保留，不绕过。该来源尚未完成本地原文采集验收。

恢复：停止调用采集脚本即可停止新增缓存；源码未提交、未部署，旧缓存快照可供核对。不要删除其他本地运行数据或回滚共享源码以处理单源故障。
