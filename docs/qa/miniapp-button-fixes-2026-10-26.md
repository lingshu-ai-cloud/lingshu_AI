# 小程序按钮链路问题修复与复测（2026-10-26）

工作树：`/Users/julia1/Documents/ChatGPT/1026小程序`；分支 `feature/miniapp-fixes-20261026`；HEAD `ee2654459435a83bfb1ae845a4cf2a118eabe469`。本轮在此前未提交修改上修复按钮核查发现的问题，保留其他改动。没有提交、推送、合并、推进基线或部署。

## 修复内容与文件

- `apps/shooting-miniapp/lib/api.js`：进度回调可省略，相机保存不再在真正发出上传前报错；私有图片通过带 Bearer 的受控本服务下载取得本地文件，不把凭据发送给第三方图片地址。只扩展既有私有下载白名单至已有媒体命名空间。
- `packages/operator/camera/index.{js,wxml}`：上传后保留素材 ID；关联失败可点击“重试关联”，不会再次上传；页面销毁后的迟到完成不再把其他页面导航返回。未进行真实设备拍摄。
- `packages/operator/materials/index.{js,wxml}`：图片与封面通过鉴权下载后展示，最多四个并发任务，同一刷新内相同 URL 共用下载。失败显示不可读取，不把旧 HTTP 图片 URL 恢复回界面。
- `packages/operator/conversation/index.{js,wxml,wxss}`：删除 AI 推荐失败后的固定文案补位；部分成功只显示实际结果并说明；后端 degraded 回退不冒充成功生成。翻译防抖一开始即进入等待，错误、空译文、旧草稿译文均禁止发送；错误可重试；晚到的旧译文不会覆盖当前草稿，历史翻译也不会抹掉新消息。
- `apps/shooting-miniapp/config.js`、`config.example.js` 与 `lib/api.js`：回环开发地址显式使用既有白名单 Origin；模拟客户翻译传递既有 `customerId/manualRequest` 契约。生产 HTTPS 请求不携带本地 Origin，没有修改后端身份、来源、模拟客户、人工操作或网络隔离限制。
- 新增 `api-upload.test.cjs`、`conversation-page.test.cjs`、`test-support/native-api.cjs`；扩展 `camera-page.test.cjs`、`operator-materials.test.cjs`。测试使用真实 api.js 组合，覆盖无回调上传、只重试关联、鉴权图片、失败推荐、翻译防抖/失败/过期/重试及迟到历史翻译。
- 扩展 `server/customerService/localPreviewReplyCompatibility.test.ts`：真实小程序 API 序列化经本地 HTTP 进入原有预览兼容中间件，验证翻译与推荐响应，同时保留跨来源、非本地身份、真实渠道和自动操作拒绝测试。供应商为隔离模拟端口。
- 产品 UI 规范 10.13 记录上述失败与恢复行为。

以上 `packages` 路径均相对于 `apps/shooting-miniapp/`。

## 图片与本地运行数据恢复

40 张实际产品原图存在于当前仓库 `fixtures/beauty-showcase/media/tenants/local_tenant_customer_aurelia_beauty/`。既有 `scripts/import-rongshang-local-preview.ts` 明确记录这些原图到当前租户的目标映射。首张图 SHA256 与已存在验收记录一致：`c9673dc0eb6fc0be4dff188ae7a23c520dcfc07054e71f483d666a7608178548`。

仅补齐忽略目录 `data/media/tenants/local_tenant_customer_1b2913131e2c46deab66172228c4df0a/rongshang-products/` 中缺失的 40 个文件；复制前检查同名文件哈希冲突，未覆盖文件，未运行整个导入脚本、未修改企业知识库/素材记录以掩盖问题。恢复清单、哈希和 alreadyPresent 保存在 `tmp/miniapp-preview/restored-image-manifest.json`。

补齐后现有素材服务将可用文件计入目录投影，返回 121 个媒体条目（120 个图片引用、1 个视频引用；多个条目可以指向同一产品原图，不代表 120 个物理图片文件）。全部媒体 HEAD 200。原来 80 个图片引用已可读；开发者工具截图确认来源封面、产品相册和产品原图实际显示，不再仅有元数据。

本地忽略目录 launcher `tmp/miniapp-preview/start.mts` 启用已有 `CUSTOMER_SIMULATION_ENABLED=1`，使原生预览请求进入既有模拟客户契约；启用前版本保存为 `start.before-native-preview.mts`。只重启已有回环 8896 服务，没有关闭隔离或扩大供应商/渠道许可。实际 HTTP 验证：允许来源的无效模拟翻译请求得到 400 `preview_manual_mock_translation_required`，不再因预览模式不一致提前 404；外部来源仍为 404。未向实际模型发送有效翻译请求。

## 实际复测

使用 bundled Node 及其 PATH：

- `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`：**164/164 通过**。
- `node --import tsx --test server/routes/mobileAssistantSessions.test.ts server/routes/mobileWorkbenchAssistant.test.ts server/routes/mobileWorkbenchActions.test.ts server/routes/shootingTasks.test.ts server/routes/shootingReferencePreview.test.ts server/routes/quoteSkill.test.ts server/digitalEmployees/customerChannelSendRequests.test.ts server/starter198/socialContentAssistantDelivery.integration.test.ts server/starter198/socialContentWorkflow.test.ts`：**40/40 测试入口通过**。
- `node scripts/run-customer-isolated-tests.mjs server/customerService/localPreviewReplyCompatibility.test.ts server/customerService/localPreviewAiIsolation.test.ts`：**2/2 通过**，包含真实原生客户端到 HTTP 中间件的翻译/推荐契约及隔离断言。
- `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`（对应 lint）：通过。
- `ARCHITECTURE_BASE_REF=ee2654459435a83bfb1ae845a4cf2a118eabe469 node scripts/check-architecture.mjs`：2868 个生产 TypeScript 文件及预算 ratchet 通过。
- `git diff --check`：通过。
- 本地素材 HTTP 检查：121/121 媒体 HEAD 200；微信开发者工具已确认图片显示。

日志在忽略目录 `tmp/miniapp-preview/button-fix-{targeted,miniapp,backend,native-contract,lint,architecture}.log`，媒体检查在 `button-audit-runtime.json`。首次直接运行预览契约测试因未加载隔离 guard 返回 503；按仓库既有隔离 runner 重跑后通过，没有绕过 guard。

## 尚未验收与恢复点

本轮没有真实客户发送、报价承诺、付费模型调用、OAuth、生产写入、迁移或部署，无新增外部 run/task 标识。客户列表仍没有可用于实际按钮验收的会话，内容任务仍缺少当前可验收对象。真机录制、真实 ASR、真实渠道送达、报价卡送达与供应商 E2E 未运行。

本地 `/api/overseas/ready` 仍为 503/degraded，issues 为 `pocketbase_unavailable_or_unmigrated:isolated_test_network_blocked` 与 `social_operating_worker_unready:heartbeat:missing`。这属于当前隔离预览的数据源/worker 边界，不将其清除来冒充生产就绪。本轮软件缺陷修复及隔离测试通过，不等于所有业务按钮的真实链路验收通过。

源码安全参照为上述 HEAD，当前所有既有未提交修改均保留；撤回须先保存当前补丁，再逐项审阅本轮文件，禁止 reset/clean。本地数据恢复只新增清单中的缺失图片，未经用户确认不删除这些原图；launcher 的上一版备份可供审阅。无需生产恢复或迁移操作。
