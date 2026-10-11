# LangGraph 试点验收记录

本记录持续更新。仅记录实际执行过的验证；受控本地供应不代表云供应商实测，登录页可达不代表已完成认证页面验收。

## 审核接入核查

生产成片审核应使用 `server/starter198/socialContentRouter.ts` 的 `POST /tasks/:taskId/artifacts/:artifactId/decision`，不是数字员工的发布审批接口。该入口检查写权限、租户身份、请求体及 idempotency-key，调用 `decideSocialContentArtifact`。

`socialContentOutputs.ts` 中的审核应用按 tenantId、taskId、artifactId 查记录，检查 expectedVersion、review_required 状态。approved 分支运行 `assertStudioSocialArtifactGeneration`，记录 approved、新 version、updated_by、last_operation_id，然后协调任务状态。重复请求经持久化操作记录重放。changes_requested 会进入原有返工桥接/队列，不得把它解释成图已通过审核。

交付准备 `createSocialDeliveryPackage` 检查 expectedTaskVersion、任务 asset_review/packaging、每份产物 approved、真实生成证据和租户媒体归属。图恢复应从数据库重读审核状态、所选产物 hash/version 和当前方案归属，不接受客户端 approved 标志作为业务依据。

数字员工 `approvalDecision.ts` 的审批属于后续发布/跟进路径：starter 内容发布审批通过后创建发布包任务，运行仍为 waiting_human，明确 externalPublishPerformed=false。LangGraph 视频试点不得以审核通过为由调用旧 advanceRun 或直接发布。

已执行数字员工审批、Starter 审批及集成测试，3 个文件通过，日志 `work/langgraph-integration/approval-baseline.log`。这些是现有审批基线证据；新增 LangGraph 人工审核接入由下表的正式审核、重复恢复和本地完整生产测试验证。

## 故障验收矩阵

| 用例 | 必须观察到的证据 | 当前结果 |
| --- | --- | --- |
| 独立进程重启 | 同一持久 checkpoint 恢复，已完成节点不重新付费 | `langgraphPersistence.test.ts` 跨进程强退与重启通过；持久化为隔离文件 datastore，非生产数据库并发证据 |
| 租户隔离 | 外租户不能读/恢复同一 thread，供应商调用数不变 | 通用图 scope 与实际成片审核外租户拒绝测试通过 |
| 计划版本漂移 | 修改绑定版本后拒绝恢复；保留旧产物 | 通用 checkpoint 版本/inputHash 漂移测试通过 |
| 供应商 receipt 重放 | 接受后故障再运行复用原 taskId 或进入核查，不重新提交 | 实际业务 receipt API 存储后 process.exit(73)，下一进程复用同一 controlled providerTaskId；submit 次数 1 |
| 暂停/取消 | 重读业务控制状态后停止后续副作用 | 实际 context 活跃状态检查通过 |
| 多次人工恢复 | 依赖真实审核记录，多次恢复不重复交付或绕过审核 | 通用图持久化与正式成片审核/重复恢复/交付/完成投影测试通过 |
| 单镜返工 | 重做指定镜头和依赖阶段，保留其他有效镜头 | 既有独立返工/恢复服务 11 项回归通过；scene-graph-seam.log 新增真实独立返工输出接缝 1 项通过，指定镜头 replacement、其他镜头原asset保留，旧图不能接受替代artifact；未宣称迁为 LangGraph 子图 |
| 本地实际生产 | 实际 MP4/音轨/封面、真实渲染和 QA、数据库成片及审核记录 | 实际完整生产通过，含默认FFmpeg合成与QA、受控真实音轨、归档流sha256与MP4解码、正式审核和交付；临时媒体恢复缺陷已修复，日志 local-production.log |

遥测故障测试启用两种 tracing 环境变量并封锁网络。初次发现默认 tracer 仍尝试传输；已修复 engine 的作用域与默认 callback 注册行为，跨进程测试 telemetry=0，通过。后续回归端点固定 loopback，不允许真实远端测试传输。

## 本地生产 fixture 与边界

复用现有隔离租户、方案与素材 fixture；受控供应端生成真实本地 PNG/MP4，记录供应次数。允许本地语音端口生成真实音轨，保留默认 desktop composite、FFmpeg、视觉/场景质量检测、媒体归档与封面生成。禁止把 inspectVisuals/inspectScenes 替换成固定 passed。

图阶段必须调用真实生产应用；生成后核对 MP4 存在、文件 hash、时长、场景数和质量记录。根据真实审核前提调用正式审核应用，再验证图恢复和重复恢复。实际 QA/G4/G5 使用现有业务检测结果，未替换为固定通过。完成投影还覆盖损坏 package_hash 拒绝与重放不重复写事件。

本地完整媒体验收 `scripts/langgraphLocalProduction.test.ts` 使用 macOS `/usr/bin/say` 生成受控音轨，非 darwin 平台显式 skip；通用持久化/隔离/图引擎测试不依赖该语音工具。该 fixture 采用正式默认 entitlement 限额，默认实际渲染、检测、归档与审核服务；对象存储选择 local driver 但读取仍通过正式 object.body 流。

checkpoint 试点仅支持单图/空 namespace，最多 128 个 checkpoint、总序列化 1.8MB；超过边界显式拒绝，不静默裁剪。该容量需结合生产数据库行大小进一步验收，未宣称长期无限执行。图 metadata 仅保留经过白名单校验的紧凑证据字段。

单镜接缝使用已有 outputFixture 的受控检测证据和真实 FFmpeg 文件/业务输出服务；该用例仅验证独立返工与旧图审核身份隔离，不增加完整真实 QA 的声明，完整真实 QA 证据来自 local-production 测试。

最新完整媒体回归 `local-production-pause.log` 1/1 通过（20秒）：真实审核暂停记录 workflow_review，正式审批后显式手动暂停记录 manual；恢复扫描共用的 resumeApprovedSocialProductionGraph 拒绝自动唤醒，job仍 paused；显式手动 resume 后交付与完成投影成功。该测试使用隔离repository调用扫描器的相同canonical helper，未调用绑定默认全局store的scanner。

## 最终工程回归（2026-10-11）

- 合并后全量串行回归：300 个测试文件、620 项通过，日志 `pilot-regression-final.log`。
- 全部修复落定后再跑完整串行回归：302 个文件、622 项全部通过，无跳过，日志 `pilot-regression-latest.log`（167 秒）。
- 手动暂停控制串行租约及完整媒体回归：23/23，通过 `control-final.log`。
- 自生成素材入库修复后重跑真实 PNG 归档、完整 MP4 生产、冻结方案及审核：7/7，通过 `inventory-final.log`。校验视图只过滤入场后本任务新生成的材料，冻结库存和原候选保留。
- 图试点与 MVP 离线 intake 联合测试：24/24，通过 `pilot-mvp-final.log`；MVP 身份、预算、真人审核、交接及页面合同：39/39，通过 `mvp-contract-final.log`。这些计数与全量回归重叠，不相加。
- 最终 TypeScript 检查通过，`typecheck-latest.log`。主应用及 Account Hub 生产构建通过，保留既有大 chunk 提示；冻结锁文件校验通过。
- 架构检查仍报告合并基线既有 35 个超长文件，用户已接受该债务；未增加预算或豁免新边界，不宣称该检查全绿。

用户追加最终 MVP 联调及高质量成片要求。真实本地媒体 fixture 证明执行、合成、技术 QA 和正式审核流程，不能替代真实数字人/AIGC 供应商、创意可发布、真人最终签认、真实平台发布及指标回收证据。最终 MVP 按《缺口与MVP测试》第 5–6、11–12 节独立验收，目标尚未完成。
