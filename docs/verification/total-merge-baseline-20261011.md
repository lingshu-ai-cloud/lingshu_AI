# 总合并基线审计 — 2026-10-11

## 版本与安全边界

- 原本地 HEAD：`737484c9fcae17cf91c3448fce498ac0ddd4037c`。
- 包含原工作区未提交源码的快照：`43bbc66c38789f81c1ccab8b75ed7e671aef85e0`，保存在 `snapshot/pre-langgraph-20261011`。
- 用户指定远端分支：`origin/吴小姐数字员工大联调`，固定提交 `872f25959b17037c2ab3fc9d13f53a12d4482a6d`。
- 隔离开发分支：`codex/total-merge-langgraph-20261011`。原工作区作为来源保留，不在其上直接改造。
- 快照包含移动工作台、共享生成模块、视频发现错误展示和采集恢复等 53 个源码/测试/文档文件的差异。审计记录在 `work/langgraph-integration/baseline.json`；运行数据、凭证不应纳入源码快照。
- 此任务仅开发与验证；没有部署授权，不运行生产迁移、发布、真实发送或付费生成。

## Git 覆盖证据

通过 `git merge-base --is-ancestor <commit> 43bbc66` 验证：`737484c`、local-unified `9a4595d`、safe-all `40dba2c`、preview-v2 `0941a56` 均已包含。

全部已获取本地/远端分支中，除吴小姐新分支与 `codex/emphasis-shot-aware` 外均为快照祖先。强调字幕分支的 10 个提交通过 `git cherry 43bbc66 codex/emphasis-shot-aware` 全部显示 `-`，即补丁等价已整合，不应重复 cherry-pick。

吴小姐分支新增的非合并提交为 `a3eedd6`、`feaa814`、`872f259`。包含生产恢复、数字员工和发布日历整合、经营指标简化与组件展示调整。

## 模块覆盖矩阵

| 功能板块 | 代码范围 | 验证入口 |
|---|---|---|
| 数字员工、经营规划、日历 | server/digitalEmployees、src/components/smartBusiness | production-entry、weekly-start-feedback、digital-employees、weekly-package |
| 内容/导演/复刻工作台 | server/starter198、contentExecution、videoProduction、studio | managed-replication、storyboard-aigc、production-workflows、studio-media |
| 灵感发现、社交运营 | socialDiscovery、socialPrograms、socialOperating、socialReview | social-programs、r4-social-lineage、weekly-publishing |
| 发布、授权与恢复 | publishing、socialChannels | scheduled-publishing、publishing-truthfulness、social-managed、execution-gaps |
| 助理、知识库、客户服务 | assistant、assistantContext、knowledge、customerService、messenger | assistant-quality、knowledge-policy、customer-service-activation、external-customer-service-demo |
| 企业、素材与存储 | enterprise、storage、素材页面 | material-library、storage-safety、cloud-backend |
| 多租户、账户、权限 | auth、security、middleware、accountHub | tenant-isolation、security-boundaries、frontend-security、account-hub |
| 经营指标与广告 | socialMetrics、platformAds | social-metrics、platform-ads |
| 手机工作台与共享契约 | apps/shooting-miniapp、shared | mobile-shared、mobile-workbench-release-gate |
| 整体构建与静态契约 | package.json、scripts、部署配置 | lint、build、check:architecture、check:container-contract、check:vendored-dependencies |

## 已识别基线问题与修复

### 容器 readiness 契约

`check:container-contract` 首次失败：`deploy/compose.release.yml` 健康检查使用 `/api/overseas/health`，而契约要求检查依赖 readiness。已改为 `/api/overseas/ready`。仅修改配置，没有启动或部署容器。重新运行 `node scripts/check-container-contract.mjs` 通过。

### 架构守卫

首次检查发现 35 个超过预算的生产文件、3 个依赖边界违规文件，以及 1 个过期文件例外。

- 合并前快照的 AiCreateStudio 已达 17,263 行，预算 12,990；studio 路由已达 9,996 行，预算 7,447。因此主要体积债务先于本次合并存在。
- shared/contracts/socialWeeklyScheduleRevision.ts 原从 server 导入类型，违反 shared 独立边界。已将三个无运行逻辑的容量/排期接口原样移至 shared/contracts/socialWeeklyCapacity.ts；原服务路径保留类型重导出，保持调用兼容。两个排期/恢复测试文件共 25 项通过。
- starter198 的 socialDirectorG5ReviewService 与其 fixture 原从 enterprise HTTP 路由导入类型和哈希逻辑。已改用已有兼容端口 server/lib/socialContentLegacyPorts.ts，端口新增原函数重导出；哈希计算与调用行为未变。G5 服务、账户规则与时间线 3 个测试文件共 32 项通过，日志 baseline-director-boundary-tests.log。
- CalendarPlanner 已低于默认 800 行，已删除过期例外。
- 未提高预算、添加排除或关闭守卫。`node scripts/check-architecture.ratchet.test.mjs` 通过；总体 architecture 守卫仍因上述既有大文件体积债务失败；已消除发现的 3 个依赖边界违规和过期例外。

### 完整链路模拟夹具更新

fullChainMock 原夹具仅创建定时任务，没有 social_discovery_runs 可用结果；新的真实采集证明门因此正确阻止下游。夹具现先断言采集等待与分析 pending，再加入租户/范围匹配的合成采集结果。原分析只有 shots 简略字段，现提供冻结 clone master 与 scriptDetails15s 可解析镜头证据，并通过 recommendPackage 创建完整授权结构，明确使用逐项审批、单账号非矩阵模拟。保留 16 节点全部成功、审批去重、完成幂等、网络零调用与外部回执等待断言。fullChainMock 与 customerCreationMock 均通过，日志 extra-test-full-chain-mock-fixed.log。没有修改生产行为或降低门槛。

## 测试状态与解释

首轮广泛测试结果保存在 `work/langgraph-integration/broad-results.json`，原始日志同目录。首轮部分测试存在失败，需按失败原因修复并重跑后才能宣布基线全部通过。当前记录不能视为最终验收。

运行主 `test` 不能覆盖全部独立模块脚本，必须补账户、权限、存储、移动、广告与指标等测试。真实页面验收还需单独记录所看页面与实际行为。

## 部署审计与限制

AGENTS.md 明确开发任务不能默认部署。GitHub 镜像工作流匹配 main 推送和 v* 标签；部署/回滚仅 workflow_dispatch。本次隔离 codex 分支不命中所见自动镜像构建触发器。后续推送前仍应检查届时工作流。

Git 覆盖仅证明已获取历史与固定源码快照的覆盖，不证明其他目录、其他仓库、未保存编辑或新产生的并发修改已经纳入。测试通过也不能证明供应商生产凭证、真实投放和全部数据场景有效。新增并发工作应重新固定版本并审计，不能以文件修改时间盲目取代已验证代码。

## 合并后修复与复测补充

- 修复已付费视频草稿的回放门槛：恢复原供应商产物与最终审核/采用分离，保留租户、方案、首帧、供应商、当前企业事实及视频字节校验；不自动审核或绑定。
- 原周状态实现已迁移到 shared，测试同时验证共享语义和桌面委托。
- 客服资料、助手安全区、OAuth Secret 清空等源码契约更新为现行组件，安全行为断言保留。
- 客户续跑、路由轮询、全链路模拟及广告 schema 的夹具补齐授权读模型、版本/CAS、原生采集依据与迁移前提；不弱化生产门槛。
- 五个原失败完整测试组已复测通过：journey-fixes、digital-employees、execution-gaps、managed-replication、storyboard-aigc；租户/权限/客服/广告组也复测通过。
- 架构守卫剩余问题仅为既有超长文件预算债务，未放宽检查规则。
- 隔离预览 http://127.0.0.1:5189/ 可打开登录页；认证后真实业务页面未验收。用户之前对传入版本的页面验收不能替代本合并版本的页面验收。
- 用户需明确是否允许记录既有架构债后启动 LangGraph。选择尚未收到，LangGraph 运行实现没有开始。

## 最终验证结果

- 固定代码上串行执行 294 个测试文件，602 个测试通过、0 失败、0 跳过；日志 final-serial-tests.log。Studio 多个测试共享 data/materials.json，因此按其原有串行要求运行；并发运行曾产生互相覆盖，未作为验收结果。
- TypeScript --noEmit、移动共享一致性、生产构建、容器 readiness 契约、vendored 依赖检查、架构 ratchet 单元测试全部通过。
- 总体 architecture 守卫仍失败：35 个既有生产文件超过行数预算。已没有导入边界或过期例外失败；构建仍有既有大 chunk 警告。
- 快照所列 53 个原工作区源码文件在最终核查时字节均未变化，本次工作没有覆盖原工作区。
- 验证证明已获取代码历史和上述自动化覆盖，不能证明全量真实页面交互或所有供应商生产数据场景。
