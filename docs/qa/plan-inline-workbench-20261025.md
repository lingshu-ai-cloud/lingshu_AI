# 计划管理紧凑表格与行内预算

源码：`feature/platform-ads-20261025`，HEAD `dfc9b0c8af85175485cf39370eed92c4be3daedd`，原未提交改动保留；未推进集成基线、未提交或发布。

## 实现范围

- `AdPlanManagement.tsx`：六列紧凑表格、单行展开、筛选／分页／收起在预算保存时受控，列表去掉三按钮与 KPI 带；原高级操作在展开面板保留。
- `AdPlanBudgetDialog.tsx`：增加 inline 展示，Modal 原入口继续可用；保存、幂等请求、版本校验、平台预算核对、待核验限制不重建。行内去掉重复概况，记录与回执折叠。
- `useAdPlanOperatingData.ts`：读取原 metrics／meta-audit／automation API，分批并发，局部失败分别标记，切换计划／版本后中止旧请求；查询不执行广告动作。
- `adPlanRow.ts`：当前版本的平台状态展示、多资源状态保留、AI 决策来源与初始方案建议区分。
- `AdPlanThumbnail.tsx`：保存素材复用原 AdHistoryMedia；平台封面复用既有广告素材 GET，缺失／失败有独立提示。
- `PlatformAdsPage.tsx` 接入原任务更新回调；`platformAds.css` 仅计划页紧凑页头、行和展开面板样式。UI 规则写回权威规范；两份新增测试纳入原 `test-platform-ads.mjs`。

## 测试与联调

- 定向命令：`node --import tsx --test src/components/useAdPlanOperatingData.test.ts src/lib/adPlanRow.test.ts src/components/AdPlanOperations.test.tsx src/components/AdPlanWorkspace.test.tsx src/components/PlatformAdsPage.contract.test.ts`，31/31 通过。
- 覆盖原平台预算幂等／结果未知／只读计划／管理方式限制；新增行内保存不挂 Modal、版本和原配置保留；平台审计版本／截断／多资源状态、AI 历史来源；部分读取失败和切换范围后的晚到响应丢弃。
- 新测试首次出现夹具名称断言及缺失 checkedAt 的类型错误，均修正为实际夹具名称与完整类型夹具；不把这两次失败记作通过。
- 本地浏览器：默认 1280×720，列表行高 53px，一屏完整 8 条；点击标题、预算单元格及收起按钮均验证，预算面板在原行下、无 Modal。默认窗口验证，不宣称实际 1137×652 窗口实测。
- 在既有测试草稿 `xwc65hyboyht7wv`（聊天渠道流程冒烟·仅草稿·20261025）实际保存日预算 20→21，列表回显 21，再恢复 20；后台读回 version=3、budget=500、dailyBudget=20、countries=[CA]、原 Messenger 选择保留、status=draft、executions=0。没有其他计划写入。
- 读回证据：`tmp/ads-preview/plan-inline-readback.json`。截图：`plan-inline-list.jpg`、`plan-inline-budget.jpg`。无新增真实广告执行 run/task。

## 限制与恢复

- 未修改后端、迁移、部署策略或外部请求保护；真实平台启用／调预算受既有权限和发布策略约束，未执行真实广告写入。本地数据持久化不代表真实供应商 E2E 验收。
- 自动刷新依旧是页面可见时每分钟检查，非毫秒级实时流。历史导入无当前审计资源时显示待回传，不使用本地 active 标志冒充平台状态。
- 原高级操作入口保留，尚未把所有广告编辑／审批动作搬进行内面板；本次完成的是列表密度、状态／预算／建议承接和行内预算编辑。
- 恢复点为上述 HEAD 与保留的未提交工作区；测试草稿金额已恢复，但版本和本地更新时间正常递增，不回滚历史。

## 最终验证

- `node scripts/test-platform-ads.mjs`：71 个投流领域测试文件全部通过，新增只读范围隔离及平台读回展示测试已纳入。定向 31 项最终通过。
- `pnpm run lint`：最终退出 0（TypeScript）。首次新测试夹具类型缺失已修正，最终日志不再报错。
- `pnpm run check:architecture`：通过，2773 个生产 TypeScript 文件；未设置 ARCHITECTURE_BASE_REF，未执行 ratchet，不作为新基线验收。
- `pnpm run build`：通过；原有大 chunk 提示保留，Studio chunk 367202/485000，边界检查通过。
- `git diff --check`：通过。未运行全仓 quality／verify 或真实供应商写入 E2E。
- 日志：`tmp/ads-preview/plan-inline-domain-final.log`、`plan-inline-lint-final.log`、`plan-inline-build-final.log`、`plan-inline-architecture.log`、`plan-inline-tests.log`。
- 最终补充：草稿保存和平台调整返回（包括结果待核对）均通知父列表立即重读；测试覆盖了草稿保存与平台未知结果下的刷新回调。预算记录折叠不改变执行校验。标题、非交互单元格和收起按钮最终逐项核对，临时浏览器标签已关闭。
