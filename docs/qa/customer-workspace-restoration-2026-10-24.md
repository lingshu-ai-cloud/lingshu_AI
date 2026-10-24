# 客服工作区原能力接线与隔离回归

日期：2026-10-24，Asia/Shanghai。

工作树：`/Users/julia1/Documents/ChatGPT/1024客服`。
功能分支：`feature/customer-service-20261024`，源码起点 `89b175109149d4551aeb3ce590fe9c42c46bf23c`。本次保留未提交差异供审阅，不合入或推进基线。

## 核对结论与范围纠偏

此前客服隔离验收来源为 `0c994b3c`，说明见 `customer-service-isolated-acceptance-2026-10-22.md` 和 `CUSTOMER-PIPELINE-AGENT-EXECUTION.md`。固定比较该提交与 `89b17510`：本次核对的 customerSuggestions、historyInbound、enterpriseOrders 等关键后端文件没有新增差异；ConversionPage、ConversionChatThread、ConversionCustomerRail 的差异主要是外观和布局。

原验收已经说明：正式 WhatsApp 入站自动接待未启用；通用 outbox 只支持 Messenger/Instagram，WhatsApp 发送使用原周跟进与模板审批；批量管理依赖已有运行。这些原有边界及真实渠道未配置，不能被归因为新前端破坏了已跑通后台。

根据用户“务必不要重复造轮子”的纠偏，本次交付收敛为已有组件和业务入口的接线及受影响回归，不扩展自动接待、媒体后台、跨渠道订单/归因或存储能力。

## 实际接线

| 入口 | 复用位置 | 保留的约束 |
| --- | --- | --- |
| 客户资料与订单 | BasicInfoWidget、TagsWidget、OrderHistoryWidget | 原资料 PATCH、标签证据、订单台账；不把手工阶段或历史备注视为已付款事实 |
| 批量跟进与模板审批 | digitalEmployeeApi.overview、buildTaskDeepLink、CustomerWorkflowPanel | 原 run/task、资源引用和审批版本；只选择当前运行的 customer 任务，不临时创建空运行 |
| 微信客服 | WeComCustomerServicePage 及其原 API | 保留连接、草稿、发送、接管及回调恢复，不增加接入或发送流程 |

资料、标签和订单放在 Ant Drawer 中，保持已验收紧凑侧栏和原四分类、三栏布局。新入口复用共享 Token，原恢复、报价、翻译和发送实现不变。订单新增按钮只对原接口支持的真实 WhatsApp 客户开放；没有资料写入适配器时，不显示可成功保存的语言编辑操作。

当前没有新增生产后端、共享协议、发送账本、审批流程、队列、数据库迁移或存储适配器。`server/security/externalCustomerServiceDemo.test.ts` 仅更新一条已过时的 UI 断言：按现行 UI 规范 16.8，不恢复持久沙盘横幅；单会话模拟标识和发送适配器“模拟客户不发 HTTP”的行为检查保留。

## 实际验证

- 隔离客服主链：80/80，通过原 test:customer-pipeline 所列文件；日志 `tmp/customer-service-preview/restored-ui-pipeline-tests.log`。
- 新入口及原页面边界：14/14；包括原任务身份及审批引用、订单新增边界和缺少资料适配器的禁用状态；日志 `restored-ui-tests.log`。
- `pnpm run test:customer-service`：使用原 `customer-isolated-test-guard.mjs` 全链执行，退出码 0；日志 `restored-ui-service-tests.log`。测试中的预期网络拦截日志不代表外部请求成功。
- `tsc --noEmit`：通过。
- `ARCHITECTURE_BASE_REF=89b17510 node scripts/check-architecture.mjs`：通过，包括 ratchet。
- `pnpm run build`：通过，Studio chunk 368838/485000 字节；既有大 chunk 提示未放宽门禁。
- `git diff --check`：通过。

浏览器实测完整应用 `http://127.0.0.1:5225/?page=conversion`：登录有效、四分类和三栏正常，资料/标签/订单可打开，批量入口显示当前无客服任务，微信客服原页面显示未配置。没有伪造运行、绑定、客户或发送回执；未在真实渠道执行任何动作。

前端 5225、后端 9025。后端重启后健康检查 200、源码 SHA 为 `89b17510`、role=web、startupIssues=[]，原本地账号会话接口 200。当前预览后端预加载原网络隔离 guard，阻止外部 HTTP 请求；配置和数据位于忽略的 tmp/data，不作为生产 Ready 证据。

## 保留的扩展与外部条件

先前较宽范围的实验改动已完整保存在 `tmp/customer-service-preview/deferred-extensions-20261024/`：`manifest.json` 记录原文件 SHA256，`all-changes.patch` 和 `files/` 保存补丁及新增文件。它们未纳入当前生产源码或交付范围，不代表已完成验收。范围收敛使用自身增量的精确逆向补丁和已校验新文件快照，未使用 reset、clean、stash 或修改其他工作树。

当前本地账号无真实客户和客服周运行，微信客服未配置。真实渠道授权、原发送路径的真实回执验收，以及自动入站、媒体和归因等新能力，分别属于后续配置/验收或新增功能，不能把本次入口恢复描述为这些项目全部完成。

未调用真实渠道，未合入基线，未推送、部署或执行目标库迁移。
