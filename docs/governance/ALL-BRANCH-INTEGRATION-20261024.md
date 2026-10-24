# 本地功能分支联合整合（2026-10-24）

## 范围与用户决定

- 原权威基线：`xixi投流客服整合补齐基线v1` / `974a665d884c11e029bb4cb14df5b8ca05555ff0`。
- 用户确认本轮仅整合当前本地功能；GitHub 旧版、正式服和部署实验分支不纳入本轮。
- 图片分析继续 Qwen→Gemini；不恢复旧分支的 GPT 自动降级或绕过付费认领、预算及回执的请求。
- 数字员工执行现场只保留原任务日历、节点详情及原业务入口；拒绝另一来源的成片进度替代视图。
- 在独立候选工作树逐笔合并，保留原 23 棵工作树及其数据；13 棵有源码改动的树使用独立临时 Git index 创建固定快照，没有更改源 HEAD、index 或文件。
- 恢复点：`backup/pre-union-20261024-974a665d`；本机原分支 bundle、快照、冲突与原始日志位于 `/Users/julia1/.codex/integration-evidence/20261024-all-branches/`，不向 GitHub 提交运行数据。

## 分支逐笔覆盖

盘点 93 个原本地分支，78 个已为基线祖先，15 个存在独有提交；等价补丁通过 `git cherry` 逐提交核对，完成后记录历史祖先关系。完整矩阵如下。

| 本地分支 | 盘点提交 | 处理 |
| --- | --- | --- |
| `1009大合并` | `40dba2c044ad` | 原已包含 |
| `XIXI改数字员工联调（未完成版）` | `6b1a98a43136` | 原已包含 |
| `XIXI数字人授权` | `b2906c3ca48e` | 等价补丁已在基线；仅记录历史关系 |
| `XIXI的最终Messenger联调` | `debff611b9d3` | 原已包含 |
| `archive/safe-merge-wu-ui-20261010` | `62373483fa43` | 原已包含 |
| `backup/before-todo-merge-20261008` | `b1351f86868e` | 原已包含 |
| `backup/creator-ui-before-20261024-3193ead1` | `3193ead1a277` | 原已包含 |
| `backup/incoming-23bc110-20261008` | `23bc1105cf36` | 原已包含 |
| `backup/integrated-before-23bc110-20261008` | `c4eea75ae7ef` | 原已包含 |
| `backup/latest-local-20261009` | `aa3f774ba5c3` | 原已包含 |
| `backup/pre-ultimate-20261007` | `bf12ee521c14` | 原已包含 |
| `backup/pre-wu-production-20261011` | `c1e48cd577f3` | 原已包含 |
| `backup/pre-wu-ui-merge-20261011` | `6b1a98a43136` | 原已包含 |
| `codex/baseline-candidate-b13a846d-20261020` | `b13a846d2f21` | 原已包含 |
| `codex/colleague-handoff-20261019` | `7f75d5b652ee` | 原已包含 |
| `codex/colleague-handoff-20261019-merge-audit` | `2ef3291871b9` | 原已包含 |
| `codex/content-creation-integrated-20261024` | `4df08c90142d` | 源码/文档逐笔合并；冲突保留现行门禁 |
| `codex/digital-employee-20261024` | `89b175109149` | 原已包含 |
| `codex/emphasis-shot-aware` | `8665897c8c4f` | 等价补丁已在基线；仅记录历史关系 |
| `codex/exact-qwen-no-redirect` | `c0f6b5f0d057` | 等价补丁已在基线；仅记录历史关系 |
| `codex/exact-request-ceiling` | `6604f46b1062` | 等价补丁已在基线；仅记录历史关系 |
| `codex/exact-request-ledger-v2` | `0b396e1d29ce` | 等价补丁已在基线；仅记录历史关系 |
| `codex/integrated-flow-verified-20261008` | `842acf3b8bcf` | 原已包含 |
| `codex/integrated-operations-content-20261008` | `0f3bbed6cdcf` | 原已包含 |
| `codex/langgraph-enhanced-20261011` | `10537a54dba9` | 原已包含 |
| `codex/local-backup-20261019` | `9c83edcc6cf2` | 源码/文档逐笔合并；冲突保留现行门禁 |
| `codex/local-unified-20261010` | `5cb2b36e1338` | 原已包含 |
| `codex/merge-image-aigc-into-architecture` | `2d6c5a62d516` | 原已包含 |
| `codex/mobile-dual-edition-20261012` | `b5a24ea48be8` | 原已包含 |
| `codex/phase3c-v2-carry-seam` | `59cce0a70d9a` | 等价补丁已在基线；仅记录历史关系 |
| `codex/safe-all-modules-ui-20261009` | `d3509c734deb` | 原已包含 |
| `codex/safe-merge-b13a846d-20261020` | `2d6c5a62d516` | 原已包含 |
| `codex/safe-merge-wu-ui-20261011` | `03735c7f400f` | 原已包含 |
| `codex/stable-local-baseline-20261020` | `7f75d5b652ee` | 原已包含 |
| `codex/total-merge-langgraph-20261011` | `fedd6cf6107a` | 原已包含 |
| `codex/video-production-p1-20261023` | `71df3157f2be` | 原已包含 |
| `codex/weekly-budget-carry-20261019` | `093a2445a648` | 等价补丁已在基线；仅记录历史关系 |
| `codex/weekly-exact-head-store` | `4f927e67e862` | 等价补丁已在基线；仅记录历史关系 |
| `codex/weekly-exact-v2-carry` | `f5e71428f110` | 等价补丁已在基线；仅记录历史关系 |
| `codex/weekly-exact-v2-settlement` | `11f140b85e5f` | 等价补丁已在基线；仅记录历史关系 |
| `feature/content-creation-dialogue-20261024` | `4df08c90142d` | 源码/文档逐笔合并；冲突保留现行门禁 |
| `feature/content-generation-20261024` | `89b175109149` | 原已包含 |
| `feature/customer-service-20261024` | `6b5c30224fb3` | 原已包含 |
| `feature/lingshu-miniapp-20261023` | `f9cff15fcc45` | 原已包含 |
| `feature/miniapp-integration-20261024` | `e85c1fb46a20` | 源码/文档逐笔合并；冲突保留现行门禁 |
| `feature/platform-ads-chain-20261024` | `89b175109149` | 原已包含 |
| `feature/platform-ads-live-validation-20261023` | `46fea0ecfde3` | 原已包含 |
| `feature/platform-ads-meta-workspace-20261022` | `9579eb3bd14d` | 原已包含 |
| `feature/viral-inspiration-20261024` | `89b175109149` | 原已包含 |
| `feature/whatsapp-setup-flow` | `d78d432551bd` | 原已包含 |
| `incoming-v2-20261010` | `89dad14cc478` | 原已包含 |
| `incoming-v2-final-20261010` | `8d761294a49e` | 原已包含 |
| `safety/pre-merge-c01592ac-20261015` | `bee8dd21779e` | 原已包含 |
| `safety/pre-xixi-v2-merge-20261015` | `c01592ac0791` | 原已包含 |
| `snapshot/local-integrated-flow-20261010` | `f0b3cd08051e` | 原已包含 |
| `snapshot/local-preview-v2-20261010` | `4bc8393c9762` | 原已包含 |
| `snapshot/pre-langgraph-20261011` | `43bbc66c3878` | 原已包含 |
| `xixi` | `737484c9fcae` | 原已包含 |
| `xixi1021程永罗沟通前大整合` | `641d0b9ec944` | 原已包含 |
| `xixi代码架构清理后合并链条v1` | `1ed95e73836e` | 原已包含 |
| `xixi做mvp测试` | `3ce177ac67d8` | 原已包含 |
| `xixi做小程序` | `bee8dd21779e` | 原已包含 |
| `xixi做灵小枢回答质量与上下文管理` | `ff8fa3e42097` | 原已包含 |
| `xixi功能大合并20261023` | `2b2ff027a5e3` | 原已包含 |
| `xixi合并联调v2` | `a72da4026eb6` | 原已包含 |
| `xixi图片AIGC` | `5be134d0b651` | 原已包含 |
| `xixi图片AIGC管线` | `95b0bcc16820` | 原已包含 |
| `xixi图片生成+GPT降级分析` | `c7f7c0fc8073` | 已有安全实现保留；排除 GPT 自动降级及弱化遮挡保护 |
| `xixi投流客服整合补齐基线v1` | `974a665d884c` | 原已包含 |
| `xixi改tab顺序+前端整合` | `02f5a112c6a3` | 原已包含 |
| `xixi改大合并（投流）` | `b6e4b3e86647` | 原已包含 |
| `xixi改小程序运营版+客服版` | `ad2ea1be3934` | 原已包含 |
| `xixi改我的素材分类` | `442225a6b46f` | 原已包含 |
| `xixi改数字人管道3生成效果` | `a0dcdbded558` | 原已包含 |
| `xixi改数字人认证` | `3eac6674b8fc` | 原已包含 |
| `xixi改智能经营首页` | `af134002399e` | 原已包含 |
| `xixi改真实成片质量` | `10537a54dba9` | 原已包含 |
| `xixi数字员工架构待清理` | `2d6c5a62d516` | 原已包含 |
| `xixi数字员工联调v0` | `fcd2720dd6f2` | 原已包含 |
| `xixi数字员工联调v3` | `37f1f4174c78` | 原已包含 |
| `xixi智能客服隔离测试` | `f764fa4503a3` | 原已包含 |
| `xixi测试服1015` | `d4ec99e41874` | 原已包含 |
| `xixi联调V1` | `8a4cef48e249` | 原已包含 |
| `xixi联调合并版v2` | `1ca60648f1b9` | 原已包含 |
| `xixi联调数字人创建与授权` | `998949ca3fc3` | 原已包含 |
| `合并后JJ修前端` | `9a4595d9a872` | 原已包含 |
| `吴小姐数字员工联调-进入制作` | `0eb15c1ae23e` | 原已包含 |
| `喜喜Messenger端口联调` | `80e7f02c3bec` | 原已包含 |
| `喜喜调Facebook后台私信` | `a25098367ab9` | 原已包含 |
| `喜子改动效+企业知识库引用生首帧` | `c9030fbb5f92` | 原已包含 |
| `喜子改灵感大屏分析给经营任务` | `45bacdd8916f` | 原已包含 |
| `洗洗做内容制作联调` | `df19704223cc` | 原已包含 |
| `素材类别混剪口播时间码调优` | `ce7ad41dbb5f` | 原已包含 |

## 未提交功能快照

| 来源 | 快照 | 处理 |
| --- | --- | --- |
| `codex/integrated-operations-content-20261008` | `9b450c73230b` | 保留当前人物授权、方舟准备及已治理实现，避免恢复旧单体 |
| `xixi` | `46c1d95129d4` | 保留现行生产/发现链；补齐小程序待办列表切换与拍摄深链 |
| `合并后JJ修前端` | `c7b10512d0d7` | 保留现行任务日历及响应式公共组件 |
| `xixi图片AIGC管线` | `70a55c4d4b35` | 按用户决定保留原任务日历与权威治理；不引入演示进度表/过时基线文件 |
| `codex/content-creation-integrated-20261024` | `e009ca51bb5b` | 合并公共与数字员工功能；保留另一来源更完整的证据校验；不采用替代成片进度视图 |
| `feature/content-creation-dialogue-20261024` | `a5ece66100a8` | 合入自由创作、分镜证据与既有 Starter 任务交接 |
| `feature/platform-ads-meta-workspace-20261022` | `841cda4511d5` | 保留 10/24 授权恢复、身份栅栏和部署前检查，不回退旧 OAuth |
| `feature/lingshu-miniapp-20261023` | `7033a426321b` | 保留短镜头修复和治理模块；仅补入尚无的预览辅助脚本 |
| `codex/digital-employee-20261024` | `cca6357ef6b0` | 合入目标、真实成片与原任务日历接线 |
| `feature/miniapp-integration-20261024` | `fc9e5d12277f` | 合入上传云素材与拍摄任务关联及本地联调 UI |
| `feature/viral-inspiration-20261024` | `bb68adb1d50f` | 合入灵感分类、素材层级、租户/行业访问及页面联动 |
| `feature/platform-ads-chain-20261024` | `0089ae844ff0` | 合入投流授权生命周期、恢复、回执与失败状态 |
| `xixi改数字人认证` | `1a0b32c8718d` | 保留现行企业产品资产门禁，拒绝缺产品资产的生成路由 |

## 集成修复

- 自由创作与数字员工合并后移除重复声明，模式切换只保留共用顶栏入口及原 Context，避免两套按钮重复出现。
- 补齐小程序列表/卡片切换、列表处理动作；保留现行空态与 Agent 分组。
- 迁移 manifest 按完整文件名排序并合并四份新增迁移；原 197 份迁移不改字节。只在临时测试库演练，未操作已有预览库/生产库。
- 人物产品接触断言保持企业资产不足时 blocked；卡片比例断言区分创作首页封面与灵感库真实比例。
- 产品规范章节去重编号，明确原任务日历为本轮用户确认。

- 周任务整链首跑暴露已有逐帧敏感文字检查逐帧初始化 OCR 的性能缺口；复用本次核验专用会话，仍逐帧识别、按帧保存证据，不跨任务复用、不减少采样、不改变 300 秒边界。真实 MP4 单帧敏感标记及全部 30 帧证据回归通过，相关 OCR/字幕组 11/11。修复后周任务主链 42/42 通过（约 116 秒，原 300 秒边界未变）。首次失败日志保留。

- Starter 的旧手动生产入口断言仍要求页面与旧正则完全匹配；改为直接验证当前规划/Studio 选择表达式的普通创作、对话交接、参考创作、显式 Studio 和历史页面行为，保留任务作用域与服务端产物门禁检查。首次失败日志保留。

- 素材归属旧 UI 合同同步到“上传内部素材”、来源树多选和精简筛选栏，仍检查产品归属、租户访问、正式库存边界、产物来源与上传保存，不恢复已淘汰界面。首次失败日志保留。

- 发现供给结果的旧合同仍要求导入已不用的列表组件；现核验同一个共享 VideoCard 在共享瀑布流中展示，原供给溯源与批准门禁断言不变。

- 全仓租户检查中的助手根节点正则只截取 500 字符，新增内嵌属性后误截断；现读取完整根节点，并额外要求仅首页锚点采用内嵌布局，其他页面保留原固定位置、安全区和身份隔离断言。未降低租户或布局门禁。

- 全仓客服激活检查查出原紧凑工作台遗漏总开关入口（保存函数仍存在但无调用）：在客户列表紧凑栏接回原处理函数，未知状态/保存中禁用；保留关闭确认、建议观察期、FAQ/授权及自动发送门禁。控件无浏览副作用；真实客户草稿继续按选中身份恢复。补充控件状态回归，首次失败日志保留。

## 验证与限制


- 最终源码/测试候选：`02e44500dd35d7020517c62ff00e3a3a0c15cad2`。文档及基线切换记录另行提交。
- 70 个改动相关测试文件复跑 225/225；后续局部修复另跑创作壳、OCR 11/11、素材合同与助手/客服激活检查。
- 周任务主链 42/42，M1 约 99.6 秒；本地生产恢复通过。真实媒体 OCR 检查保留全帧证据和原超时，不依赖付费供应商。
- 完整客服 candidate 功能矩阵通过，全部 90 项末组通过；小程序共享组 61/61、Python 回调桥 1/1 通过（各矩阵有重叠，不相加）。
- quality 的 33 个阶段均已执行通过；首次完整 verify 在 PB_BIN 缺失处停止，指定本机固定 PocketBase 0.39.5 后按失败检查点续跑。未将首次失败写成成功，也不宣称整条 verify 单次退出 0。
- 最终完整 `pnpm test` 单次退出 0（`full-test-final.log`）；最终 lint、架构/ratchet、201 项迁移只读检查及 guard、生产构建全部退出 0。客服开关专项 2/2。Studio chunk 367219/485000 字节，视图边界通过。构建仍有通用大 chunk 提醒，不声明性能优化。

| quality 阶段 | 结果 | 原始日志 |
| --- | --- | --- |
| `check:vendored-dependencies` | 通过 | `verify-first.log` |
| `check:container-contract` | 通过 | `verify-first.log` |
| `test:production-ops` | 通过 | `verify-first.log` |
| `check:architecture` | 通过 | `verify-first.log` |
| `test:architecture-ratchet` | 通过 | `verify-first.log` |
| `test:fixed-yield` | 通过 | `verify-first.log` |
| `check:digital-employee-migrations` | 通过 | `verify-first.log` |
| `test:migration-guard` | 通过 | `verify-first.log` |
| `test:production-governance` | 通过 | `verify-first.log` |
| `test:production-orchestration` | 通过 | `verify-first.log` |
| `test:gap-v1-release` | 通过 | `gate-test-gap-v1-release.log` |
| `test:four-platform-release` | 通过 | `gate-test-four-platform-release.log` |
| `test:shared-contracts` | 通过 | `gate-test-shared-contracts.log` |
| `test:production-runtime-gate-contract` | 通过 | `gate-test-production-runtime-gate-contract.log` |
| `test:production-runtime-gate` | 通过 | `gate-test-production-runtime-gate.log` |
| `test:weekly-golden-journey-contract` | 通过 | `gate-test-weekly-golden-journey-contract.log` |
| `test:weekly-golden-journey` | 通过 | `gate-test-weekly-golden-journey-final.log` |
| `test:capacity-harness` | 通过 | `gate-test-capacity-harness-final.log` |
| `test:security-boundaries` | 通过 | `gate-test-security-boundaries-final.log` |
| `test:frontend-security` | 通过 | `gate-test-frontend-security-final.log` |
| `test:account-hub` | 通过 | `gate-test-account-hub-final.log` |
| `test:material-import` | 通过 | `gate-test-material-import-final.log` |
| `test:assistant-quality` | 通过 | `gate-test-assistant-quality-final.log` |
| `test:assistant` | 通过 | `gate-test-assistant-final.log` |
| `test:starter-198` | 通过 | `gate-test-starter-198-accepted.log` |
| `test:social-programs` | 通过 | `gate-test-social-programs-audit.log` |
| `test:weekly-publishing` | 通过 | `gate-test-weekly-publishing-audit.log` |
| `test:r4-social-lineage` | 通过 | `gate-test-r4-social-lineage-audit.log` |
| `test:production` | 通过 | `gate-test-production-audit.log` |
| `test:platform-ads` | 通过 | `gate-test-platform-ads-audit.log` |
| `lint` | 通过 | `gate-lint-audit.log` |
| `build` | 通过 | `gate-build-audit.log` |
| `build:account-hub` | 通过 | `gate-build-account-hub-audit.log` |

- 推送后的整段 `git diff --check 974a665d HEAD` 发现旧来源 `studioWorkbenchMode.ts` 末尾多余空行，已清理并复核整段差异通过；仅空白变化，沿用上文测试证据，未重复执行测试。

## 操作边界

- 目标数据库未执行迁移；本地测试仅创建、升级、备份恢复临时测试库。四份新增迁移并存，201 项清单核验通过，原 197 份字节保留。
- 本轮没有部署、发布、真实付费模型请求、真实 OAuth 授权、广告执行或真实消息发送；不声明真实供应商 E2E 或发布就绪。
- 未覆盖完整登录后浏览器人工验收。旧 Remotion 原型保留为来源代码，不声明已接通产品生产流程。
- 分支普通 push 不匹配镜像构建的 v* 标签触发器；部署工作流要求手动触发。没有触发部署。
- 预览/运行状态与源码独立；来源树仍有未提交成果的，不覆盖或强制快进。原始日志、源码快照、备份 bundle 与冲突选择证据在本机证据目录。
