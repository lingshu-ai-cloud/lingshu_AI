# 灵小枢助手功能合入本地基线

日期：2026-10-25（Asia/Shanghai）

## 提交与范围

- 目标：`xixi联合功能模块后端改`，工作树 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`。
- 来源：`feature/assistant-reply-quality-20261025`，工作树 `/Users/julia1/Documents/ChatGPT/1025灵小枢外部信息`。
- 合并前 `7801dd0f90ce5b27a52540069b8fbfd330ae654b`；源码集成提交 `59d3fc06e46bdc158a7425eed9f2a00298cccb26`，使用 `git merge --ff-only` 快进，无冲突。本记录与两份治理文档在源码合入后另作治理提交。
- 72个源码、测试、配置示例与文档文件，2336行新增、171行删除。范围为外部信息/证据路由与总体结论、折叠来源；内部具名任务问答与确认后门户、内容创建入口及批量单条草稿；输入栏预填建议、拖入附件、字号与展开后边框。复用原会话、任务、导航和供应商调用边界。详见两份ADR与QA记录。
- 没有修改迁移文件、迁移清单、架构预算或锁文件；不新增生产供应商配置。

## 验证

源码提交上运行33个quality阶段，最终逐项通过，不声明单次quality/verify绿色。首轮 `pnpm run quality` 在第11阶段 `test:gap-v1-release` 的双worker用例因 `durable_lease_integrity_violation` 退出1；该租约实现、worker和用例文件均与7801dd0f同blob。原基线同用例对照通过，功能提交完整重跑第11阶段通过（包含后续视频审批集成）；第12阶段单独通过，第13–33阶段顺序续跑且遇错即停，全部退出0。未修改或跳过并发断言、租约实现或权限门禁。该时序波动保留为已知测试限制。

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `pnpm run check:vendored-dependencies` | 通过 |
| 2 | `pnpm run check:container-contract` | 通过 |
| 3 | `pnpm run test:production-ops` | 通过 |
| 4 | `pnpm run check:architecture` | 通过 |
| 5 | `pnpm run test:architecture-ratchet` | 通过 |
| 6 | `pnpm run test:fixed-yield` | 通过 |
| 7 | `pnpm run check:digital-employee-migrations` | 通过 |
| 8 | `pnpm run test:migration-guard` | 通过 |
| 9 | `pnpm run test:production-governance` | 通过 |
| 10 | `pnpm run test:production-orchestration` | 通过 |
| 11 | `pnpm run test:gap-v1-release` | 首跑并发租约失败，原基线对照通过，完整单项复跑通过 |
| 12 | `pnpm run test:four-platform-release` | 通过 |
| 13 | `pnpm run test:shared-contracts` | 通过 |
| 14 | `pnpm run test:production-runtime-gate-contract` | 通过 |
| 15 | `pnpm run test:production-runtime-gate` | 通过 |
| 16 | `pnpm run test:weekly-golden-journey-contract` | 通过 |
| 17 | `pnpm run test:weekly-golden-journey` | 通过 |
| 18 | `pnpm run test:capacity-harness` | 通过 |
| 19 | `pnpm run test:security-boundaries` | 通过 |
| 20 | `pnpm run test:frontend-security` | 通过 |
| 21 | `pnpm run test:account-hub` | 通过 |
| 22 | `pnpm run test:material-import` | 通过 |
| 23 | `pnpm run test:assistant-quality` | 通过 |
| 24 | `pnpm run test:assistant` | 通过 |
| 25 | `pnpm run test:starter-198` | 通过 |
| 26 | `pnpm run test:social-programs` | 通过 |
| 27 | `pnpm run test:weekly-publishing` | 通过 |
| 28 | `pnpm run test:r4-social-lineage` | 通过 |
| 29 | `pnpm run test:production` | 通过 |
| 30 | `pnpm run test:platform-ads` | 通过 |
| 31 | `pnpm run lint` | 通过 |
| 32 | `pnpm run build` | 通过 |
| 33 | `pnpm run build:account-hub` | 通过 |

额外合并前定向：`pnpm run test:assistant-quality`87/87，以及输入栏/发送钩子/主助手合同3/3通过。迁移只读预检203项通过；Studio构建371875/485000字节，既有大chunk警告保留。完整 `pnpm test` 和 `pnpm run verify` 本轮未执行。合并后在目标工作树另行执行助手质量、界面/发送合同、类型、架构预算、迁移只读预检与diff检查，最终结果在下方补记。

## 保留与恢复

- 原目标工作树仅有 `server/index.ts` 的资源404未提交修复；不纳入来源或治理提交，不stash/reset/clean，合并前后逐字哈希一致：`2e3f45a5e129e57eed2c279d5cd74f79c07bc16c0e63ef5229d5d9874493b08d`。不宣称基线工作区干净。
- 合并前恢复分支 `backup/pre-assistant-quality-merge-20261025-7801dd0f`；原index补丁与原文件、源码清单、33阶段日志与结果在私有证据目录 `/Users/julia1/.codex/integration-evidence/20261025-assistant-quality-merge-n7mBZ0`。原文件补丁不自动应用到其他分支。
- 测试新生成4个未跟踪媒体缓存文件，逐一移到同一证据目录保留且校验SHA256；未提交缓存，未清理或同步实际预览/业务数据。
- 功能分支保留原位，预览5265继续从功能工作树运行；本轮没有创建、清理或归档其他工作树，尤其未操作图片AIGC保留树。截图仍位于功能工作树的artifacts目录，不把截图或预览数据视为源码。

## 运行与供应商边界

本轮是本地源码合并，无推送、部署、真实OAuth、付费生成、平台发布或生产数据写入；未对用户目标库运行迁移/恢复。集成测试仅使用临时PocketBase、合成租户与本地供应商替身。先前本地问答/门户/批量草稿的运行标识见QA记录，不代表真实供应商Ready。Qwen搜索需要账号匹配的原生端点；未配置则明确不可用。付费脚本/视频生成及真实发布未验收。下一步如需接真实供应商，按EXTERNAL-E2E-READINESS逐项准备账号、资产及预算后单独授权联调。

## 相关记录

- [外部信息QA](../qa/assistant-external-information-20261025.md)
- [内容门户与输入栏QA](../qa/assistant-creation-portal-20261025.md)
- [外部证据ADR](../architecture/adr/2026-10-25-assistant-external-evidence.md)
- [门户与续接ADR](../architecture/adr/2026-10-25-assistant-creation-portal.md)

## 合并后复验结果

在目标工作树、源码HEAD59d3fc06且保留原server/index.ts修改的状态下：`pnpm run test:assistant-quality`87/87通过；`pnpm exec tsx --test src/components/assistant/AssistantComposer.test.tsx src/components/assistant/useAssistantSend.test.tsx src/components/GlobalAssistant.contract.test.ts`3/3通过；`NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint`通过；`ARCHITECTURE_BASE_REF=7801dd0f pnpm run check:architecture`2797个生产TS文件通过；`pnpm run check:digital-employee-migrations`203项只读检查通过；`git diff --check`通过。没有重新运行整套quality或真实供应商E2E。原index文件哈希再次一致。
