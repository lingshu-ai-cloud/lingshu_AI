# 内容生产跨页与人工素材浏览器验收

执行：

```sh
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/agent-card-smartassets-ui.mjs
# 独立最小内容用例，不依赖人工素材两项
node scripts/agent-card-smartassets-ui.mjs --case content
```

2026-10-10 最新主智能体独立复跑：人工上传、人工核验、内容生产目标均 PASS，完整命令 exit 0，运行前后源码一致。首次内容用例失败后已通知功能会话，修复实际目标分支再复跑，原断言保留。控制 GET 读集是人工隔离 fixture，未声明真实生产执行或实物上传通过。

人工两个动作均从真实 Connected 日历卡打开真实 `WeeklyMaterialRequestsPanel` 内的对应上传/核验面板。逐项验证 `program=p`、`package=week2`、`version=2`、`request=audit-manual-request`、`consumer=audit-content-consumer`，面板可见且具体控件获得焦点；上传与核验各使用独立角色/提交状态。真实路由保持日历页内，没有 smartAssets 跨页事件。这符合当前人工素材路由合同。

内容卡发出的导航保存 `contentTaskId=audit-content-task`、`runId=audit-original-run`、原消费者和周包身份。测试按 App 的实际 smartAssets/create 分支挂载真实 `TrafficPage → AiCreateStudio`，进入统一制作工作台的创作设置；原生产记录面板计数 0、原运行可见计数 0，目标组件没有重新读取原 `production-navigation`。保留断言 `AC-SMARTASSETS-PRODUCTION`，没有通过只检验导航事件或放宽断言掩盖此缺口。

上述首次失败已在最新工作树修复：实际 TrafficPage 消费冻结 weeklyContentTarget 并挂原周生产视图，面板计数 1、原运行可见计数 1。production-navigation GET 共 2 次（Connected 前置核验 + 目标重新核验），原 content task 的内容及待处理活动实际可见。测试同时断言原 task、原 run、目标重验、零页面异常/禁止请求；遇共享源码漂移退出 1，要求稳定后重跑。

源证据：App 的 smartAssets 分支挂 `TrafficPage`；首次缺少周目标分支，最新已接入 `WeeklyContentProductionView`。JSON 保存各实际源文件 SHA256，本验收提交没有修改这些功能文件。

边界：真实日历、Connected 路由、实际目标分支及目标子组件均未替换；只替换经营项目上下文与 GET API 读集。App 完整会话、侧栏、登录与总导航 shell 未挂载，因此不宣称完整 App 端到端验收。所有外域及非 GET/HEAD 请求被拦截；不点击上传、保存、生成、审批或外发写按钮。

证据：`work/agent-card-smartassets/evidence.json` 含逐类 target/identity/visible、导航、实际页面文字、GET 读取、页面异常、辅助缺失 GET 404 和运行前后源 SHA256；同目录有上传、核验和内容页面截图。未知辅助 GET 返回 404，并在 `missingGets` 独立列出，不能将这些未覆盖依赖冒充内容原运行目标失败。失败判据是实际目标已呈现却缺少周生产视图及原运行身份；页面异常和外域/写请求另行报告。
