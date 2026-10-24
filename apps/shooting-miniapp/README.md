# 灵枢拍摄任务小程序（开发版）

这是独立的原生微信小程序前端，用现有账号密码、企业身份、待拍任务和素材接口。不会创建第二套账号。首版只覆盖待拍分镜的查看、拍摄或选视频、上传和任务关联；网页端的通用需求、灵感发现、素材管理与 AI 生成仍在网页端。

## 本地打开

1. 用微信开发者工具导入此目录。`project.config.json` 已填写用户提供的小程序 AppID `wxe47d8e0f74fe1403`。
2. `config.js` 的 `apiBase` 已按用户确认配置为正式服 `https://app.lingshu.site`。配置中不放 token、密码或密钥。
3. 将 `https://app.lingshu.site` 配置为微信公众平台的 `request` 合法域名，再用现有正式服企业账号登录。

## 环境对应关系

| 用途 | 服务地址 |
| --- | --- |
| 正式服（当前小程序配置） | `https://app.lingshu.site` |
| 测试服 | `https://lingshu.site` |
| 售前 | `https://preview.lingshu.site` |

以上对应关系由用户于 2026-10-04 确认。

## 上传与关联

- 上传复用 `POST /api/overseas/studio/materials/file` 的二进制接口，成功后调用 `POST /api/overseas/studio/shooting-tasks/:id/uploads`。任务与素材均由后端按企业身份校验。
- 为控制小程序内存，首版视频限制 30 MB。网页端仍支持服务端允许的 100 MB。小程序当前显示“读取/上传中”阶段，只有服务端确认保存后显示完成。
- 如果视频已入库但任务关联失败，页面提供“重试关联已上传的视频”。退出页面前应完成重试。

## 上线前验证

需要真实 AppID、HTTPS 服务域名、微信后台合法域名配置，并在真机测试相机、相册、30 MB 视频、弱网重试和账号权限。当前代码没有发布或部署。

## 移动工作台（2026-10-10 开发中）

默认入口已改为 `pages/workbench/index`：待处理 / 工作 / 助手，默认进入工作。原拍摄功能保留在 `pages/index/index`。微信开发者工具仍导入本目录。

工作台复用 `digital-employees/overview`、任务 workspace、审批、重试、发布 calendar 和社媒 interactions；权限继续由已有服务校验。曝光暂缺严格周口径时显示未知。询盘暂为按客户标识聚合的记录浏览；助手是文字问答与录音转文字，尚不从自由对话提交业务动作。待处理队列独立于选中的统计周；稍后设置通过后端按企业和用户保存，聊天历史仍保存在本机。移动端保持统一入口，内部兼容现有工作台投影和命令接口。

新增录音转写接口为 `/api/overseas/mobile-workbench/transcribe`，复用后端千问配置与额度检查。本地代码尚未部署到 `config.js` 当前指向的服务，旧服务会明确返回功能不可用。请使用可访问的 HTTPS 开发服务做联调，不在配置内填写密钥。

自动测试：`node --test apps/shooting-miniapp/workbench.test.cjs`。仍需微信开发者工具编译及真机测试登录、三 Tab、滑卡阈值、弱网、版本冲突、麦克风权限和录音识别。

本轮新增 `/mobile-workbench/queue`、`/mobile-workbench/snooze`，以及既有工作台命令链路下的移动队列适配。后端租户与用户由登录令牌解析，客户端不传作用域。需应用 `pb_migrations/1791597600_mobile_workbench_snoozes.js` 后联调；本次未执行生产迁移。新投影未提供严格周统计时显示未知，不将当前周期数字冒充本周数字。结构化业务资料表单、完整询盘对话和真机联调仍需补齐。

新增验证：`node --import tsx --test server/routes/mobileWorkbenchQueue.test.ts apps/shooting-miniapp/workbench.test.cjs`。

体验验收增加 `apps/shooting-miniapp/workbench-experience.test.cjs`，上线队列验收增加 `server/routes/mobileWorkbenchQueue.release.test.ts`。兼容工作台的查询先展示真实快照；只有独立“提交工作指令”确认后才向后台提交，避免问进度时启动工作周期。最新整合 23 项测试通过；全仓类型和迁移检查尚有同期其他修改的阻塞，详见上线审查文档。

## 与网页端统一的视觉主题（2026-10-11）

本地联调模块位于 `local-integrated-flow/apps/shooting-miniapp`。所有原生页面使用 `styles/tokens.wxss` 与 `styles/components.wxss`，按现行全系统 UI 规范共享网页端的色彩、字体、圆角、控件和动效。工作台、助手、拍摄与审批采用白底黑灰正文、中性导航、蓝紫主按钮与发出消息；反馈保留成功、警告、错误语义。原生小程序不直接加载 React/Ant Design 组件。

后续页面应复用该主题；勿再添加页面专属主色。主题通过 `app.wxss` 提供变量，页面末尾导入共享组件样式。尚需在微信开发者工具及真机检查 390px 布局、文字放大、输入聚焦、禁用按钮与底部安全区。

## 网页与小程序共享代码

在仓库根目录运行：

```sh
pnpm run sync:mobile-shared   # 修改共享源后生成两端产物
pnpm run check:mobile-shared  # 只检查，不写文件
pnpm run test:mobile-shared   # 共享行为、原生包依赖与相关网页测试
```

网页开发和构建入口会先检查生成文件是否同步。修改共享源后，先生成，再测试；微信开发者工具导入本目录前也要检查。生成文件需随共享源保存，不能手工修改。

| 唯一维护源 | 网页消费 | 小程序消费 |
| --- | --- | --- |
| `shared/design/tokens.json` | `src/lib/designTokens.generated.ts` → `designTokens.ts`、主题 Provider 和共享样式 | `styles/tokens.wxss` → 页面和 `styles/components.wxss` |
| `shared/mobile-domain.mjs` / `.d.mts` | 数字员工页任务状态、上海日期与排期角色文案 | `lib/generated/mobile-domain.js` → workbench、agentSchedule |
| `shared/request-policy.cjs` / `.d.cts` | 生成 `shared/request-policy.mjs` / `.d.mts` → 助手审批 API、账号请求锁 | 生成 `lib/request-policy.js` → API 错误解析、助手回执终态 |
| `shared/action-form.cjs` / `.d.cts` | 生成 ESM → 审批意见、分镜选择与费用输入校验 | 生成 `lib/action-form.js` → 行动表单字段与 payload |
| `shared/weekly-work-status.mjs` / `.d.mts` | `src/lib/weeklyWorkStatus.ts` 薄适配 → 周运行状态 | `lib/generated/weekly-work-status.js` → 单项任务状态与详情卡点 |
| `shared/materialTaxonomy.ts`、`shared/shootingWorkflow.ts` | 网页直接消费；拍摄工作流保留原路径兼容导出 | TypeScript 生成 `lib/materialTaxonomy.js`、`lib/shootingWorkflow.js` → 拍摄详情和上传素材说明 |

生成器分别为 `scripts/generate-design-tokens.mjs`、`scripts/sync-mobile-domain.mjs`、`scripts/generate-miniapp-request-policy.mjs`，总入口为 `scripts/sync-mobile-shared.mjs`；均支持 `--check`。共享模块不依赖 React、DOM 或微信 API，小程序运行时不引用包外源代码。

网页和小程序继续使用各自现有接口、网络和设备适配器。两端已共用错误解析；版本命令和账号请求锁目前由网页消费，回执终态目前由小程序消费，它们均由同一平台无关策略源提供。审批对象版本、明确确认、幂等重试与真实执行回执保留；发布日历的海外冻结时区不改成上海时区。当前共享状态文案和请求基础，不将完整网页工作台或自由对话动作执行器移入小程序。

第二批生成器为 `generate-miniapp-action-form.mjs`、`generate-miniapp-work-status.mjs`、`generate-miniapp-material-shooting.mjs`，已接入同一生成与检查入口。素材和拍摄模块由仓库既有 TypeScript 编译器生成独立原生模块，不增加运行时依赖。

- 表单基础统一字段标识、必填、字数、数值上下限、HTTPS链接和选择ID归一化，空费用不会被当成0；完整分镜资格、费用授权、版本与确认继续由原业务流程和服务端处理。
- 运行状态统一准备、等待、受阻和终态规则。小程序只有跨运行任务投影时只展示单项状态；不会由这些任务计算虚构的周运行或完成量。详情收到最新 workspace 后清除旧状态、阻塞说明、下一步及结果。
- 拍摄详情共用声音要求、稳定绑定元数据提示和素材分类。手机上传成功表示素材与任务关联，不表示原草稿镜头已经回填；网页仍核对草稿版本、拍摄要求和已有画面，避免自动覆盖。
