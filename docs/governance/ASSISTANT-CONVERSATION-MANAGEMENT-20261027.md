# 灵小枢会话管理：本会话工作树封装

日期：2026-10-27（Asia/Shanghai）。用户确认仅封装到本会话工作树，不推进共享集成基线。

## 源码快照

- 工作树：`/Users/jiejie/.codex/worktrees/1569/lingshu-AI`
- 分支：`codex/assistant-conversation-management-20261027`
- 功能提交：`93c138abd0ff89d0afb1158070d4be0b21d425b8`
- 父提交 / 安全恢复参考点：`0c4fda229bf564dbde2120e446aec5e9f6ba8397`
- `/Users/jiejie/Documents/lingshu-AI` 的共享基线未变更；本记录不替代 `BASELINE.md`。

## 范围与数据边界

- 支持新建、历史列表、切换、清空当前会话及删除会话；危险操作需二次确认。
- 清空保留会话身份；删除使用墓碑隐藏会话并开启新会话。已有任务、素材、企业资料和长期记忆不删除。
- 用户/租户隔离、版本校验、重置版本和请求失效控制防止旧保存或旧流式响应恢复已清空内容。
- 未明确结果的任务请求保留恢复凭证，阻止会话管理操作；不取消已创建的业务任务。
- 主要文件：`useAssistantConversationManagement.tsx`、`assistantConversationLifecycle.ts`、`assistantThreads.ts`、`assistantThreadJournal.ts` 及其调用方和回归测试。完整清单见功能提交。
- 新增迁移 `1793059200_assistant_conversation_lifecycle.js` 及校验和；本任务未应用数据库迁移。

## 验证证据与限制

封装前执行以下定向命令，退出码 0，20 项通过：

```sh
./node_modules/.bin/tsx --test --test-concurrency=1 src/components/assistant/globalAssistantRuntime.hydration.test.ts src/components/assistant/useAssistantThreadSaveQueue.test.tsx server/routes/assistantThreads.actions.test.ts src/components/assistant/useAssistantSend.test.tsx
git diff --cached --check
```

- 测试基于当时工作区，含保留的其他未提交改动；未对独立导出的干净快照复跑。
- 前序验证：31 项定向测试通过；`node scripts/check-architecture.mjs` 通过（3001 个生产 TS 文件；未设置 `ARCHITECTURE_BASE_REF`，ratchet 未执行）；`tsx scripts/check-digital-employee-migrations.ts` 只读检查通过（205 项）。本次未重复这些较大检查。
- 完整 TypeScript 检查因内存/交换空间压力中止，退出码 143，未获得通过结果。按用户要求不再进行复杂检查；未跑完整 quality/verify，不能据此声明整体验收或发布就绪。
- 之前已检查菜单、历史及删除确认/取消；未手动删除用户已有会话数据。

## 交接

- 其他界面、快捷回复等未提交改动留在原工作区，未混入功能提交；`node_modules` 为本地依赖链接，不纳入版本控制。工作树并非全量干净。
- 预览入口：`http://127.0.0.1:5291/?page=strategy&view=inspiration&previewRevision=conversation-management`。预览/运行数据与源码快照是独立状态。
- 未推送、未部署、未进行真实供应商调用；无外部 run/task 标识。共享基线集成及完整 TypeScript 验证仍需另行安排。
