# 客服版本合入开发基线

日期：2026-10-24（Asia/Shanghai）。用户明确确认将当前客服版本合入 `xixi投流客服整合补齐基线v1`，本轮仅本地集成，不推送、部署或调用真实模型/渠道。

## 分支与提交

- 来源目录 `/Users/julia1/Documents/ChatGPT/1024客服`，分支 `feature/customer-service-20261024`。整理前 HEAD 为 `89b175109149d4551aeb3ce590fe9c42c46bf23c`，80 项源文件修改与最后已通过的源码哈希一致，另纳入对应 QA 和脱敏证据。
- 目标目录 `/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`，分支 `xixi投流客服整合补齐基线v1`；合入前干净，HEAD 同为 `89b175109149d4551aeb3ce590fe9c42c46bf23c`。
- `5b4ebad7`：客服紧凑界面、报价弹窗及全文插入、标签纠正、静默画像分析、本地草稿/审批/发送账本组合与隔离加固，含相应测试、规范及证据。
- `1acf73f5`：将两份原始构建日志压缩归档，保留字节和校验值，解决日志尾部空格造成的差异检查问题。首次源码提交先于这项归档调整完成，目标仅在整段差异检查通过后推进。
- `6b5c30224fb31115d35f584e33271cd3ebee3653`：基线回归发现的详情展开区契约测试修复。原断言用 400 字符距离判断结构，新增状态文字后失效；改为检查实际 `<details>…</details>` 块包含 `CustomerInsightDisclosure`，保留原布局约束。
- 上述提交均在来源分支完成，再使用 `git merge --ff-only feature/customer-service-20261024` 快进目标，无冲突、无跨目录复制运行数据。下方验证针对 `6b5c3022`，后续治理提交仅记录本次基线与验证。

## 在目标基线工作树实际重跑

`pnpm run test:customer-candidate`：编排契约 2/2，启动隔离 1/1、隔离/AI 作用域 9/9、pipeline 93/93、完整客服 67/67、WhatsApp onboarding 12/12、报价/标签/静默画像等专项 90/90，全部 0 失败、0 跳过。组间重叠，不相加为独立用例总数。功能组显式关闭真实 AI 并使用 guard/canary 及受控模型端口；测试中被拒绝的存储探测日志不代表真实出网成功。

`ARCHITECTURE_BASE_REF=89b17510 NODE_OPTIONS=--max-old-space-size=4096 pnpm run check:customer-candidate`：TypeScript、架构/ratchet、ratchet 自测、197 项迁移文件只读检查、临时目录迁移 guard fixture、构建和 `git diff --check` 全部退出 0。Studio 368838/485000 字节，原大 chunk 提示保留。没有执行目标数据库迁移；迁移 fixture 的 Git 操作只在临时目录。

两组执行前后均记录 5262 个源文件/脚本/配置/规范/迁移路径哈希，HEAD 与哈希一致，归档时再次核对未改变。另执行 `git diff --check 89b17510..HEAD`，整段集成差异通过。静态检查为已审阅的文件/构建命令，不宣称与功能组具有同等级进程网络隔离。

首次完整客服为 66/67，静态当次通过；失败原因及修复如上，原日志和失败结果 JSON 已保留。修复后在新提交上重新运行全部候选功能及静态矩阵，不沿用首次通过数字。完整日志、压缩原始结果和 SHA-256 索引见[基线集成证据](evidence/customer-baseline-integration-20261024/index.json)。

## 状态与恢复边界

源码已合入本地开发基线；本地预览仍由原客服工作树和独立运行数据提供，本轮没有迁移账号、密钥、会话或发送记录，也未启动基线目录的服务。源码集成不代表真实供应商 Ready 或发布就绪。

真实模型标签再分析及真实渠道 OAuth、模板、发送、回执尚无本轮 E2E；WhatsApp 原生入站自动模型分类未在本次扩展。静默画像的后台重启恢复仍为受限显式服务入口，未自动绑启动。历史隔离误触响应缺证继续保留，不能改写历史。未运行全仓 quality/verify、远端 CI；未刷新或推送远端引用。

恢复点为原基线 `89b17510`、来源源码 `5b4ebad7` 及最终验证提交 `6b5c3022`；分支和运行数据均保留，无 reset/stash/clean、归档或工作树删除。本轮无外部 run/task/receipt。当前治理记录见 [BASELINE.md](../governance/BASELINE.md)。
