# 智能经营与灵小枢周任务视图安全合入记录

日期：2026-10-27（Asia/Shanghai）。

用户确认将当前功能分支并入最新本地统一基线。只读核对唯一 `baseline/` 分支为 `baseline/unified-20261026`，权威工作树仍为 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`；用户引用的 `cd5222e6` 已被后续图文修复推进至 `40a355341c5bed54698202d8524dac82521946a1`。本轮基于实际新基线整合，没有回退这些修复。

来源 `feature/intelligent-analytics-page-20261027`：功能提交 `57dc0fc6`，书签补充修复 `4fcaed5d`。隔离候选 `/Users/julia1/Documents/ChatGPT/基线管理/business-overview-safe-20261027`，分支 `integration/business-overview-safe-20261027`。源码合并 `e102fc2c`，追加合并 `0b72de2cd9f9cde80ecfe3a2ee7016f54b1b0f29`，均无冲突。

## 内容与界限

经营总览首屏收紧；曝光公式、Meta 同账户同周期报告、三栏投流与半透明漏斗；灵小枢原对话框直接加宽为周任务视图，底部窄输入栏、右上角扇形返回按钮。展开隐藏左侧书签及边距，收起恢复入口。浏览器验证草稿保留、返回聚焦及展开无书签。

企业目录补充仅在开发、指定租户、回环访问与显式私有文件配置下开启。真实已返回指标（含零）优先，缺失值按用户要求补足；界面不另加 mock 标签。目录私有文件、媒体副本、数据库、凭据、环境配置及预览服务不随 Git 合并迁入基线，也未写入真实供应商或数据库。

## 验证

- 全量 TypeScript `node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit` 通过。
- 28/28 定向测试：Meta 经营报告、广告路由鉴权、经营总览/首页/全局助手合同、输入栏、周任务日历、企业补充数值守恒及图文 buyer-copy 回归。
- `ARCHITECTURE_BASE_REF=40a35534 node scripts/check-architecture.mjs`：3041 个生产 TypeScript 文件及预算 ratchet 通过。
- 207 项迁移清单只读检查、迁移校验和 guard 通过；相对 `40a35534` 无迁移或 checksum 清单变更。
- 主站及 account-hub 双端构建通过；已有大 chunk 提示保留，Studio 预算通过。
- `git diff --check 40a35534 HEAD` 通过。

## 保护与恢复

原基线 26 项已跟踪修改和 15 个未跟踪文件不纳入本轮提交。推进前后比较完整 tracked patch SHA-256 及所有未跟踪文件内容哈希。原补丁 SHA-256 `2f8bbbec2c100c85c6ae68916819b6ff08325f57490751a7bd8adde96c683d93`。证据目录 `/Users/julia1/.codex/integration-evidence/20261027-business-overview/` 保留原 patch/status/文件哈希、未跟踪 tar 及命令日志。恢复点 `backup/pre-business-overview-20261027-40a35534` 保留旧 HEAD。

仅在基线 HEAD 与原内容指纹均未变化时执行 `git merge --ff-only integration/business-overview-safe-20261027`。未运行全仓 quality/verify、真实供应商 E2E、推送、部署、数据库迁移或其他来源树清理；本地预览仍指向功能树，源码合入不代表基线运行环境已更新。
