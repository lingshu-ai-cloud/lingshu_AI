# 场景知识包租户编辑验证

- 工作分支：`feature/enterprise-knowledge-20261026`，修改前恢复点：`035c8a1e5ec4b5db79f0983f403cb1bb1c8a5c09`。
- 交互：双击场景卡片或点击编辑，在弹窗修改问答并保存。仅写入认证租户的 `faqPackOverrides`；公共模板保持不变，导入和客服批准流程仍独立。
- 持久化：复用企业资料 PATCH、If-Match 版本检查及保存后读回。仅提交场景覆盖，不保存其他企业资料草稿。身份改变时阻止继续操作。

## 实际验证

- 定向测试：`node --import tsx --test --test-concurrency=1 server/routes/tenantFaqPacks.test.ts src/components/enterprise/tenantFaqPackApi.test.ts src/components/enterprise/EnterpriseFaqPanel.test.tsx`，9/9 通过。
- 企业领域回归：enterprise 全部组件测试、EnterprisePage 布局/深链、onboarding 契约、资料归一化、企业事实、新手草稿及租户场景测试，75/75 通过。
- `pnpm run lint`、`pnpm run check:architecture`、架构相对恢复点检查及 `pnpm run build` 均通过。生产 TypeScript 文件数 2873，未增加预算或豁免。
- 隔离测试使用两个临时租户：A 修改后 B 保持公共模板；伪造 query/body 租户 ID 不能写入 B；未认证返回 401；旧版本返回 409；A 导入定制答案仍未自动批准；公共 JSON 文件字节未变化。
- 本地浏览器实际执行双击打开、修改、保存、刷新后核对持久化；随后恢复原 Mock 答案，校验标记未保留。原始工作区数据未修改。
- 测试初次运行的 HTTP harness 缺少本地数据权限绑定，修正测试 harness 后通过；未绕过生产原子性检查。

证据目录：`/Users/julia1/.codex/integration-evidence/20261026-tenant-faq-packs/`。本地预览：`http://127.0.0.1:5295/?page=enterprise`。

本次仅源码和本地 Mock 预览验证，未执行生产写入、迁移、推送或部署。
