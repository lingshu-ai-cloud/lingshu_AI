# 网页待拍来源绑定与小程序预览本地验收（2026-10-23）

## 代码与范围

工作树：`/Users/julia1/Documents/ChatGPT/1023灵枢小程序`；分支 `feature/lingshu-miniapp-20261023`；HEAD `f9cff15fcc4552747697b722ba0d418bdf659e72`，本轮变更未提交、未推送、未部署。

- 三个网页创建入口统一由 `shootingSourceBinding(saved.project, slotId, expected)` 提取已保存草稿的项目、成片组合、稳定生产分镜、画面分镜和要求；草稿保存回执不匹配时停止创建。
- 原 `POST /studio/shooting-tasks` 继续使用已有鉴权、企业隔离及任务存储。后端从权威项目核验绑定，并生成 `referenceClip`；忽略客户端伪造的片段，验证对标视频属于当前企业，不持久化签名 URL。旧调用省略画面分镜 ID 时可从稳定生产分镜补齐。
- 小程序新任务直接使用持久化的视频 ID、参考分镜 ID 与原片起止秒数获取既有媒体签名。旧任务仍使用严格的项目映射；没有来源的旧任务不猜测回填。
- 未改变实拍权限、生产方案、上传与任务关联流程。服务端未开放 `request_shoot` 时，网页继续隐藏待拍入口。
- 共享规则位于 `shared/shootingReference.ts`，原生文件由既有脚本生成。架构预算按文件缩短，从 12000 下调到 11999。

## 环境和数据隔离

使用现有账号 `codex-1002-preview-20261004@local.test` 的正常本地预览登录接口，未读取或输出密码，未伪造令牌。后端为本工作树当前代码，监听 `127.0.0.1:8793`；Vite `127.0.0.1:5188` 代理该服务。

验收目录 `tmp/miniapp-binding-acceptance-20261023/`（Git 忽略）保存账号注册信息副本、独立 local-store、启动文件、日志和验收截图。源数据来自原 local-preview-1002：仅复制该企业原待拍记录、一个真实来源项目和对应视频；未复制后台执行注册或执行队列。进程使用 `PROCESS_ROLE=web`，无全局后台 worker，禁止非 loopback fetch，未调用供应商、发布或部署。

原项目由数字员工管理，保留不动；通过正常 `POST /studio/projects` 保存接口创建标为“本地验收”的独立可编辑草稿，沿用真实脚本、参考视频及逐镜分析。通过正常社媒任务接口新建选择 `shooting_plan` 的任务，再正常保存项目关联。未修改原账号共享存储，未使用上一轮的任务响应适配器。

- 来源视频：`trend_videos_192e76d4b21244c4a2922e60672c95f2`
- 新项目：`studio_projects_ddaadba73418433cba3be82124179443`
- 新社媒计划：`socialtask_e74aca521bf368269dfca5f8`
- 网页创建的真实待拍任务：`studio_shooting_tasks_17dcbb8cbe6540508d5f5567e4b5a64c`
- 绑定：`video-1` / `replication-a02f4572715be742cb42b955` / `slot-8`
- 对标区间：原视频 `12.53–14.00` 秒，参考分镜 `slot-8`。

## 实际验收

1. 浏览器通过已有本地预览认证登录，打开上述草稿和实拍计划，选择工厂科研分镜 8。
2. 实际点击“列入待拍”→“创建待拍任务”。正常保存草稿和 POST 任务成功，网页跳转到待拍列表，显示“分镜 8 补拍”，建议时长 1.47 秒。
3. 核对独立 local-store 的真实持久化记录：四项来源 ID、要求和后端派生 `referenceClip` 均完整；未手工写入任务或伪造接口响应。
4. 微信开发者工具正常登录同一账号，运营版首页显示两个待拍任务。点击新任务卡片，先进入对标预览详情，显示 12.5–14.0 秒、画面要求与拍摄入口。
5. 实际两次点击播放器：第一次媒体时钟 12.53 → 14.025414，第二次 12.742740 → 14.029590；两次结束均暂停并 seek 回 12.53，计时器为空。约 25–30 毫秒为媒体事件采样粒度；没有播放到后续完整分镜。第二次目视确认实验室科研画面。
6. 点击“打开相机”，进入 `packages/operator/camera/index`。相机真实画面正常显示，任务 ID 一致，拍摄指导、1.47 秒、9:16 与“可后期配音”保留；原片预览停止，计时器清除。未录制、未上传；随后返回，关闭相机。
7. 重启本轮后端，重新登录并 GET 任务：完整快照与重启前一致；签名媒体 Range 请求返回 206、video/mp4、1024 字节。原缺少来源的 `studio_shooting_tasks_c447403dc8364555922e3d6cff6c98e1` 保持原样。
8. 联调结束将本工作树 `project.private.config.json` 的 `setting.urlCheck` 明确恢复为 `true`（Git 忽略）。未修改其他工作树的开发者工具设置。

截图：`tmp/miniapp-binding-acceptance-20261023/web-created-task.png` 与 `native-preview.png`。未保存相机个人画面。重启记录：`restart-verification.json`；落盘快照证据：`persisted-binding.json`。截图与日志仅作本地证据，不作为生产验收。

## 验证命令与结果

Node 使用本机 bundled runtime；依赖软链接引用现有基线 node_modules，保留以支持本地预览；未安装或升级依赖。

- `node --test apps/shooting-miniapp/*.test.cjs scripts/mobile-shared-package.test.mjs`：119/119。
- `node --test shared/mobile-domain.test.mjs shared/request-policy.test.cjs shared/action-form.test.cjs shared/weekly-work-status.test.mjs scripts/generate-design-tokens.test.mjs`：22/22。
- package.json 中 test:mobile-shared 的 TypeScript 测试文件，以 `node --import tsx --test ...` 等价执行：61/61。
- `node --import tsx --test server/routes/shootingTasks.test.ts shared/shootingReference.test.ts`：4/4，包括伪造片段、异企业视频、错误分镜、要求冲突、旧分析结构无法映射、持久化重读和上传关联回归。
- `node scripts/sync-mobile-shared.mjs --check`：通过。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `ARCHITECTURE_BASE_REF=f9cff15fcc4552747697b722ba0d418bdf659e72 node scripts/check-architecture.mjs`：通过，2454 个生产 TS 文件。
- `git diff --check`：通过。

本机没有 npm 可执行文件，未将 `npm run test:mobile-shared` 的失败调用记为通过；上述直接 Node 命令覆盖该脚本全部检查。

## 保留与恢复

本地网页和 8793 服务保留供查看，业务数据仅在上述独立目录；小程序配置指向 8793，域名校验已开启，因此后续本地 HTTP 验证需再次按项目临时放行。新测试计划未启动执行，不会产生供应商任务。原共享测试数据、原待拍任务、原服务保持不变。后续可复用同一目录和现有接口继续联调，无需部署或迁移。
