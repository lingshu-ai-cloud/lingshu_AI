# 小程序主页面、子页面按钮与后端核对

日期：2026-10-26（Asia/Shanghai）。工作树 `/Users/julia1/Documents/ChatGPT/1026小程序`；分支 `feature/miniapp-fixes-20261026`；HEAD `ee2654459435a83bfb1ae845a4cf2a118eabe469`。核对对象包括此前未提交的小程序改动，本轮没有修改业务代码、数据或集成基线，仅增加此审计记录。结论：部分读取链路接通，存在已复现断点，不满足所有按钮真实链路验收。

## 范围与证据等级

当前入口为 Hi 灵小枢、我的素材、我的客户；沿实际按钮追踪助手历史/账号设置、内容任务详情、素材拍摄、相机、客户会话及报价面板。另查看仍注册的旧工作台、成片页及通用动作页，不能因注册了路由就视为已从当前三个 Tab 完整验收。纯前端菜单、搜索、筛选、切换相机等无需单独后端接口。

“HTTP 通过”仅代表当前本地服务返回了实际可解析数据；“离线通过”使用隔离测试、fixture 和模拟依赖，不代表真实模型、相机、存储写入或社媒送达。当前服务为本地 8896，未调用生产环境。

## 页面与按钮矩阵

| 页面 / 按钮组 | 对应链路 | 本轮证据 / 结论 |
| --- | --- | --- |
| 底部三个 Tab、返回、新对话、菜单、历史标题搜索 | 本地路由、状态与过滤 | 前期开发者工具点击通过；本轮静态核对路由均注册；无需业务写接口 |
| 账号设置、退出 | GET auth/me；本机清除 token | auth/me 200；退出为本地动作，普通密码登录本轮未重新验证 |
| 助手历史列表、选择历史继续交流、未读 | GET mobile-workbench/assistant/sessions 和 messages | 列表 200，有 4 个会话；已有开发者工具历史恢复/清未读证据；隔离测试通过 |
| 文字发送、四张快捷卡片 | POST sessions、assistant/query；GET messages/context | context 200；本轮未再次调用付费模型；沿用前期真实文字问答证据。四张卡片发送普通问题，不等于启动四项业务任务 |
| 助手“查看操作方案 / 确认执行” | POST assistant/preview、mobile-workbench/actions；GET receipt | 接口及领域执行器存在，权限、版本和回执测试通过；未提交实际审批/重试，不宣称真实执行验收 |
| 语音切换、按住录音、转文字 | 微信录音权限与 POST mobile-workbench/transcribe → Qwen ASR | 有实现；本轮未调用真实麦克风或 ASR，文字模型可用不能证明 ASR 可用 |
| 内容任务详情、成品预览 | GET assistant/content-tasks/:id、social-content/tasks/:id/artifacts/:id/media | 路由存在，隔离内容链路通过；当前助手 currentContentTask.availability=empty，无实际对象完成按钮验收 |
| 采纳版本、要求修改、生成/下载交付包 | artifact decision、delivery-packages、私有下载 | 有版本与幂等契约；内容领域集成入口通过；未操作当前企业数据、未完成真机保存/打开交付包验收 |
| 我的素材、刷新、筛选/文件夹/相册/搜索 | GET studio/materials?scope=own&purpose=library + 本地投影 | 200，81 条；元数据读取通过，但其中 80 条媒体地址返回 404，不能视为素材可用 |
| 去上传 | 微信 chooseMedia → POST studio/materials/file → 自动分析 | 相册选择、上传接口与后端入库实现存在；此调用方传入了进度回调。未进行实际新上传/入库/自动分析验收；现有记录含 1 条分析 failed，80 条无可确认分析状态 |
| 去拍摄、刷新/筛选拍摄任务、选择任务 | 路由 shooting；GET studio/shooting-tasks | 200，4 条任务（3 条没有上传素材，1 条有关联素材）；列表读取通过 |
| 对标片段、重新加载片段 | GET studio/projects/:id、POST shooting-tasks/:id/reference-preview、媒体播放 | 有后端裁剪与归属校验，隔离测试通过；本轮没有创建新裁剪文件、逐条播放或真实来源素材验收 |
| 从相册选择、重新关联已保存素材 | POST materials/file、shooting-tasks/:id/uploads | 有实现和隔离测试；已保留 pendingMaterialId 的关联重试；本轮未执行实际写入 |
| 打开相机、前后摄像头/闪光灯/平台安全框、开始/结束录制 | 微信 camera API → uploadVideo → attach | 微信设备功能尚未真机验收；保存路径发现确定阻断，见 P1-1 |
| 我的客户、搜索/筛选、刷新 | GET customers + 本地过滤 | 200，但 items=[]；仅证明请求正常，无法证明客户详情、回复、报价可操作 |
| 客户资料、会话搜索 | 客户列表中找到记录后本地展示/过滤 | 有实现；当前账号无对象，未逐按钮运行 |
| AI 推荐回复 / 换一批 | POST agents/conversion/draft，再翻译中文释义 | 有后端，但前端失败后使用固定文案伪装为 AI 推荐，见 P1-3 |
| 中文输入自动翻译、发送文本 | POST plugins/translate/run → customers/:id/outbox | 当前前端请求头/体回放翻译返回 404；失败时允许发送原文，见 P1-4。真实渠道发送未执行；后端另对 WhatsApp 直接 outbox 返回 unsupported |
| 智能报价、编辑/保存、人工确认、预览卡片、插入回复、发送卡片、新版本 | quote-skill availability/catalog/latest/drafts/PATCH/confirm/card/reply/send-card | availability=enabled，catalog 41 条；报价领域隔离测试通过；当前没有客户对象，未创建真实报价或发送卡片 |
| 旧成片页、旧工作台/通用动作页 | digital-employees/overview、mobile-workbench/queue/overview/matters/actions 等 | overview/queue 返回 200；旧成片页主要为队列/播放，不是等同内容任务页的验收操作。没有从当前 Tab 逐一完成遗留入口及写操作验收 |

## 已复现问题

### P1-1 相机结束录制后的上传被进度回调异常阻断

`packages/operator/camera/index.js` 的 finishRecord 调用 api.uploadVideo 时没有传入第二个进度回调；`lib/api.js` 的 uploadMaterial 在读取分片后及上传成功时无条件调用 onProgress。使用真实 api.js 加模拟微信文件读取、无真实网络/磁盘写入复现：`onProgress is not a function`，networkCalls=0。实际异步微信回调中还可能表现为未捕获异常/界面停留在保存中。现有 camera-page 测试模拟 uploadVideo 返回成功，未覆盖真实 api.js 组合。

### P1-2 元数据已经恢复，但 80 条图片媒体不可读取

当前本地素材列表 81 条：80 条图片、1 条视频。对本地相对媒体地址逐条 HEAD：200=1、404=80；视频 Range GET 返回 206，图片抽样 Range GET 返回 404。失败图片引用 `/media/tenants/.../rongshang-products/...png`。只能确认当前 URL 不可读，尚未确认是文件缺失还是静态目录映射不匹配，不能凭目录名直接恢复/覆盖数据。

此外，本地 apiBase 是 HTTP 回环地址，assetUrl 会把相对地址转为 HTTP；此前开发者工具已有图片 HTTP 不受支持警告。文件恢复后仍需独立验证微信媒体加载及正式 HTTPS 配置；本机 127.0.0.1 配置不能直接供手机真机使用。

### P1-3 AI 推荐失败被固定回复掩盖

`packages/operator/conversation/index.js` 的 loadRecommendations 捕获异常后仍填入两条固定英文回复，并在 UI 标为 AI 推荐；接口返回不足两条也会补固定文案。隔离模拟接口失败后仍得到 recommendationCount=2。因而界面显示推荐不构成后端模型调用成功证据。

### P1-4 翻译失败后可能直接发送中文原文

translateDraft 捕获失败只取消 loading；send 使用 translatedDraft || original。隔离复现翻译失败后捕获到发送正文为中文原文，未进行真实发送。本地按 api.js 当前 header/body 回放翻译接口返回 404/not_found。预览兼容层要求受控本地 Origin/模拟开关、mock customerId 和 manualRequest 等，当前通用翻译调用没有这些字段；不能通过放宽隔离来掩盖契约不匹配。550ms 防抖启动前也存在译文未就绪而发送的窗口。应明确翻译失败/处理中与实际发送语言，避免静默降级。

## 当前运行限制

- GET /api/overseas/ready 返回 HTTP 503、status=degraded；issues 为 `pocketbase_unavailable_or_unmigrated:isolated_test_network_blocked` 和 `social_operating_worker_unready:heartbeat:missing`。这是本地隔离预览，不能用读取接口正常推导持久化生产库、后台 worker 或全任务链就绪，也不能直接归因于生产数据库损坏。
- 本轮没触发真实客户发送、报价承诺、审批/重试、付费生成、OAuth、生产数据恢复或迁移。无新增外部 run/task 标识。
- 页面退出继续处理的文字请求依赖现有服务进程存活；不代表服务重启后自动续跑或所有生产任务已被 worker 执行。

## 本轮实际验证

- `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`：151/151。
- `node --import tsx --test server/routes/mobileAssistantSessions.test.ts server/routes/mobileWorkbenchAssistant.test.ts server/routes/mobileWorkbenchActions.test.ts server/routes/shootingTasks.test.ts server/routes/shootingReferencePreview.test.ts server/routes/quoteSkill.test.ts server/digitalEmployees/customerChannelSendRequests.test.ts`：38/38。
- `node --import tsx --test server/starter198/socialContentAssistantDelivery.integration.test.ts server/starter198/socialContentWorkflow.test.ts`：2/2 测试入口，包含隔离内容流程/文件/权限/幂等/交付包断言，不是真实供应商 E2E。
- 本地 HTTP、媒体 HEAD/抽样 GET、上传与客户会话隔离复现结果见忽略目录 `tmp/miniapp-preview/button-audit-*.{json,log}` 及 `audit-*.{mjs,cjs}`。辅助脚本不属于业务源码，不保存认证 token；不得把带签名的媒体地址复制进报告。
- 本轮业务代码零修改，不重复将上轮 TypeScript/架构结果标为本轮重跑；提交前仍应运行 diff 检查。没有运行全仓 quality/verify。

## 建议处理顺序与恢复点

先修相机真实上传组合与失败恢复，再查清并恢复图片文件/静态映射，随后移除 AI 失败伪成功和翻译静默原文发送；用隔离 fixture 覆盖这些组合断点后，再对有明确对象及授权的实际任务、客户渠道和报价发送做单项验收。本次只是核查，没有擅自修复、删除或覆盖数据。源码恢复参照为上述 HEAD，已有未提交改动须原样保留；无需执行迁移或恢复命令。

后续修复与复测已记录于 [按钮链路修复记录](miniapp-button-fixes-2026-10-26.md)。本审计中的缺陷描述保留为修复前证据，当前状态以该记录为准。
