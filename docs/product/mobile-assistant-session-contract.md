# 移动助手会话恢复合同

日期：2026-10-10。状态：代码与隔离接口测试完成，尚未部署或执行生产迁移。

会话复用 `assistant_threads`，追加 `userId`、`source`、`title`、`createdAt`。移动会话 source 固定为 `mobile_workbench`；桌面路由 source 固定为 `desktop`，并按企业和用户隔离。历史未记录用户归属的数据保留原样，不自动分配给任一登录用户；因此旧共享历史不会自动出现在新个人会话。

移动消息采用独立 append-only `mobile_assistant_messages`，避免整包数组覆盖导致并发丢失。消息的角色、正文和命令关联参与幂等校验，相同重试返回原消息，冲突返回 409。

## HTTP 接口

统一挂载在已认证 `/mobile-workbench` 下，认证身份由 `res.locals` 提供，不接受请求中的 tenant/user。

- `GET /assistant/sessions?page=1`：当前用户移动会话，每页 30 个，最新创建优先。
- `POST /assistant/sessions {title?}`：创建会话，title 最长 100 字；返回 `{session}`。
- `GET /assistant/sessions/:id/messages?page=1`：每页 50 条，最新页优先，页内按对话顺序返回；包含 `{session,messages,receipts,page,totalPages}`。receipt 在恢复时重新读取权威状态。
- `POST /assistant/sessions/:id/messages {role:'user',text,clientMessageId,commandId?}`：正文最长 12000 字，只允许用户角色，客户端不能伪造助手。
- `POST /assistant/sessions/:id/commands {commandId,clientMessageId}`：校验当前用户的真实命令回执，写入服务端生成的受理提示；不将“请求已受理”表达为“业务已完成”。

服务器通过 `appendMobileAssistantMessage` 保存助手回答，通过 `findMobileAssistantMessage` 恢复同一个请求已有答案。命令关联必须属于同一企业和用户。支持访问会话只能读取，所有写请求返回 403。所有响应 `private, no-store`；数据库不可用返回 503，不降级为空历史。

## 验证

`tsx --test server/routes/mobileAssistantSessions.test.ts` 验证租户和用户隔离、服务端助手写入、客户端角色伪造拒绝、长度和分页校验、消息幂等冲突、支持只读、命令归属以及跨设备恢复时读取命令最新状态。

需要集成的迁移：`1791640000_mobile_assistant_sessions.js`。主协调负责迁移清单和路由接线；此模块不执行部署。
