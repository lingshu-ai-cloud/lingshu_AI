# 会话 C：单条成片与工作台验收（2026-10-10）

## 当前结论

本轮已推进本地合同和失败门禁；**真实 MVP 尚未通过**。没有收到同一租户、任务、run、版本的 A 数字人/口播与 B 关键 AIGC 片段交接清单，因此未合成新的真实 MVP 成片，也没有人工创意放行。历史 8.56 秒 MP4 保持“技术曾通过、创意未通过、不可发布”，不复用其通过状态。

权威源码为 `/Users/julia1/.codex/.chatgpt-projects/g-p-6ac46f113a0c8191968cd499b8c020f6/local-integrated-flow`。按 AGENTS.md 只做本地开发、测试与独立提交。

## A/B 接收合同

空模板位于 `fixtures/mvp-session-c/handoff.template.json`。模板没有真实身份或供应商证据，执行后必须阻塞。`expectedScope` 应由当前任务的权威记录独立选定，不能从待验片段反推；四个字段 `tenantId/taskId/runId/version` 用非空字符串，版本应统一规范化。

每个 artifact 使用 `{role, scope, file, sha256}`。必须各有一份 reference、script、storyboard、voiceover、digitalHuman、aigc、enterpriseMaterial、finalVideo；文件路径相对交接清单所在目录。数字人和 AIGC 另需 `provider:{name,taskId,rawReceiptRef}` 和 `cost:{estimated,actual,currency:"CNY",ledgerRef}`；企业素材另需 `authorizationRef`；成片另需 `sourceSha256s` 绑定口播、数字人、AIGC 和企业素材字节 hash。报告字段沿用模板；技术报告必须真实生成，创意报告必须人工签认。

```sh
node --test scripts/mvp-session-c-intake.test.mjs
node scripts/mvp-session-c-intake.mjs work/mvp-c-handoff.json work/mvp-c-intake.json
```

接收器只读取本地文件并检查 scope、hash、必需证据字段和成片来源绑定，不调用付费供应商。输入缺证据以 exit 1 输出 blocked；输入不可读或输出已存在以 exit 2 失败，避免覆盖旧报告。输出永远保留 `runtimeVerified/providerVerified/creativeAccepted/mvpPassed:false`，即使合同 consistent 也不能当作真实通过。JSON 回执引用、hash、费用或 reviewer 字段可以被编辑，必须进一步在同租户正式记录、真实原始供应商回执、费用账本与人工报告中核对。

接收真实片段后的必要步骤：核对 A/B 身份和授权 → 验证实际媒体可播放及供应商来源/费用 → 在原任务合成 → 对最终字节重新执行技术与创意检查 → 人工确认钩子、节奏、卖点、品牌、数字人观感与关键镜头 → 从任务卡进入三栏台核对所有过程数据。缺素材、身份冲突或任一检查失败，保持阻塞。

## 八项口径

| 项目 | 本轮状态与证据 |
| --- | --- |
| 本地受控合同 | 接收器 2 项测试通过；技术、创意、工作台回归结果见下方。合同测试不代表真实供应商验收。 |
| 真实媒体文件 | 本轮未生成新的 MVP MP4；历史 8.56 秒文件不计为通过。 |
| 真实付费供应商 | 会话 C 未调用；A/B 本轮同身份交接证据尚未收到。 |
| 创意质量 | 未完成人工验收，不可发布。 |
| 真实发布 | 会话 C 未执行；由 D 负责。 |
| 真实平台回执 | 本轮未取得。 |
| 真实指标 | 本轮未回收，不以 0 替代缺失。 |
| 生产 ready:true | 未证实。既有验收文档记录 ready:false 与公网 ready 路径返回 HTML；本轮没有远端复核。 |

## 已发现并修复的本地门禁

- 技术：冻结报告不能用空对象、缺少视觉/音频/镜头字段或零检测镜头放行；镜头数必须匹配实际生产缓存。
- 创意：人工 G5 的镜头时间线必须有限、从零开始、连续且无重叠，错误时间线不得进入人工签认来源。
- 工作台：加载回包必须匹配当前 taskId，并防止登录凭据变化或过期读取回写其他任务数据。

这些改动保护已有流程，不替代 A/B 真实片段和最终媒体的验收。工作台合同测试也不替代本轮真实任务的浏览器页面验收。
