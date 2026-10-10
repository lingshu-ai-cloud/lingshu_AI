# 素材补充与账号修复适配验收

新增 `server/mobileWorkbenchInterventions/materialConnection.ts`。

- `material_fulfillment` 提交 shootingTaskId、materialIds、checkpointId、expectedVersion；先验证企业、任务版本、素材所有权及拍摄要求，再关联素材，最后调用真实恢复能力。
- `connection_repair` 提交 accountId、requiredScopes、checkpointId；实时权限验证通过后才调用恢复能力，不信任持久层 connected 标记。
- 素材上传入口为已有 `/api/overseas/studio/materials/file`。OAuth 使用已有 `/api/overseas/social/oauth/:platform/start` 和 status 路由；详情不输出令牌。
- 缺少真实 resume 或实时验证实现时，动作明确不可用，不将关联素材或读取 connected 状态视为恢复完成。

公共路由集成时必须从服务端事项记录提供 checkpoint 和 requiredScopes，并在恢复实现内验证该 checkpoint 属于当前企业、账号和任务，不能信任客户端提供的作用域。现有 shooting_tasks 上传关联仅保存素材引用，没有 checkpoint 自动恢复导出；平台 OAuth 已有，但实时 scope 复检没有公共导出。以上是实际剩余能力，不能靠自然语言 retry 补齐。

测试覆盖企业隔离、令牌过滤、不可用能力拒绝、素材版本冲突、所有权验证、结构化恢复和 connected 标记不能替代实时复检。4 项测试通过。
