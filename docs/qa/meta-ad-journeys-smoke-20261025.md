# Meta 五目标流程与前端冒烟联调记录

日期：2026-10-25（Asia/Shanghai）。工作区 `/Users/julia1/Documents/ChatGPT/1025投流`，分支 `feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd` 加未提交功能改动。本轮没有提交、合并、推送或部署，不推进集成基线。

## 设计与实现

业务边界见 [五目标流程](../product/META-AD-JOURNEYS-20261025.md)。共同确认目标、国家、预算、素材/文案/语言、渠道与时间；各目标仅追加真正影响业务承接的页面、应用、表单内容或网站数据源选择。平台编号、优化目标、行动按钮、封面和现有资产关联由产品处理。后续跟进负责人、联系渠道和测试联系不是创建条件。

本轮主要改动：

- `shared/metaAdJourney.ts`：五目标确认责任、客户路径、结果口径和业务完整性规则。
- `src/components/AdJourneyReview.tsx`、`AdCountrySelect.tsx`、`AdGoalExamples.tsx`、`MetaInstantFormGuide.tsx`：右侧业务确认/自动处理说明、地区名称选择、移除过时手填表单编号提示。
- `src/components/PlatformAdsPage.tsx`、`PlatformAdsOperations.tsx`、`src/lib/platformAdsDomain.ts`、`server/platformAds/tasks.ts`：国家/文案/推广页面随草稿持久化并带入执行；不默认美国和日预算 10；仅网站类展示网址；不完整输入禁止实际创建但允许保存草稿。策略自由文本明确为不执行的备注。
- `server/platformAds/metaPlanAudit.ts`、`src/components/MetaPlanAuditPanel.tsx`：可推广主页与用户授权主页交集用于全部 Meta 目标，缺资产不回退手填编号。
- `server/routes/enterprise.ts`：企业 context 读取失败返回稳定 503，避免未捕获异步异常终止整个 Web 服务；失败不返回假企业资料。
- `server/platformAds/metaLeadExecution.test.ts` 扩展至五目标；其余测试覆盖业务信息持久化、空国家/预算、跨计划输入清空、完整输入才允许创建以及企业 context 失败处理。

## 真实前端 → 本地服务 → 原数据库

前端 `127.0.0.1:5237`，服务 `127.0.0.1:9037`，PocketBase `127.0.0.1:8991`。使用已登录测试企业、Lucy Chang CNY 账户以及当前企业的 `Meta integration test - keep paused.mp4`。没有使用外部企业 38 秒视频越权投放。

每项都通过前端实际填写、保存、打开任务、关联素材、现有视频回执复用、封面关联和服务端预检，再经本地 API 只读核对持久化字段。新建五份草稿均保留，不作为已发布广告。

| 目标 | 本地 task ID / 最终版本 | 前端冒烟与持久化 | 预检 / 平台只读检查 | 真实创建与客户行为 |
| --- | --- | --- | --- | --- |
| 网站访问 | `og85856htq24aym` v3 | 通过 | 正确阻塞在主页授权 | 未执行 |
| 视频观看 | `agjd6oqh7i2uqs5` v2 | 通过 | 正确阻塞在主页授权 | 未执行 |
| 消息会话 | `58z8c6qv8il02ov` v4 | 通过 | 正确阻塞在主页授权 | 未执行 |
| 即时表单 | `x5tf2ixizlxgqpe` v3 | 通过 | 正确阻塞在主页授权 | 未执行 |
| 独立站询盘 | `5gvfpkuaf1iq8f3` v2 | 通过 | 正确阻塞在主页授权 | 未执行 |

五份草稿最终读回均为国家 `CA`、日预算 `12`、总预算 CNY `500`、已保存文案和当前企业素材。两个网站目标分别读回 `https://example.com/catalog`、`https://example.com/quote`，其余三个目标网址为空。网址为冒烟测试输入，不代表真实业务承接站点。排期为 2026-10-26 09:00 至 2026-10-27 09:00（Asia/Shanghai）。一次浏览器自动操作在多选浮层中误点英国，已经前端移除并读回确认，没有投放。

已保留 `journeys-browser-smoke.json`（五目标预检文本）、`journeys-persisted-readback.json`（数据库读回）和 `journey-*-review.jpg` / `journey-*-execution.jpg` / `journeys-final-preview.jpg`。这些文件均在 `tmp/ads-preview/`。早期截图仅为中间状态，以最终持久化 JSON 为准。

## 离线联调与命令证据

- `pnpm run test:platform-ads`：最终 **62 个文件通过**，日志 `journeys-platform-tests.log`。五目标隔离存储/供应商夹具验证本地预检、四层暂停创建、不可变快照、精确读回、幂等防重复、只读恢复、租户隔离和审批/托管参数持久化。夹具回执不是 Meta 真实回执。
- `pnpm exec tsx src/components/AdWorkflowRecovery.test.tsx`：13 项通过，日志 `journeys-ui-tests.log`。新增测试先修正跨 VM 数组比较及等待回执加载完成的测试时序；没有放宽业务条件。
- `pnpm exec tsx server/routes/enterpriseContextFailure.test.ts`：通过；存储异常稳定返回 503。
- `pnpm exec tsx server/routes/enterpriseFacts.test.ts`：通过；企业事实版本与完整性回归。
- `pnpm run lint`：TypeScript 退出 0。
- `ARCHITECTURE_BASE_REF=dfc9b0c8af85175485cf39370eed92c4be3daedd pnpm run check:architecture`：2757 个生产 TS 文件通过，基线 ratchet 通过。
- `pnpm run build`：退出 0，Studio chunk 367202/485000 字节；保留既有大 chunk 警告。
- `git diff --check`：通过。未运行全仓 quality/verify，不声明发布就绪。

## 本地运行故障与恢复点

原 PocketBase 进程写入日志为 `unable to open database file (14)`，造成 `datastore_cas_claims` 写入及任务锁失败。先用 SQLite backup API 生成一致性快照，再以原二进制、原数据目录、原 8991 端口及 `--automigrate=false` 重启本地测试库，随后本地租约取得/释放通过，五份草稿读写恢复。没有迁移、清库、恢复旧数据或修改凭据。

私有恢复快照 `tmp/ads-preview/before-local-pb-restart.sqlite` 仅作本机恢复点，不作为对外可共享附件。当前数据库与后台 PID 分别记录在 `pocketbase.pid`、`backend.pid`；启动仍只允许 loopback 请求和 Graph HTTPS GET，未解除真实外部写入限制。

## 已知阻塞与未完成边界

- Lucy 账户可读，但当前账户可推广主页与用户主页授权交集为空。五种目标均显示“当前账户没有可用于广告的授权主页”，创建禁用；没有用手填 ID、切换沙盒或修改权限绕过。
- 真实 Meta 写入还要求已合并冻结基线及相应资产/预算授权；本分支尚未提交。遵守外部 E2E 手册，未调用真实广告创建或上传，也未接受条款或启用广告。
- 本轮没有广告新建四层平台回执、真实客户点击/表单提交 lead ID、消息会话或网站 Lead 回传证据。客户承接路径只完成设计与离线合同验证，没有宣称真实客户链路通过。
- 首次无表单的自动创建、首次新视频全自动准备及审批/托管高级素材参数仍未实现。现有 ready 素材可自动复用，首次绑定仍使用原本地素材流程；这些限制不能包装成“只选目标预算就能完成所有真实投放”。
- 下一实际联调前置：管理员完成账户可推广主页及必要资产授权，正常开发路径固化基线；再按真实目标逐项验证暂停创建、客户承接与结果回收。
