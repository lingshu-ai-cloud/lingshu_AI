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
