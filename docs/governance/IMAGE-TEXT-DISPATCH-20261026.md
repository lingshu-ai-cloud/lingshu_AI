# 图文复刻执行调度接入记录

日期：2026-10-26。工作树 `/Users/julia1/Documents/ChatGPT/1026图文创作版本`，分支 `feature/image-text-viral-creation-20261026`。开始时干净，HEAD `907e74d1476d96a4ea65b5eadfa76e375da2235b`；本轮改动尚未提交，未推进默认集成基线。

## 改动

- `server/socialImage/socialImageExecution*.ts`、`server/routes/socialImageExecutionRoutes.ts`、`shared/contracts/socialImageExecution.ts`：原持久化队列的图文准入、执行器、运行适配与公开回执。
- `server/socialImage/socialImageWorkflow{Commands,Assets}.ts`、`studioPosterPlanning.ts`、对应原 HTTP 路由及 `server/lib/demo.ts`：复用素材核验、策划、分层渲染、质检和身份配额，不通过内部 HTTP 或保存浏览器令牌执行。
- 原 Worker/context/任务投影：按图文运行身份验证、调度与读回，保留视频 run_id 语义。
- 对话确认、统一任务详情及列表：提交后显示真实回执；刷新只读取；图文节点替换视频节点。历史未入队任务提供显式提交按钮。
- 测试与共享源码 fixture：补充调度验证；修复既有参考图测试缺少企业事实版本的 fixture，不放宽生产门禁。
- 本轮联调追加：修复 Tesseract 只返回纯文本、导致参考图词框恒为空的问题；执行器在付费策划前检查参考图版式与交付画幅，失败直接给出可读原因。

架构决定见 [ADR](../architecture/adr/2026-10-26-social-image-durable-dispatch.md)。跨 HTTP、领域、队列和页面的少量改动是同一入队目标；没有新增队列、迁移、发布路径或全局后台 Worker。

## 已执行验证

- `pnpm exec tsx --test server/socialImage/socialImageExecution.test.ts`：7/7。包括入队幂等、版本与取消、租户范围、新 Worker 领取、变化输入栅栏、HTTP 202/恢复、真实本地像素渲染与重建去重。视觉 QA 是测试替身。
- 原队列、任务列表、对话草稿、参考策略与试用配额领域回归：66/66；补充调度/队列投影/配额合并回归 19/19。
- `pnpm run test:social-image-pipeline`：85/85、HTTP 集成 1/1、路由/工作台合同及治理 2/2 通过。
- `pnpm exec tsx scripts/test-image-replication-ui.mjs`：6 个隔离场景通过；验证确认只提交入队，刷新没有新增写请求，多语言输入仍保留。
- `pnpm run lint`、`ARCHITECTURE_BASE_REF=907e74d1476d96a4ea65b5eadfa76e375da2235b pnpm run check:architecture`、`pnpm run build`、`git diff --check` 通过。架构与预算 ratchet 通过，普通生产 TypeScript 文件不超过 800 行。
- `pnpm run check:digital-employee-migrations`：204 项迁移清单只读检查通过；未访问数据库或执行迁移。
- 任务详情候选素材与生产状态定向回归 6/6 通过。
- 追加 OCR 5/5、图文参考/调度 10/10、图文管线 85/85、类型、架构与构建通过；参考图原图离线检查发现当前任务为 590×590，而交付规格为 4:5，冻结的旧词框为空且显著性差仅 0.0315，尚不满足结构编译要求。
- 未运行全仓 quality/verify；未做真实供应商 E2E、发布或部署。没有执行数据库迁移。

## 本地实际任务证据

- ContentTask `socialtask_ad1a31f88b3736e23ca2cce2`，图片运行 `img21b450831da3`，版本 10。
- 入队 HTTP 202，回执 `bf4197c82e94c60`，重放返回相同回执；统一任务列表与详情均读取该回执。
- 仅对上述回执运行原 `createScopedSocialContentProductionWorker`；已领取，attempt=1。唯一任务已在模型调用前停止，状态 `blocked`，错误 `user_input_required:social_image_paid_execution_disabled`。定向 Worker 已退出，没有开启全局后台任务。
- 页面可见“调度已领取原任务”和“真实模型执行尚未启用，已有制作进度已保留”；没有图文产物，付费图片任务为 0，不代表生成验收通过。
- 预览仍为 Web-only，模型执行显式关闭。源码冻结并按外部 E2E 手册确认稳定基线后，再进行原任务恢复与真实模型验收；不可通过重复确认重新付费。
- 2026-10-26 后续预览重启已将 `SOCIAL_IMAGE_EXECUTION_PAID_ENABLED` 设为 true，但保持 Web-only、没有启动全局 Worker；原回执仍为 blocked/attempt=1，未触发新付费调用。`STUDIO_PAID_BUDGET_CNY=5` 不覆盖图文模型调用，不能据此声明 5 元费用受机器约束。当前执行器走千问策划、分层本地合成、千问视觉质检，不调用任务规格里的 OpenAI 图像模型；真实 OpenAI 出图仍待接通正式付费链路。以上限制须在真实冒烟前解决或明确区分。

私有证据与运行恢复副本：`/Users/julia1/.codex/integration-evidence/20261026-image-execution-queue/`。包含入队前原运行记录、HTTP 回执、定向 Worker 领取结果和页面截图；未提交任何凭据、运行库或媒体。源码恢复点为上述 HEAD，原工作区改动应保留或审阅后逐项撤销，不清理其他工作树。
