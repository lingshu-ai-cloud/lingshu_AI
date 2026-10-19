# 同事交接分支测试问题台账（2026-10-19）

分支：`codex/colleague-handoff-20261019`

本文件只记录真实复现的失败。不得通过跳过测试、删除断言、扩大架构预算或放宽安全边界关闭条目。

## OPEN-001 独立周规划只生成一条外部分析

- 命令：`pnpm exec tsx --test server/socialPrograms/weeklyIndependentPlanning.test.ts`
- 用例：`actual established program keeps owned gaps while external slots get explicit immutable partial dispatch`
- 期望：`analyzed.directorAnalyses.length === 3`
- 实际：`1`
- 阶段：Director 分析，尚未进入执行图物化。
- 初步归因：规划权威层对三个 external slot 的分析结果发生折叠或只选择了一个 slot；与 `weeklyExecutionGraph` 拆分无直接调用关系。
- 状态：待修复。

## OPEN-002 社媒工作流候选集合出现空场景

- 命令：`pnpm exec tsx --test server/starter198/socialContentAgentWorkflow.test.ts`
- 断言：所有执行场景都应有 `1..20` 个候选。
- 实际：至少一个场景的 `candidates.length === 0`。
- 初步归因：素材候选准入/产品兼容过滤与旧工作流 fixture 的契约不一致；需要先确定 fixture 是否缺少新 V2 权利或产品身份证据。
- 状态：待修复。

## OPEN-003 完整本地产品素材被错误降级

- 命令：`pnpm exec tsx --test server/starter198/socialContentTypeAwareAdmission.test.ts`
- 用例：`normal unaltered product_value baseline admits complete local semantic evidence`
- 期望：准入成功。
- 实际：多个产品场景被标记为 `goal_degraded`，审核 `approved === false`，理由为“用户明确锁定的产品暂无对应参考素材”。
- 现有证据：候选本身带有 `productRef: SKU-1`、本地视频区间和产品角色，但 `productId` 为空。
- 初步归因：locked 产品匹配可能只接受稳定 `productId`，没有正确接受同一冻结 `productRef`；也可能是 fixture 应补充稳定产品 ID。必须依据当前产品身份契约判断，不能直接放宽匹配。
- 状态：待修复。

## OPEN-004 工作流错误码优先级变化

- 命令：`pnpm exec tsx --test server/starter198/socialContentWorkflow.test.ts`
- 位置：约第 485 行。
- 期望错误码：`social_content_execution_goal_degraded`
- 实际错误码：`social_content_execution_director_review_required`
- 初步归因：Director review 阻断现在早于 goal-degraded 语义错误返回；需核对当前 API 契约应该暴露哪个更具体的错误。
- 状态：待修复。

## OPEN-005 Outbox 恢复用例被相同准入回归阻断

- 命令：`pnpm exec tsx --test --test-name-pattern="real outbox recovery" server/starter198/socialContentTypeAwareAdmission.test.ts`
- 用例：`real outbox recovery reuses original queue/run after crash and never resubmits unknown supplier work`
- 期望：先通过生产准入，再验证原 queue/run 被复用。
- 实际：尚未进入恢复断言，即被 OPEN-003 的 `goal_degraded` 审核失败阻断。
- 初步归因：当前是 OPEN-003 的下游失败，不应单独修改 Outbox 恢复逻辑。
- 状态：被 OPEN-003 阻塞。

## RESOLVED-006 工作流测试归档替身缺少参数类型

- 命令：`pnpm exec tsc --noEmit`
- 位置：`server/starter198/socialContentWorkflow.test.ts`，生成媒体归档测试替身。
- 实际：`TS7006: Parameter 'input' implicitly has an 'any' type`。
- 归因：既有本地测试改动新增了归档替身，但没有从生产运行时端口继承参数类型；不是生成素材归档模块拆分造成的生产类型回归。
- 修复：使用 `SocialContentAutoProductionRuntime['archiveGeneratedMedia']` 的首个参数类型，未使用宽泛 `any` 放过输入契约。
- 状态：已修复，待完整质量门禁复核。

## OPEN-007 CTA 证据门禁被供应适配器错误抢先阻断

- 命令：`pnpm exec tsx --test server/starter198/socialContentAssetSupplyExecution.test.ts`
- 位置：约第 244 行的拒绝断言。
- 期望错误：`weekly_production_cta_evidence_required`。
- 实际错误：`asset_supply_provider_exhausted:scene-person:motion_graphics:adapter_not_registered`。
- 初步归因：测试场景在到达 CTA 周生产证据门禁前，先进入了未注册的 `motion_graphics` 供应路由；需判断是执行检查顺序回归，还是 fixture 未随供应路由契约更新。
- 关联性：生成素材归档候选与持久化测试均已通过；当前失败发生在供应适配器选择阶段，与本次归档模块搬移无直接调用关系。
- 状态：待修复。

## RESOLVED-008 仪表盘源码契约测试未跟随模块拆分

- 命令：`pnpm exec tsx --test src/components/SmartBusinessDashboard.preproduction.contract.test.ts src/components/SmartBusinessWeeklyCommandCenter.contract.test.ts`
- 实际：5 个源码契约断言只读取 `SmartBusinessDashboard.tsx`，预生产预览和精确灵感引用移动到 `smartBusiness/TaskPreviewCards.tsx` 后误报缺失。
- 归因：测试定位方式过期，业务判断、嵌套引用协议与保守素材阻断仍完整保留在新模块。
- 修复：测试同时读取职责模块；保留原断言语义，仅兼容项目既有的单双引号格式。
- 状态：已修复，待复跑确认。

## RESOLVED-009 展示模型 VM 缺少 showcase 运行时依赖

- 命令：`pnpm exec tsx --test src/components/SmartBusinessDisplayModel.test.ts`
- 实际：`ReferenceError: isSmartBusinessShowcaseEnabled is not defined`。
- 归因：测试直接截取并在 VM 执行展示模型函数，但没有注入函数当前已依赖的 showcase 开关和周汇总常量。
- 修复：VM 明确注入“showcase 关闭”的生产等价上下文，不改变展示模型断言。
- 状态：已修复，待复跑确认。

## 已验证通过的相关范围

- 周执行图核心：24 个用例通过。
- 内容订单准入、投影、产品选择：17 个用例通过。
- TypeScript：`pnpm exec tsc --noEmit` 通过（截至提交 `79f26bf6`）。
- 架构棘轮：通过；完整架构检查仍有历史大文件超限，另行持续拆分。
