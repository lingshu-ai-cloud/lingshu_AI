# 会话 C：强 scope 交接、三栏证据与最终人工边界

2026-10-11。规则依据：`5bd6708` 更新的《缺口与MVP测试》第11–12节；业务阻塞依据：A 的 `99eb1df` 权威本地审计。

**本轮完成本地合同、页面准备和审核护栏，真实成片仍未完成。** A 审计 `uniqueExecutableCandidate=null`：可追溯 b251 项目的企业事实为照明/灯具买家，产品目录为护肤品，计划 TikTok 账号不在正式账号表，冻结版本未选定。A 条件草案与 B 历史 RS-014 禁止进入合成；旧8.56秒创意失败片不计为通过。

## 已提交的实现

1. 强 scope 合同与权威读取 `9aebe9d`。scope 必须包含 tenant/account/product/project/task/run/version，scope.version 定义为内容任务版本；参考 hash/使用边界、零基础依据、编导/脚本/分镜/口播、人物/音色版本与权利、逐镜 fingerprint/事实/权利、A/B/全片预算与授权、原 attempt 恢复计划缺一不可。供应商片段绑定统一 packageHash、镜头与供应商 task/request/attempt、媒体 hash、费用账本。重试历史纳入分项及总预算；A/B不互借，重复供应商任务跨镜拒绝，已结算费用不再保留同笔预占。已有任务详情从服务端 `task.mvp_scope` 读取，不从用户 brief 猜测。
2. 最终内部真人审核校验 `36a83b1`。现有 G5 `/mvp-final` 入口从认证 locals 取得租户/调用者，只接受冻结 artifactVersion/artifactHash/fileSha256，复验显式分配的当前真人 G5 记录、权限、成片与来源。Agent通过只作为初审；自填 humanConfirmed/reviewer 字段不能替代签认。成片变更、版本冲突、审核员停用后失效。这是服务端认证的审核记录与摘要，并非新建密码学个人签名，也不授予发布或部署权限。
3. 三栏工作台右侧只读面板 `69c2cf4`，读取原任务 `socialMvpHandoff`，展示scope、参考、人物音色、脚本分镜口播、逐镜指纹、事实权利、供应商回执、费用与分阶段审核。当前登录/任务/run/version/project不一致不展示，登录变更清除旧投影。缺失标未核验；预算上限不显示为价格；预占不显示为已结算。没有逐镜客户审批按钮，也不会自动humanConfirmed。
4. C 离线 intake 升级 v2，复用 shared 强scope合同，核验统一包canonical hash、本地媒体hash、必需镜头/批量历史预算、最终来源hash和审核scope/hash；业务审计必须有同scope唯一可执行候选。旧四项scope合同不再可用。可编辑离线数据、JSON hash及引用均不证明供应商/授权/人工真伪，输出永久 runtimeVerified/providerVerified/creativeAccepted/mvpPassed=false。

## 实际阻塞和准备边界

接收器读取 `docs/acceptance/mvp-session-a-identity-audit-2026-10-11.json` 实际文件并核SHA后返回 business_identity_unresolved，exit 1符合预期；诊断保存在 `work/mvp-session-c/identity-block-result-20261011.json`。没有调用任何成片合成或供应商提交来绕过冲突。

后端已接任务详情的只读投影，但 `social_mvp_handoffs` / `social_mvp_evidence` 的生产持久表、源供应商/权利/授权/账本写入 adapters 尚未建立。本轮不创造 mvp_scope 或假记录。即使记录内容hash全匹配，仍保留 source_adapter_authority_verification_required、media_technical_inspection_required、final_human_creative_acceptance_required，不产生 composeEligible。授权有效期、撤销、范围及真实账单必须由可信源核验，泛用JSON引用不能替代。技术报告与最终真人签认入口现已可用，但本次真实统一包媒体尚未到达，未填入通过记录。

费用面板的逐镜实际只显示settled记录，全范围实际账本及当前价格仍未核验；不能用片段小计假装包括历史重试、BGM、转场、质检和其他全片费用。冻结脚本到实际生产工程 slot/provenance 的持久导入也仍待统一执行包和 source adapters，面板展示版本引用不代表已导入并合成。

## 测试

联合执行 shared合同、权威读取、MVP最终真人审核、离线intake、三栏面板、任务读取护栏与既有hydration共7文件，**32/32通过**。覆盖七项scope混用、回执缺失、自填verified/humanConfirmed、指纹/人物音色漂移、历史预算/重复attempt、账本版本独立、缺真实栈片段、真人权限/成片字节漂移、reservation与actual区分、身份变化不回写。

子Agent另外执行G5既有回归共25/25；前端既有workspace/manual bridge/workflow合同通过。不要与联合测试相加为独立测试总数。全仓TypeScript未通过：当前B并发文件 seedanceProductRecovery.ts:39、studio.ts:2270/2289/2314中 reserved 与 completed|uncertain 状态类型不兼容；本轮C文件没有对应诊断。扩大 socialContentWorkflow 回归还在既有 asset_supply_scene_identity_missing_or_duplicate 拒绝处失败，未降低门禁消除错误。故完整仓库检查仍需主会话协调B与对应素材负责人处理。

使用现有仓库 tsx：

```sh
pnpm exec tsx --test scripts/mvp-session-c-intake.test.mjs
pnpm exec tsx scripts/mvp-session-c-intake.mjs work/mvp-c-handoff.json work/mvp-c-intake.json
```

v2输入沿用 `fixtures/mvp-session-c/handoff.template.json`，新增 executionPackage、clips、historicalBudgetSpent、businessIdentityAudit:{file,sha256}。expectedScope须独立选取；businessIdentityAudit中的uniqueExecutableCandidate必须与七项scope一致。包/clip形状参考shared/contracts/socialMvpHandoff.ts；fixture明确仅受控，不能用作真实凭据。先前报告的直接node运行方式已被tsx替代。

## 决策与例外

- Agent自主完成合同设计、任务/媒体/账本分离、内部技术门禁、UI只读布局、原attempt恢复边界和回归，不要求客户逐项决定模型/提示词/首帧或协调A/B。
- 经营/编导负责统一业务身份与执行包；C拒绝通过共用参考消解产品/账号冲突，也不替业务负责人创造事实或授权。
- 业务例外交主会话收束：按99eb1df已有证据，确定该租户是否有护肤品经营授权，或改用照明业务/独立授权租户及正式账号。C不重复向客户提问。
- A已确认¥5仅数字人口播上限，不是B/全片预算，不作为付费执行或发布授权；没有重新询问金额。
- 价格/余额/账单交管理员；普通技术故障由内部执行Agent处理；最终品牌判断由有权限内部审核员签认。制作、发布、生产变更权限独立。

## 八项口径

| 项目 | 本轮结果 |
| --- | --- |
| 本地受控合同 | C定向联合32/32通过；全仓检查仍有上述未解决问题 |
| 真实媒体文件 | 未生成本次MVP成片；审核测试使用本地夹具媒体 |
| 真实付费供应商 | C未调用；未将mock或旧记录算真实生成 |
| 创意质量 | 初审/最终人工边界测试通过；本次真实成片未验收 |
| 真实发布 | 未执行 |
| 真实平台回执 | 未取得 |
| 真实指标 | 未回收，不补零 |
| 生产ready:true | 未核验，不声明通过；没有部署/迁移 |

离线intake与本报告首次提交 `67595c6`；最终联合32项回归日志位于 `work/mvp-session-c/joint-tests-20261011.log`。
