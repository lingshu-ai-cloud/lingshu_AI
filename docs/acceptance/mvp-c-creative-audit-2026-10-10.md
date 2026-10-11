# 会话 C：创意及人工验收审计

日期：2026-10-10。范围：现有 G5 创意审核服务，未调用付费供应商，未部署或发布。

## 发现与修复

现有 G5 并不把 `productionResult.creativeReview.approved` 当独立人工验收。它从当前租户、任务、run、artifact 获取真实文件，校验成片 SHA-256、冻结脚本/分镜、G4 当前回执、事实版本、审核人分配和权限。审核及回执绑定 sourceHash，媒体或事实漂移后失效；unknown 与未完成审核不放行。

发现 G5 对镜头时间只检查有限数和 end > start，因此缺失开头、镜头间隙或重叠仍可能进入人工/Agent 审核。新增时间线检查要求起点为 0、非负且有限、连续按顺序排列；仅允许 1 ms 的舍入误差。失败时加入 `rendered_script_timeline_unverified`，既有 human/agent 执行入口均由 context.gaps 阻塞，不发起新的付费审查。

## 验证

使用仓库 tsx 执行：

```
tsx --test server/starter198/socialDirectorG5Timeline.test.ts server/starter198/socialDirectorG5ReviewService.test.ts server/starter198/socialDirectorG5AccountRules.test.ts
```

32 / 32 测试通过。新增 10 项时间线合同测试覆盖有效连续时间线、舍入及空/负/缺开头/间隙/重叠/倒序/非有限/零时长。既有服务测试覆盖真实本地文件哈希漂移、独立人工权限、审核费用、unknown、暂停取消、source 漂移和 account rule coverage。

## 本次真实创意验收

尚未接收本次 A/B 同租户、task、run、version 的真实数字人和关键 AIGC 片段，尚未形成新成片，因此人工创意验收未完成。技术合同通过不代表镜头语义、口型、声音、品牌或钩子质量通过。历史 8.56 秒视频已知创意失败，不可作为本次通过证据。

八项口径：本地受控合同通过；本子任务仅使用既有测试夹具生成本地媒体，不构成 MVP 新成片；未调用真实付费供应商；创意验收未完成；未真实发布；无真实平台回执；未回收真实指标；本次未核验生产 readiness，不能报告 ready:true。
