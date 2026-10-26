# 产品口播核心卖点安全合入记录（2026-10-26）

## 版本与范围

- 权威工作树：`/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`；分支 `baseline/unified-20261026`。
- 原基线 `321f6dcc6fdcd4ef696a97b56f7c209f897cc4fa`；源码提交 `e61c3b688dcbc6bb945780650744e2513e7d6cfa`，随后独立治理补记不改变源码。
- 隔离候选：`/Users/julia1/.codex/worktrees/product-highlight-safe-merge-20261026/1025灵小枢外部信息`，分支 `integration/product-highlight-safe-20261026`，从原基线创建，验证后快进目标。
- 来源：`/Users/julia1/Documents/ChatGPT/1025灵小枢外部信息` / `feature/assistant-reply-quality-20261025` / `59d3fc06` 的未提交卖点能力。原树HEAD、工作区16项条目、index差异、完整diff和各脏文件SHA-256在执行前后核对一致；未提交或清理原树。
- 仅迁入卖点生成、编辑确认、回填与入口。保留六组首页结构及原四张创作场景，追加“提炼口播核心卖点”。此前PRD排除迁入的规定由用户本轮“这一项安全合并”授权覆盖，新规则追加在原规范末尾。

## 改动文件

- 后端：`server/knowledge/productHighlight.ts`、`server/knowledge/productHighlight.test.ts`、`server/routes/enterpriseProductHighlight.ts`、`server/routes/enterprise.ts`。
- 合同：`shared/contracts/productHighlight.ts`。
- 前端：`src/components/enterprise/ProductHighlightDialog.tsx`、`src/lib/productHighlightApi.ts`、`src/lib/productHighlightApi.test.ts`、`src/components/ContentCreationHome.tsx`、`src/lib/assistantHomeQuickPrompts.ts`、`src/lib/assistantHomeQuickPrompts.test.ts`。
- 配置与规范：`package.json`（原助手测试集合追加卖点测试）、`docs/product/PRD-灵枢AI全系统UI设计规范-v2-2026-10-09.md`。

生成只读取当前租户所选产品的必要事实，复用既有知识库模型接入；不写知识库。确认回填沿用原企业资料PATCH和If-Match，保留其他产品，GET读回一致才显示成功。产品失效、事实版本冲突、AI访问关闭、账户变化和保存未核验均不能继续宣称成功。没有新增供应商、数据库或队列主链。

## 实际验证

以下在隔离候选执行，生产源码与合入提交一致；运行时使用桌面附带Node加入PATH。

- `pnpm run test:assistant-quality`：149/149，通过。包括选中产品隔离、非法输入、租户隔离、生成期间版本变化、AI访问关闭、确认写入与读回不一致/读取失败等。
- `pnpm run test:assistant`：完整脚本退出0。
- `pnpm exec tsx --test server/routes/enterpriseFacts.test.ts server/routes/enterpriseContextFailure.test.ts src/components/enterprise/enterpriseProfilePersistence.test.ts src/components/enterprise/EnterpriseProductPanel.test.tsx src/components/ContentCreationHome.contract.test.ts src/components/HomeGrowthTour.test.ts server/security/enterpriseProductApiSecurity.test.ts`：13/13，通过。
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint`：通过；追加读回失败测试后再次通过。
- `ARCHITECTURE_BASE_REF=321f6dcc pnpm run check:architecture`：2962个生产TypeScript文件及预算棘轮通过，未扩大预算。
- `pnpm run check:digital-employee-migrations`：204项仓库迁移文件只读检查；`pnpm run test:migration-guard`：通过。无新增迁移，未执行目标数据库迁移。
- `pnpm run build`、`pnpm run build:account-hub`：通过，保留大chunk提示；Studio371881/485000字节。
- 候选、`321f6dcc..e61c3b68`与目标工作区 `git diff --check`：通过。

浏览器在临时5268前端/8867适配器核对原四卡、新增第五卡、选择本地合成验收产品与新旧卖点确认页。生成使用固定离线返回；点击取消，未保存企业资料。为复用已有本地合成身份，鉴权及资料GET转发到59d3fc06预览后端，因此页面如实显示版本不一致；新增生成路由从候选源码加载。测试适配器只为展示已有企业配置状态调整overview返回值，不持久化配置。此项仅是隔离UI/路由检查，不作为同版本真实后端E2E或真实模型质量验收。写入安全由上述自动化测试验证。

证据目录：`/Users/julia1/.codex/integration-evidence/20261026-product-highlight/`，包含命令日志、`before.json`指纹和`browser-review.png`。未记录令牌、未复制业务数据库。

## 保存与恢复

- 恢复分支 `backup/pre-product-highlight-20261026-321f6dcc` 保留。
- 原基线未提交 `server/videos/videoVisibilityMaintenance.ts` 不在提交范围，快进前后补丁SHA-256同为 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`，因此权威工作树仍非干净。
- 本次仅本地源码合并。没有推送、部署、真实供应商、付费请求、发布或目标数据迁移；没有外部run/task标识。
- 未运行全仓quality/verify，已有基线周任务M1失败不在本次修复范围。此前审计的内部问答误走外网、客户和投流数据衔接缺口也未在本项中修改。
- 回填只准备口播产品事实；不自动改写冻结参考台词、已确认口播、生成声音或启动视频。真实模型候选质量与口播消费效果仍需后续分别验收。
