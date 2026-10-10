# 卡片点击专项验收（2026-10-10）

本项只新增隔离测试，不改主功能，不提交原有脏文件。Google Chrome 本地 headless 实测。

## 命令与已通过边界

```sh
cd /Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow
export PATH=/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/agent-card-click-ui.mjs
```

挂载真实 `AgentWeeklyCalendar`，通过 Playwright 点击卡片、真实任务详情、真实动作按钮；断言关闭模态并将完整目标身份传入真实组件回调。12 个正向路径覆盖 11 类（Messenger 与 Instagram 分开）；缺失生产绑定的卡片不暴露操作按钮。所有 API 被拦截并断言零调用，零页面错误。fixture 不执行发布、发送、报价、预算变更。

这证明 DOM 点击和组件回调，不能证明目的面板或 App 已加载。不能将此 PASS 写成端到端全通过。Vite 当前提示 `transformWithEsbuild` 已弃用，运行没有失败。

## 目的面板合同清单（初始 seam 边界；实测结果见文末）

以下目的地来自阅读 `ConnectedAgentCalendar` / `WeeklyCustomerCalendar` 的实际路由分支；静态源码证据不等于浏览器验证。新增 harness 故意保留 callback observation seam，没有伪造“目的面板已打开”。

| 类别 | 真实目的地/合同 | 浏览器结果或待补断言 |
| --- | --- | --- |
| 发布执行 | `WeeklyPublicationExecutionPanel`，真实执行 task / publication / account | **AC-PUB-ROUTE 实测失败**：库存来源发布卡进入库存面板 |
| 库存复用 | `inventory-workspace:<tenant>:<program>:<package>:<version>:<binding>` | **实测通过**：指定记录存在、publication 匹配、focus 命中 |
| 跨周素材 | `crossWeekMaterialPanelId(scope, continuationId)` | 原 request / 新 consumer dataset 相符，定位实际核验面板 |
| 客服知识/报价补齐 | `customerExceptionPanelId(item)` | request / run / item / member 身份及 submission / verification 区分 |
| 发布恢复 | `publicationRecoveryPanelId(scope, id)` | task / publication / attempt 原记录匹配并定位 |
| M/IG 恢复 | `nativeRecoveryPanelId(scope, id)` | 原 run / task / request / channel 匹配，两渠道分别定位 |
| WA 恢复 | `requestPanelId(scope, id)` | 原 item / run / task / whatsapp 全身份匹配 |
| 销售交接 | `WeeklySalesHandoffPanel` 与 `revealWeeklySalesAction` | 原周交接、客户、成员、claim / feedback 动作定位 |
| 内容生产 | `readWeeklyContentNavigation` → `lingshu:navigate` → App | 实际 binding GET、project / artifact 血缘、App 页面及精确内容定位 |
| 人工素材 | `openMaterialPanelRequest` → `WeeklyMaterialRequestsPanel` | 原 request / consumer 身份一致、上传和核验分支定位 |
| 客服运行 | `openCustomerCalendarTask` 或真实 customer execution panel | 原 run / workflow task 与 projection 一致，实际 App/panel 可见 |

## 失败/限制清单

- **AC-DEST：库存以文末实测为准，发布路由失败，其余 9 类未证明。** 不能据本测试批准完整点击到 App 的验收。
- 全类 Connected fixture 需要项目上下文、冻结周包、租户/token、真实执行任务及各分支 GET 投影；当前 Connected harness 覆盖库存/发布两分支，基础 harness 覆盖日历组件身份回调。
- `customerRunId` 的正向 callback 不证明 `WeeklyCustomerCalendar` 对原运行绑定的校验；同理 sales 和 material 正向 callback 不是最终权限/血缘证明。
- 没有用真实账号操作，未证明真实会话或外部 App 可用性；没有运行发布/消息动作。
- 当前测试主要以 id / exact data 深比较验证回调，没有对手机布局做断言。

后续应在只读 GET mock 下挂载完整 Connected + App，让每类卡片对应完整服务端形状的原记录；同时校验错误租户、错周版本、缺失 panel 时拒绝导航，所有非 GET 请求立即失败。

## 实际 Connected 目的面板验证及失败复现

```sh
node scripts/agent-card-click-connected-ui.mjs
```

此命令预期 exit 1，保留回归失败 **AC-PUB-ROUTE**。使用真实 ConnectedAgentCalendar 与真实库存面板，以及隔离服务 confirm/revise 生成的 bound 库存记录；仅替换 SocialProgramContext 的项目选择和 mock GET。

库存审批卡实际已通过：原卡片 → 真实详情按钮 → bound inventory panel → 精确 binding 的 focus，data-publication=next。因此上表库存行的未验证状态已由此实测覆盖；其余 9 类目的面板仍未完成。

发布卡实际失败：真实投影同时含 inventoryTarget 与 publicationExecutionTarget，Connected onOpenContent 先处理 inventoryTarget，使“查看真实发布安排与平台尝试”按钮错误定位库存面板。publicationPanelCount=0、publicationDetailGet=false；focused=`inventory-workspace:t:p:week2:2:45c59d520cf7a42`。未修改主功能，保留失败断言供修复后重跑。

两个 harness 均只允许临时 Vite origin 的 GET/HEAD；外网与所有写请求立即阻断并计为失败。Connected 未覆盖辅助 GET 返回 404，已知空列表仅隔离非目标分支。不能把局部辅助面板缺口当作全 App 通过。每次运行输出源文件 SHA256。

运行时遇共享源码 salesTarget 合同同时加强，已补全验收fixture身份；未修改该功能。Vite 扫描其它脏组件语法与 React 重复优化问题，通过独立 cache、dedupe 与限定扫描解决。
