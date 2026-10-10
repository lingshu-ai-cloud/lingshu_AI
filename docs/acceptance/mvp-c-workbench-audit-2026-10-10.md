# 会话 C：三栏工作台身份审计

日期：2026-10-10。范围：前端只读导入护栏、原周任务成片身份回归；没有部署、付费调用、真实发布或新 MVP 媒体生成。

## 已补齐并验证

- 工作台轮询只接受当前登录下请求的 taskId，要求 task.version 有值，并核对 sources/artifacts 的 taskId。登录变更、切换任务或卸载后，延迟回包不能导入编辑器或刷新素材绑定。
- 已有参考分析指向的 source 不存在或停用时，不再将该分析附到另一条活动参考视频。
- 原周任务查看回归保留 tenant/program/package/packageVersion/executionTask/task/run/artifact/version 精确绑定；原运行没有产物时不取新运行的成片，分镜回包身份不符时拒绝展示。

验证命令（本地依赖的 Node 加入 PATH）：

```sh
pnpm exec tsx --test src/lib/studioSocialTaskRead.test.ts src/lib/weeklyContentProductionView.ownership.test.ts
pnpm exec tsx src/components/socialContent/useStudioSocialTaskHydration.test.ts
pnpm exec tsc --noEmit
```

结果：8 个身份及原运行回归通过；既有 hydration 测试通过；TypeScript 检查退出 0。测试夹具不代表真实供应商文件或实际浏览器人工验收。

## 页面验收仍缺的合同

1. **冻结脚本导入。** task.replicationScript 提供 status/version/referenceAnalysisId/shots/narrationLines，但通用 hydration 主要导入参考 VideoKickoff 与素材索引；AiCreateStudio 仅在 localGateBypass 下把参考口播方案直接写入 script。不能把这项本地演示行为当作真实成片项目已导入冻结脚本。需要建立 task/run/scriptVersion/referenceAnalysisId 到 project/assembly/slot/shotId 的持久绑定，并带入 confirmed 脚本、字幕、口播、素材、生成 provenance/record 和质量记录；不可仅 setScript 后绕过生成/质检记录。恢复已有工程时，必须核验绑定后才导入，不覆盖用户编辑或后续版本。
2. **全片实际费用。** SocialContentTaskDetail 的 productionProgress 只有步骤、活动、剩余时间和更新时间；agentWorkflow 提供执行预估，没有全片实际账单投影。数字人逐镜 execution 有 actualCostCny/costStatus/costSourceRef，不等于全片费用。需要只读合同返回同租户/task/run/version 的预估与实际分别汇总，逐项包含 provider/request/execution/media 身份、币种、账单来源和核算状态，并按幂等付费请求去重。未知、待账单、缺失来源保持未核验，不能补零，也不能把预估显示为已结算。该合同属于后端扩展，本次没有编造字段或改其他会话后端文件。
3. **真实页面闭环。** 等 A/B 提交同租户/task/run/version 的真实视频片段和费用凭据、合成工程与 MP4 后，需要实际打开经营任务卡，核对脚本/分镜/口播/素材/进度/预估及实际费用/成片一致，并保留浏览器证据。当前静态合同与夹具不能代替该检查。

## 八项口径

| 口径 | 本轮结果 |
| --- | --- |
| 本地受控合同 | 上述前端身份回归通过，完整 MVP 页面验收未完成 |
| 真实媒体文件 | 本子任务没有生成；旧 8.56 秒失败片不计为新 MVP |
| 真实付费供应商 | 未调用 |
| 创意质量 | 未取得本轮真实成片人工验收 |
| 真实发布 | 未执行 |
| 真实平台回执 | 未取得 |
| 真实指标 | 未回收 |
| 生产 ready: true | 未核验，不声明通过 |
