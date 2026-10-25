# 节节1025服务器上传：本地基线安全合入

日期：2026-10-25（Asia/Shanghai）。仅本地源码集成，未推送、部署、执行目标库迁移或真实付费/渠道调用。

## 来源与合并方式

- 权威工作树：`/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，分支 `xixi联合功能模块后端改`。
- 原基线：`b97265dc667ea0936ab8e75bfdb7da58f6a9c847`，已含前端 2.0 与助手回复质量整合。
- 来源：`origin/节节1025服务器上传`，精确 SHA `181868f3f9bad2ff437f124018e9decf5ababb59`；最新源码修复提交 `92d2d56aed64c6ade2eb883081526f1e2588e599`，与用户交接一致。
- 原基线是来源的祖先，左/右独有提交为 0/10。审查 19 个变化文件后使用 `git merge --ff-only` 快进；没有分叉、内容冲突或需要选择 ours/theirs 的产品冲突。
- 复用本聊天上一轮已干净的候选树 `/Users/julia1/.codex/worktrees/frontend-v2-safe-integration-20261025`，切到新分支 `integration/server-upload-20261025` 并固定 `181868f3` 验证；原 `integration/frontend-v2-20261025` 分支及恢复点保留。验证期间权威树保持原位。
- 恢复分支 `backup/pre-server-upload-20261025-b97265dc`。原权威树的 `server/index.ts` 未提交资源 404 修复在开始、快进前和快进后逐字/补丁 SHA-256 核对一致；没有纳入合并或治理提交，因此权威树仍有这一项未提交修改。

## 增量审查

- 隔离预览固定读取本地对象镜像；只在显式本地预览模式跳过可选数字人视觉 QA Python 启动探针，实际运行门禁不变。
- 主站与账号中心按实际监听端口隔离 Vite 缓存，HMR/CSP 端口同步，避免多个本地预览互相使依赖失效。
- 首页卡片使用认证媒体读取，失败回落为无图样式。资讯、策略、周任务卡根据已加载 overview 提供可追溯摘要，不自动调用真实模型或启动业务执行；缺少证据时明确说明缺口。
- 助手活动使快捷卡片自动收起，可通过键盘可用按钮恢复；桌面保留 2.5 张卡的横向视口。客服恢复/手动控件与聊天线程放在同一网格列。
- 没有依赖、锁文件、历史迁移、架构预算或部署流程改动。原 Qwen→Gemini、客服紧凑资料、管理页面/旧链接及助手知识库整合没有被覆盖。
- 来源 `BASELINE.md` 的 `/Users/jiejie/Documents/lingshu-AI` 只代表来源电脑的历史事实，不作为本机的权威工作位置；本次本机状态以顶部新增基线节为准。

## 本轮实际验证

以下检查均在精确来源 `181868f3` 的候选树执行通过；未修改生产源码再合入。随后仅提交本机治理记录。

- 预览监督器与隔离启动合同：`node --test scripts/customer-isolation-bootstrap.test.mjs scripts/local-preview-supervisor.test.mjs`。
- 首页回复、首页合同、全局助手、客服滚动/布局、数字人预检及发送行为定向组：20/20。
- `pnpm run test:customer-isolation`、`pnpm run test:assistant`、`pnpm run test:assistant-quality`（87/87）、`pnpm run test:frontend-security`。
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint`。
- `ARCHITECTURE_BASE_REF=b97265dc pnpm run check:architecture`：2798 个生产 TypeScript 文件及相对原基线的 ratchet 通过，没有增加预算或豁免。
- `pnpm run check:digital-employee-migrations`：203 项只读检查，0 blocker；`pnpm run test:migration-guard` 通过。没有连接或迁移用户目标数据库。
- `pnpm run build`、`pnpm run build:account-hub`：通过，Studio chunk 371887/485000 字节；其他 chunk 的非阻断体积提示保留。
- 隔离浏览器在 1440px/390px 验证首页与客服，4/4 通过：三张卡分别点击得到对应本地证据回复，自动收起并可恢复；恢复动画结束后卡片可见且可横向滚动，客服无页面横向溢出或列表重叠。截图已目视核对。所有 API 均由测试替身响应，写入拒绝且外部请求阻断，不使用真实账号或模型。
- `git diff --check b97265dc 181868f3` 通过，候选生产源码与来源逐字一致。

本轮没有重跑完整 `pnpm test` 或全仓 quality/verify，不将来源历史验证或上述定向通过写成新的全仓验收；部署及真实供应商 Ready 仍不在本轮范围。

本机证据：`/Users/julia1/.codex/integration-evidence/20261025-server-upload-181868f3/`。包括原工作区补丁/哈希、快进核验、定向与静态检查日志、浏览器脚本/报告/截图。临时浏览器脚本首跑的 CommonJS 导入错误已修正，只影响验收脚本；原失败日志和最终成功日志分别保留。
