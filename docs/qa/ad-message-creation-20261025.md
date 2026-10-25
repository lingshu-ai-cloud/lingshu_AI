# 创编地区与聊天渠道前置验收

2026-10-25，工作树 `/Users/julia1/Documents/ChatGPT/1025投流`，分支 `feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。本次为未提交增量，保留已有脏改动，不推进治理基线，不提交/推送/部署。

## 实现

- `PlatformAdsPage.tsx` 删除手填目标市场，国家只选择一次，语言仍在第二步独立设置；`shared/metaMessageChoice.ts` 统一生成摘要。预览不重复展示国家摘要与国家列表。后端 `tasks.ts` 从结构化国家/语言生成 market；没有国家结构的历史 API 记录保留原说明，不猜测其投放地区。
- 新 `AdDraftMessageChannels.tsx` 将主页与聊天渠道放到消息目标的创编第一步。复用 `MetaPageSelect` 和 `MetaLeadFields`，不创建平行授权/绑定接口。`MetaPlanAuditPanel.tsx` 的主页快照按连接身份隔离，旧账户返回不用于新账户自动选择。
- `MetaLeadFields.tsx` 展示真实 WhatsApp 号码、Instagram 用户名及 Messenger 主页身份。未返回关联信息与平台读取失败/权限不足区分；提供 Meta 设置入口与补充授权按钮。仅一个可选 Messenger 时自动关联，多渠道由用户选择；原选择不可用时不静默回退。
- `useMetaDestinationAssets.ts` 在返回页面的 focus/visibility 时只读刷新，保留手动同步；`src/lib/platformAds.ts` 保留服务错误码用于准确区分状态。验证码、登录与新增授权仍由用户在 Meta 完成，没有自动替用户操作外部账户。
- 原配置 JSON 增加 `metaMessage`（主页、目的地、接收身份），不需要新迁移。`platformAdsDomain.ts`、`tasks.ts`、`PlatformAdsOperations.tsx` 完整承接保存、执行预填与复开。换账户清除旧频道，不把号码/专业账户标识交给用户手填。
- 新 `server/platformAds/metaMessageInput.ts` 在原 preflight / execution 链重新读取原授权目录，拒绝临时换主页/目的地、接收账号变化或不可读。执行快照继续保存最终平台参数，原对账仍用不可变快照。旧无配置计划沿用原执行入口，不伪造新配置。
- `platformAds.css` 仅补共享样式下的字段布局；`shared/metaAdObjectives.ts` 改用“聊天渠道”业务文案；用户决定记入全系统 UI 设计规范。不新增联系人负责人、跟进时间或通知方式门禁。

## 实际验证

- 定向 `node --import tsx --test server/platformAds/metaMessageInput.test.ts src/components/MetaMessageChannels.test.tsx src/components/AdPlanWorkspace.test.tsx src/components/MetaLeadFields.test.tsx server/platformAds/metaDestinationAssets.test.ts`：21/21，通过（`message-journey-targeted.log`）。覆盖选择、摘要、保存/复开请求、接收身份、无绑定、权限错误、禁止静默切换、分页及旧任务兼容。
- `node --import tsx server/platformAds/metaLeadExecution.test.ts`：五种目标通过（`message-journey-integration.log`）。消息案例保存 WhatsApp 选择，创建请求省略号码，由服务从既有授权资产补齐；验证预检无写入、创建回执、快照及只读对账。是隔离存储与模拟供应商测试，非真实 Meta 创建。
- 首次领域回归在 `AdWorkflowRecovery.test.tsx` 的浏览器测试环境因没有 document 失败。已补模拟 document/focus listener，并新增返回 Meta 后重新读取和卸载移除 listener 的行为检查；该文件单独回归通过（`message-journey-recovery.log`）。没有跳过或降低断言。
- 修复后完整 `node scripts/test-platform-ads.mjs`：68 个测试文件通过（`message-journey-domain-final.log`）。最终 `pnpm run lint`、`ARCHITECTURE_BASE_REF=dfc9b0c8af85175485cf39370eed92c4be3daedd pnpm run check:architecture`、`pnpm run build`、`git diff --check` 通过；2769 个生产 TS；Studio 367202/485000 字节，原有大 chunk 提示仍在。未执行全仓 quality/verify。
- 真实只读 GET 返回当前主页 `Ads Integration Test Lab`，没有返回 WhatsApp 号码或 Instagram 专业账户；前端显示“未返回已关联信息”，没有改成假绑定或据此宣称账户不存在。没有在 Meta 完成实际新增绑定或扩充授权。

## 本地数据库与浏览器联调

通过独立测试页，实际操作选择加拿大、既有联调账户/主页及唯一可选 Messenger，保存手动本地草稿并从数据库读回：

- Task `xwc65hyboyht7wv`，名称 `聊天渠道流程冒烟·仅草稿·20261025`，版本 1、状态 draft。
- `market=加拿大`，`countries=[CA]`，`metaMessage.destination=MESSENGER`，主页及接收身份均为 `1323567870837055`。
- CNY 总上限 500、日预算 20 仅为测试草稿配置，没有分配或新增平台预算；占位视频没有上传。
- 执行记录 0，实际广告创建按钮因无视频证据而禁用。没有点击真实创建/启动。
- 再次打开编辑和执行区域均保留 Messenger、主页、加拿大及预算。证据 `tmp/ads-preview/message-journey-readback.json`；最终截图 `message-channels-bindings-20261025.jpg`。测试页不覆盖用户原填写页。

## 运行、阻塞与恢复

前端 5237、后端 9037、原 PocketBase 8991。后端日志 `tmp/ads-preview/message-journey-backend.log`，PID 见 `backend.pid`；web 角色，不启动 worker，仍保留 loopback / Meta Graph HTTPS GET 限制。未迁移、调用真实模型、上传、创建或启用平台广告，未执行发布。

当前主页若要使用 WhatsApp/Instagram，用户仍须在 Meta 关联相应商业号码/专业账户并完成权限确认。链接打开 Meta Business Suite 通用设置，用户按页面上已显示的主页名称进入关联账户；不承诺绕过平台登录/验证码。自动刷新已做事件和只读查询验证，未通过一次真实外部绑定完成来验收。Messenger 的主页身份可读不等于其消息设置和广告资格均已平台验收。

恢复点为上述 HEAD 与原位保留的工作区，安全回退只处理本次增量，不覆盖其他投流改动。测试草稿保留原位；没有清理、删除或覆盖其他数据。真实供应商 E2E 仍按稳定基线及明确授权另行验收。

## 账户选择入口纠偏（同日）

- 当前源码 HEAD 仍为 `dfc9b0c8af85175485cf39370eed92c4be3daedd`，功能分支保留未提交改动；未推进集成基线。
- 修复 `AdDraftMessageChannels.tsx`、`PlatformAdsPage.tsx`：消息目标内只展示一个已有账户选择器，复用 `AdPlanAccountPicker`；去掉含糊的“选择或连接账户”。新增广告账户／补充 Meta 授权另行明确标注；WhatsApp／Instagram 的设置链接沿用独立入口。同步 UI 规范与 `MetaMessageChannels.test.tsx`。
- `node --import tsx --test src/components/MetaMessageChannels.test.tsx src/components/AdPlanWorkspace.test.tsx`：15/15 通过；日志 `tmp/ads-preview/channel-account-entry-tests.log`。
- `pnpm run lint`、`pnpm run check:architecture`、`git diff --check`：通过；架构命令未设置 ARCHITECTURE_BASE_REF，本次未运行预算 ratchet。本次仅前端入口改动，未重复全领域测试或构建。
- 浏览器在素材页打开 AI 创编，选择消息会话目标，再选用已有“灵枢联调验收账户 · CNY”：窗口保持创编状态，读取 Ads Integration Test Lab 主页，显示 Messenger 和两个 Meta 绑定设置链接。未进入 OAuth，未保存新计划或创建广告。截图 `tmp/ads-preview/channel-account-entry-fixed.jpg`。
- 当前主页未返回 WhatsApp 号码／Instagram 关联，真实绑定完成后的外部验收仍未执行。未新增外部 run/task。恢复点为上述 HEAD 与保留的本地工作区；本次不改后端契约、数据库或运行保护。

## 创编提示精简（用户标注四处）

- 删除 `AdPlanAccountPicker.tsx` 中可切换币种时的金额不换算提示及账户来源说明；删除 `PlatformAdsPage.tsx` 中手填视频说明、地区自动摘要段落。保存逻辑和自动生成 market 的数据契约不变。
- HEAD：`dfc9b0c8af85175485cf39370eed92c4be3daedd`，未提交功能工作区，无基线推进、数据库修改或外部 run/task。
- `node --import tsx --test src/components/AdPlanWorkspace.test.tsx`：11/11 通过；`pnpm run lint`（TypeScript）、`pnpm run check:architecture`、`git diff --check` 通过。日志前缀 `tmp/ads-preview/create-copy-removal-`；架构检查未启用 BASE_REF ratchet。
- 浏览器确认四处内容均已不在创建窗口 DOM 中；预览截图 `tmp/ads-preview/create-copy-removal.jpg`。未执行真实广告操作。恢复点为当前 HEAD 及原有未提交工作区，本次仅两处组件的文案删除。
