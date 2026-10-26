# 灵枢 AI 统一基线合并验证（2026-10-26）

## 目标与恢复点

- 用户要求合并验证为最新基线。新默认分支 `baseline/unified-20261026`，工作树 `/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。
- 首页来源：`xixi首页对话+视频任务创建` / `ff43ca6192dbd12c47e7456f31a4581ebf6f017e`；`xixi投流+卡片前端` 为同提交别名。
- 图文来源：`xixi联合功能模块后端改` / `7f8bd61c0aecf9133654c3a5d7430199b11d46e6`。
- 共同祖先 `8c7cc7d304ffd268fcd5f20deeabf68fb5f8b10d`；合并前双方各独有 3 个提交。
- 双亲源码合并 `280b54973be6a8cf863cdef98183cf12fa88581f`。本报告及基线清单另以独立治理提交记录，不改变生产源码。
- 两个来源均通过 git merge-base --is-ancestor 检查；原三条来源/别名引用保持未变。恢复时从来源精确 SHA 新建工作树，不重置有未提交内容的目录。

## 冲突与集成修复

7 个冲突文件：BASELINE.md、WORKTREE-INVENTORY.md、产品 UI 规范、shared/contracts/assistantCreationPortal.ts、src/lib/assistantHomeQuickPrompts.ts、对应提示词测试、src/styles/creator-workspace.css。

- 治理和双方有效 UI 规范保留，最新统一声明置顶，下方均为历史检查点。
- 首页保留四个现行视频/内容场景，追加第五项图文爆款复刻，快捷入口为“点击开始创作”；两组业务样式保留，任务日历与经营总览不回退。
- 共享门户同时保留视频场景字段和图文参考字段，保留图文类型与 imageReplication 的一致性校验。
- 自动合并后发现“帮我复刻一张爆款图文海报”被旧视频识别提前接走。新增 Hook 行为回归先失败（video != image），再将显式图文识别前移并让通用视频场景避让；修复后通过，原视频、带图和普通聊天回归通过。
- 相对首页来源共 26 个文件变更，清单用 git diff --name-status ff43ca61 280b54973be6a8cf863cdef98183cf12fa88581f 复核。没有修改依赖版本、锁文件、架构预算或迁移文件。

## 实际验证与首轮失败

- 首批 14 个文件定向测试 47/47，通过，targeted.log。
- 图文路由行为：image-routing-before.log 复现失败，修复后 image-routing-after.log 通过。
- pnpm run test:image-replication：16/16。
- pnpm run test:social-image-pipeline：85/85、HTTP 集成 1/1，路由及构建治理合同通过。
- pnpm run test:image-replication-ui：灵感入口、带图对话、首页第五卡、授权不足停止，共 4 场景通过。已查看五卡桌面布局和桌面/手机确认页截图；API 为隔离替身，不能作为真实模型生成证据。
- pnpm run quality 首轮在 test:gap-v1-release 的 external-video-approval 子步骤因 PB_BIN 未配置停止。此前社媒隔离数据库安装/升级/备份恢复、HTTP 权限与 worker 恢复已通过。显式设置已有 `/Users/julia1/.local/share/lingshu/pocketbase/pocketbase` 后，从失败子步骤继续并逐项完成 quality 后续全部阶段。
- 后续命令/日志/退出码见 continuation-results.json，全部退出 0；覆盖共享契约、运行时与周任务整链、容量、安全、账号中心、素材导入、助手、starter/social-content 前端、社媒、周发布、来源追踪、生产、投流、类型及双端构建。
- 周任务 42/42、本地媒体生产 1/1；生产 214/214、桌面组合 2/2；投流 73 文件通过。4GB TypeScript、2867 个生产 TypeScript 的架构/预算 ratchet、203 项迁移只读及 guard、主站与账号中心构建通过。Studio chunk 371889/485000 字节。
- git diff --check 8c7cc7d3 HEAD 通过。没有迁移/锁文件变化；数据库测试仅操作临时测试实例，没有迁移生产或已有业务数据库。
- 这是 quality 全部阶段分段通过，不声称单次 quality/verify 成功，未另跑全仓 pnpm test。原构建大小与弃用提示仍存在。

## 保全与使用边界

- 原图文线 server/index.ts 未提交文件与二进制 diff 均与合并前相同；文件 SHA-256 `2e3f45a5e129e57eed2c279d5cd74f79c07bc16c0e63ef5229d5d9874493b08d`。原首页树未修改。
- 本轮新生成的未跟踪 finalization 测试缓存移入证据目录保留，未混入提交。
- 证据：`/Users/julia1/.codex/integration-evidence/20261026-unified-baseline`，包含来源、冲突选择、首轮失败、分阶段通过日志、截图和原补丁。
- 没有真实供应商任务/费用回执；外部验收均为本地或受控测试。未真实发送、投放、操作生产库、推送、创建 PR 或部署；其他聊天的付费冒烟授权不延用到本轮。
- 后续企业知识库从统一基线新建功能分支；源码验收不代表原预览实例已更新或真实供应商 Ready。
