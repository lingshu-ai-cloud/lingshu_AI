# 计划成效查询状态修复

工作目录：`/Users/julia1/Documents/ChatGPT/1025投流`；分支 `feature/platform-ads-20261025`；HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`。在原有脏工作区上定向修改，未提交、合并或更新集成基线；保留无关改动。

## 判断与范围

本轮此前只读检查可见十条成效请求均 HTTP 200：九条草稿返回 not_ready/none；一条平台报告返回空指标。未复现用户此前的瞬时查询失败，原 UI 丢弃异常细节，无法证明当时为授权、网络或上游错误。不能以当前成功报告解释过去失败。

修复查询状态呈现与恢复动线，不改变投放执行、预算写入或授权流程：
- 未投放仅基于同任务同版本且无待核对／截断的空审计，其他无报告情况单列；空平台报告与真实零结果分开。
- 同范围同版本刷新保留成功值，失败标记上次数据和原因；单条重试仅一个 metrics GET。切换版本与范围丢弃旧缓存，晚到响应不能覆盖新范围。
- 点击成效说明查看查询与平台时间。错误详情含实际公开错误、稳定 code 与 HTTP 状态；服务路由新增 code 字段，旧进程仍可按 HTTP／message 兼容。

改动文件：`src/lib/adPlanMetricState.ts`、`src/components/AdPlanMetricsCell.tsx`、`src/components/useAdPlanOperatingData.ts`、`src/components/AdPlanManagement.tsx`、`src/components/platformAds.css`、`server/routes/platformAdMetrics.ts`、`src/lib/adPlanRow.test.ts`、`src/components/useAdPlanOperatingData.test.ts`、UI 规范及本记录。

## 实际验证

- `node --import tsx --test src/components/useAdPlanOperatingData.test.ts src/lib/adPlanRow.test.ts src/components/AdPlanOperations.test.tsx src/components/AdPlanWorkspace.test.tsx src/components/PlatformAdsPage.contract.test.ts`：36/36。
- `node scripts/test-platform-ads.mjs`：71 文件通过。定向测试最终新增用例另由上述 36 项覆盖。
- `pnpm run lint`：通过（tsc --noEmit）。
- `pnpm run check:architecture`：通过，2775 生产 TS 文件；未设置 ARCHITECTURE_BASE_REF，ratchet 未运行。
- `pnpm run build`：通过，保留既有 chunk size 提示；Studio 367202/485000 字节及边界检查通过。
- `git diff --check`：通过。
- 本地浏览器真实已登录计划表显示一个“平台暂无成效数据”、九个“尚未投放”；打开说明显示最近成功查询／平台采集时间及原数据口径，不触发行预算展开。当前 899×652 窗口行高约 53px、七条完整记录，表格自身横向滚动，页面无整体横向溢出。更宽窗口目标八条沿用此前布局，本轮未重复改布局。
- 失败详情与重试使用隔离 VM 组件／Hook 测试覆盖，未故意破坏真实连接制造错误。

无外部写入 run/task；未改预算、创建／启用广告、重新 OAuth、付费模型请求、迁移、部署或重启共享后台。服务错误 code 的新增源码未在当前共享后台重启验收，前端 HTTP/message 兼容路径已生效。未知原始瞬时失败仍需后续实际回执定位，不能宣称供应商稳定性已解决。

恢复点为本轮修改前的同一 HEAD 与原脏工作区；如需恢复只审阅上述文件本轮差异，禁止 reset/clean 覆盖其他工作。

## 后续：用户要求复现并修复（同日）

- 当前分支／HEAD 未变，原有无关脏改动保留。本轮全部 14 个计划真实只读 metrics GET 均 HTTP 200，三个 source=provider 空报告，其余 source=none/not_ready；证据 `tmp/ads-preview/metrics-reproduction-live.json`。当前浏览器错误日志为空。仍不能把特定上游故障认定为历史原始事件。
- 隔离本机真实 HTTP 服务复现：同一路径第一请求 503、随后恢复 200；旧单 GET 直接进入失败，新 `readAdPlanMetrics` 一次有界重读取得 200。该服务只返回 fixture，不访问 Meta／业务数据库，不伪造真实供应商失败证据。
- 新读取 helper 仅对网络中断、NETWORK_ERROR／UPSTREAM_TIMEOUT，或无业务错误码／METRICS_UNAVAILABLE 的 502/503/504 等待 1 秒重读一次。第二次仍失败保留原错误；401/403、429、Meta 授权／限流码、报告不完整和404不自动重试；切换范围或卸载时取消等待。不重试任何广告写操作。
- 分钟轮询在读取或保存预算中跳过，避免慢请求被后续轮询中断而永远无法落下结果；行重试后禁用／恢复预览不再因遗留 retry ID 跳过其他行读取。
- API 失败返回 requestId，并输出只含编号、任务 ID、错误码、HTTP 状态的结构化日志；前端详情显示编号，内部未知异常不向响应或日志泄漏敏感消息。已按相同启动命令重启本地预览后端，端口9037、RUNTIME_ROLE=web不变（PID 3170→58758，backgroundJobs=false）。对不存在的 fixture 任务真实 GET 返回404／NOT_FOUND，并确认响应编号 cbfc2e88-d2d6-47ec-9da9-0918f5931863 与脱敏服务日志一致；未请求 Meta 写操作。证据 `tmp/ads-preview/metrics-recovery-correlation.json`。随后全部14条计划读取再次HTTP200。
- 追加改动：`src/lib/adPlanMetricsRequest.ts`、对应测试、`src/lib/platformAds.ts`、`server/platformAds/metricsReadFailure.test.ts`、领域测试清单；更新原 Hook、列表轮询、成效异常详情及规范。
- 定向命令增加 `src/lib/adPlanMetricsRequest.test.ts`、`server/platformAds/metricsReadFailure.test.ts`：43/43。包括真实本机 HTTP 503→200、持续失败限两次、不可重试错误、等待取消、查询编号和日志脱敏、慢读取／预算保存不触发轮询。
- `node scripts/test-platform-ads.mjs`：73 文件通过；最终轮询补测另由43项定向执行覆盖。`pnpm run lint`、`pnpm run check:architecture`、`pnpm run build`、`git diff --check` 均通过；architecture ratchet 未设置基准，未执行。本轮2776个生产TS文件，Studio 367202/485000字节；保留既有chunk size提示。
- 真实浏览器第一屏十条记录恢复完成，刷新按钮不再 loading，一条 empty、九条 not_ready；手动刷新同样恢复成功。未改任何投放配置／预算／授权，未新建或启用广告、调用付费模型、部署或迁移。

结论：已复现并修复瞬时读取错误的恢复缺陷及慢请求轮询中断问题；不能宣称已经找回历史原始事件的 Meta／网络错误回执，也不保证外部服务永不失败。持续失败现在保留真实证据以便进一步定位。
