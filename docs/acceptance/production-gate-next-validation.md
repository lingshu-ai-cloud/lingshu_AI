# 最新共享源码本地独立验收

2026-10-10，首轮起始 HEAD `72281e6877616ffabb41bd589ff9179b6d859218`。AGENTS 已重读，允许本地构建和测试；没有生产 worker、真实账号/provider、发布、外发、付费、部署或迁移。

## 首轮实际结果

以下均已读取命令的实际退出码；TypeScript 空 log 不是通过依据。

| 检查 | 命令 | 实际退出/证据 |
| --- | --- | --- |
| 全量 types | `pnpm exec tsc --noEmit` | exit 0；上轮 4 文件 7 条类型错误不再出现 |
| 主站 build | `pnpm run build` | exit 0 |
| Account Hub build | `pnpm run build:account-hub` | exit 0 |
| 11 类合同矩阵（历史基线 90） | `node scripts/agent-card-acceptance-contracts.mjs` | 本轮逐类日志解析 actual 90 tests、90 pass、0 fail，exit 0；不是假定固定用例数 |
| 7 类 inline 实际目标 | `node scripts/agent-card-inline-ui.mjs` | 11 positive case，exit 0 |
| 内容生产/人工素材实际目标 | `node scripts/agent-card-smartassets-ui.mjs` | 3 positive case（生产/素材上传/核验），exit 0 |
| 销售/客服实际目标 | `node scripts/agent-card-conversion-ui.mjs` | 2 positive case，exit 0 |
| strict 完整 App 返回 | `node scripts/agent-card-chrome-audit.mjs --strict-return-position` | WhatsApp/Messenger/Instagram 三渠道，实际完整 App 回退/刷新/原筛选/原日期/双向 DOM 滚动/登录漂移检查，exit 0 |

实际目标覆盖合计 **11 类、16 positive case**，不与合同 90 tests、strict 三渠道重复累计为业务总数。销售真实路由是同页领取面板，客服为真实 ConversionPage/CustomerWorkflowPanel。目标组件脚本使用受控导航壳及 GET fixture，strict 返回脚本挂载真实 App；都不是外部平台连通或真实业务发布验收。

日志、逐类原始日志/counts、Chrome JSON 与源快照位于 `work/production-gate-next-validation/`。复现 PATH 使用 Codex bundled Node 与 pnpm fallback。

## 冻结 SHA 后统一检查

Parent 批准立即基于 HEAD `737ea81c3368101ba21f344b55d0acb20c435347` 统一复验。本轮所有命令均重新运行，Chrome 没有复用首轮结果。当前统一结果包含真实失败，不能称全面绿。

| 统一检查 | 实际结果 |
| --- | --- |
| types | exit 2：`server/socialPrograms/weeklyContentTemplates.ts(52,3375)` TS18047，`produced` possibly null；原 7 错未再出现 |
| build / build:account-hub | 均 exit 0；build 不替代 types |
| 合同矩阵 | exit 0，逐类实际解析 90 tests / 90 pass / 0 fail |
| inline / conversion | exit 0；11 与 2 positive case |
| smartAssets | 首次 exit 1：动态优化 motion/react 期间 React `useRef` null，周包 combobox timeout；原样独立复跑 exit 0，3 positives，目标 source unchanged。没有修改 fixture 或断言；首次失败保留 `smartassets-first-failure.json` |
| strict 完整 App 返回 | exit 0，三渠道真实 App 的返回/刷新/日期/原任务/DOM 滚动/登录漂移检查 |
| readiness/runtime/keyfile | 10 文件均 exit 0；其中 4 个 TAP 文件实际 10 named tests，另 6 个 legacy assertion 文件无 TAP count。next-readiness 3 + weekly env 2 + probe 3 = 8，keyfile 2 |
| failclosed provider/recovery | 3 文件 exit 0，实际 17 named tests；fake store/transport，network evidence 无 blocked |
| 4 个 Express 路由 | TAP 4/4 pass，但整体 exit 1。contentNavigation 2 次、preArtifact 5 次 PB8090 fetch 被 guard 阻断；另外 2 路由无 blocked。执行期间源漂移也使整体失败 |

PB 调用证据：`socialWeeklyProductionAdapter` / `socialContentOutputs` → `readSocialTaskDetail` → `readMaterialLibrary` → `readCloudMaterialLibrary` → `adminFetch`。注入 memory store 的 repository 默认素材读取仍落到全局 PocketBase authority，不是测试遗漏允许端口。没有放宽网络 guard 或用 stub 隐藏问题；root 接管生产读取 authority 修复，修复后另列复测。

## Authority 修复后的补验

HEAD `89afeeb12ec5795fba5753f27ee5994a18266be5` 加 root 尚未提交的 authority 修复，实际运行 types/build/account-hub/contracts/routes/readiness/providers 与材料原 tests。主站、account-hub、合同实际 90/90 exit 0。4 路由各自 exit 0 且 blocked 0，材料 library legacy assertions + classification 2 TAP + authority 3 TAP 均 pass、blocked 0；首轮补验整体仍因源码漂移失败，包括审计 material runner 新建（此后全部 owned helper 已冻结）及其它组 IG/source 修改。准确证据保存在 `unified/repair-drift-run/`，按稳定源码重跑 guard-only 失败范围。

同次 readiness/provider 有独立于漂移的真实契约失败：IG readiness 实际 `instagram_login_capability_probe_unavailable` 而 737 预期 `instagram_publishing_oauth_provider_unsupported`；capabilities IG Login 断言 unavailable 实际 available；recovery 进入注入的 axios provider 后抛 `wrong provider called`。其它组正在修改 `social.ts`、`platformPublisher.ts` 与 IG tests，应协调新生产契约后验证，不能降级为只有页面或 callback 检查，也不能忽略实际 provider path 变化。此处尚无真实网络调用，所有失败保留。

最后 types 实际 exit 2，已没有 nullguard 错；新 `instagramWeeklyReceiptIsolation.integration.test.ts` 有 6 条诊断：18:85/96 implicit any，32/34/35/39 缺 `publicationPackage`。只重跑 guard-only 的第二次 routes 又遇实际 `ERR_MODULE_NOT_FOUND`：新 `socialWeeklyProducerEvidence.ts` 导入尚不存在的 `weeklyPreproductionProducer.js`，导致 content/preArtifact 失败；其它 2 路由通过，所有 blocked 0。同期源 drift 为 socialPrograms/socialWeeklyProducerEvidence/socialDiscovery/service/socialOperating/orchestration。材料第二次 3 文件仍实际 pass、blocked 0，整体因相同 source drift 失败。未在共享 owner 工作中抢修或持续重跑。`source-repair-before/after.json` 与 `actual-results.json` 界定此轮，不称最新 HEAD 全绿。

统一实际命令/时间/exit 在 `work/production-gate-next-validation/unified/*.result.json`，首次 route 失败完整存于 `unified/routes-initial/`；diagnostic 网络证据包含 caller stack。空 stdout 从未作为 pass 判据。smartAssets 原样复跑后，实际 target 为 16 positive / 11 类，strict 三渠道另列；types/routes 与全局源漂移仍阻止统一全面通过。

计划路由范围独立列出（90 矩阵不等同于实际 Express 路由全覆盖）：

- `server/routes/weeklyInitialSchedule.integration.test.ts`
- `server/routes/weeklyContentNavigation.integration.test.ts`
- `server/routes/weeklyPreArtifactNavigation.integration.test.ts`
- `server/routes/socialPrograms.weeklyCreativeRepairExecutionMount.test.ts`

已阅读 preArtifact fixture：内存 store，生产 start/create 被拒绝，导航走本地 Express/loader；相关出版 fixture 注入假 publishing ports。原 tests 的 `app.listen(0)` 默认全接口，统一验收通过独占 `scripts/production-gate-next-loopback-guard.mjs` preload 强制监听 127.0.0.1，只允许本进程创建的 ephemeral listener 端口与 tsx 精确父 PID IPC；其它 fetch/socket（含 localhost 上真实 Postgres/Redis 端口）阻断，任何尝试记为失败。`production-gate-next-routes-run.mjs` 使用清洁 env，不继承 NODE_OPTIONS/dotenv 配置/供应商凭据/真实 backend URL，且要求 network evidence 存在与测试源前后哈希一致。不修改原路由 tests，也不运行真实 provider。

## 源码范围

首轮 `source-before.json` 固定首轮 HEAD、tracked source SHA256 与 dirty 文件列表。统一 `unified/source-before.json`、`source-interim.json` 通过 `rg --files server src shared scripts` 包含 untracked JS/TS 与 scripts/fixtures JSON，排除 prose/binaries；每个路由/readiness/provider runner 也保存完整源前后 hash，并要求稳定。统一执行期间有 `socialWeeklyExecutionRuntime.test.ts` 漂移；interim 另记录 owner 修改的 runtime、授权、企业事实、人工素材、content template 文件及审计 guard 添加 caller stack。各 Chrome 保存目标源 hash。共享 checkout 持续有其它组 dirty，不称全面冻结审核，不提交。
