# 文档权威与生命周期

## 权威顺序

1. `harness/CURRENT_BASELINE.md`：当前集成身份与运行限制。
2. 已批准的 `harness/build/phase-*.md`：本次任务范围、非目标和验收条件。
3. `docs/product/PRODUCT_BASELINE.md`：当前有效产品规则。
4. `GOALS.md` 与 `PLANS.md`：长期目标、非目标和阶段顺序。
5. `AGENTS.md`：永久工程纪律与安全边界。
6. ADR：已确认的重要决策及其原因。
7. 历史 PRD、联调记录、会话转接、讨论稿：仅作证据和背景，不能在未经确认时覆盖上层文件。

## 文档归属

| 内容 | 唯一归属 |
| --- | --- |
| 长期工程规则 | `AGENTS.md` |
| 项目目标和非目标 | `GOALS.md` |
| 阶段顺序 | `PLANS.md` |
| 当前产品规则 | `PRODUCT_BASELINE.md` |
| 当前代码基线 | `CURRENT_BASELINE.md` |
| 单次开发范围 | `harness/build/phase-*.md` |
| 实际执行证据 | `harness/build-log.md` |
| 重要规则改变原因 | `docs/adr/ADR-*.md` |
| 可复用会话口令 | `PROMPTS.md` |

## 历史文档规则

- 不删除历史文档来制造“唯一版本”；先通过本文件明确其权威性。
- 历史文档若仍有有效规则，需将该规则提炼到 `PRODUCT_BASELINE.md` 或 ADR，并标注来源。
- 新开发不应要求完整读取所有历史 Markdown；只读取与当前阶段直接相关的权威源和最小必要证据。
