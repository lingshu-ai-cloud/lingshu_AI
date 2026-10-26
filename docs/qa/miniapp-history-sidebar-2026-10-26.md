# 小程序历史会话侧栏交接（2026-10-26）

工作树：`/Users/julia1/Documents/ChatGPT/1026小程序`；分支：`feature/miniapp-fixes-20261026`；当前 HEAD / 源码恢复参照：`ee2654459435a83bfb1ae845a4cf2a118eabe469`。本轮保留已有未提交修改，未提交、推送、合并或推进集成基线。

## 本轮改动

- `apps/shooting-miniapp/packages/operator/assistant/index.{js,wxml,wxss}`：隐藏原生滚动条，左栏依次为标题、账号设置、会话搜索、新对话、历史会话。点击历史记录回到主会话区继续交流。轮询只读结果；离开后释放界面与轮询，新进入默认清屏。
- `apps/shooting-miniapp/lib/assistant.js`：提交过程中退出不取消已发起的问题；捕获会话 ID 和幂等键，避免迟到回调写进新会话。主动选择历史会话时恢复消息，处理中禁止重复发送。
- `server/routes/mobileAssistantHistory.ts`、`mobileAssistantSessions.ts`：从已持久化的输入、匹配回复及所属账号的真实执行回执派生标题、处理中/已完成/待确认等状态。受理回执不等于成功。只有真实有效回复或成功回执才生成完成标识。
- `apps/shooting-miniapp/packages/operator/profile/index.{json,wxml}`：复用账号资料作为侧栏设置子页，移除不存在的 profile Tab。
- `apps/shooting-miniapp/assistant.test.cjs`、`server/routes/mobileAssistantSessions.test.ts`：覆盖退出途中仍提交、恢复处理中会话不重复调用、未读/已读/搜索、租户隔离、真实回复及成功回执。
- 产品规范 10.13 同步此次小程序交互。

## 实际验证

运行时 Node：`/Users/julia1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`，以下命令使用该 Node 及其 PATH。

- `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`：151/151 通过。
- `node --import tsx --test server/routes/mobileAssistantSessions.test.ts server/routes/mobileWorkbenchAssistant.test.ts`：14/14 通过。
- `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`（对应 `pnpm run lint`）：修正新 helper 的类型后通过。
- `ARCHITECTURE_BASE_REF=ee2654459435a83bfb1ae845a4cf2a118eabe469 node scripts/check-architecture.mjs`：2868 个生产 TypeScript 文件通过，预算 ratchet 通过。
- `git diff --check`：通过。
- 微信开发者工具可见验收：主页面没有原灰色滚动条；侧栏按顺序显示设置、搜索、新对话及真实历史；有效结果显示红色 1；打开首条后该条未读消失，其他未读保留。

验证日志：忽略目录 `tmp/miniapp-preview/history-{miniapp-suite,backend-test,lint,architecture}.log`。本轮未新增真实模型调用，没有外部 run/task 标识；未执行真实供应商 E2E、迁移、发布或部署。

## 已知范围与恢复

- 未读按账号保存在当前设备本地；尚无跨设备已读同步。历史列表和搜索沿用现有接口首批最多 100 条；消息沿用最新 50 条的已有接口，不改变持久化记录。
- 页面退出后，已发起 HTTP 请求由现有服务继续处理；不新增任务队列，不承诺服务进程重启后的模型请求自动续跑。没有实际回复的超时记录显示“结果待确认”，不伪报成功。
- 本地预览服务使用既有忽略目录 launcher 和数据，端口 8896；这不是生产运行或供应商 Ready 验收。
- 无需迁移或恢复数据。需要撤回本轮时应先保留当前未提交补丁，再逐文件反向审阅本轮改动；不得用 reset/clean 覆盖同工作树此前的未提交工作。保留原 HEAD 为源码参照，不把它当作包含本轮改动的提交。

## 标题左移微调

按用户截图，将 `packages/operator/assistant/index.wxss` 中菜单的左侧定位改为 0，标题左侧定位从 116rpx 改为 88rpx；移除覆盖菜单绝对定位的重复 relative 规则，保留 88rpx 点击宽度。HEAD 仍为上述 SHA，无外部调用或数据改动。18 项助手测试、TypeScript、架构检查及 diff 检查通过，日志为忽略目录下 `header-left-{test,lint,architecture}.log`。开发者工具 AX 可读；本次截图复核因系统捕捉连接关闭未完成，不声明新的截图验收。恢复可逐项反向审阅这三处样式，不覆盖此前修改。

## 我的客户搜索区布局修复

改动文件：`apps/shooting-miniapp/packages/operator/inquiries/index.{wxml,wxss}`。修正默认原生按钮宽度覆盖造成的搜索框挤压：筛选按钮固定为 88rpx 方形且触控不小于 44px，搜索框可伸缩，输入内容不撑破容器，按钮与输入框高度一致。增加搜索聚焦提示、筛选展开读屏状态，横向筛选条隐藏滚动条。保留客户查询及渠道筛选逻辑。

微信开发者工具截图确认标题和会话数量完整显示、搜索框占满剩余宽度、筛选按钮紧靠右侧且为方形；实际点击验证渠道面板正常展开和收起。`node --test apps/shooting-miniapp/inquiries.test.cjs apps/shooting-miniapp/customer-service-home.test.cjs` 7/7 通过，架构检查及 diff 检查通过。日志为忽略目录 `customer-search-{test,lint,architecture}.log`。HEAD、外部操作状态及恢复方式同上：没有调用供应商或修改数据，撤回只需反向审阅本轮两文件中的具体样式及属性，保留此前未提交改动。

本轮 `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`（lint）通过。
