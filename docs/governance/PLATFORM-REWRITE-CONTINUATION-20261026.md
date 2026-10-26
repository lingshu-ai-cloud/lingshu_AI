# 多平台改写改接当前内容创作

功能分支：`feature/assistant-scene-backend-closure-20261026`；修订起点/安全恢复点 `efe54f4df0d0ced6e534ee96bfb8dc5af7e0d81b`。本文件随修订提交，使用 `git log -1 --format=%H -- docs/governance/PLATFORM-REWRITE-CONTINUATION-20261026.md` 查询确切提交。

## 核对及修改

用户确认旧脚本库已停用。此前新增的 `openScriptLibrary` 跳转确实指向旧页面；虽然共用Studio存储，旧输出缺少当前自由创作的结构，不能只替换跳转地址。

- 删除本次改写弹窗新增的脚本库跳转，按钮改为“确认保存创作草稿”，保存后逐个平台显示“继续创作”。未删除既有全局脚本库模块或无关入口。
- 输出仍保存在原 `studio_projects`，增加原 `freeCreation` 第一阶段草稿结构，含可编辑口播、平台与语言。产品、画面和时长留待用户核对，不复制源稿冻结资产或创建生产任务。
- 原 `SocialContentPlanningPage` 接收显式草稿恢复请求，原自由创作控制器重新读取精确项目并采用其版本；不回退到本地记忆的另一草稿。项目切换使用独立组件身份。恢复完成前停止自动保存；读取失败展示错误，不创建空白替代稿。
- 原自动保存、确认保存和开场保存保留改写配文与来源。继续制作仍经过原产品、画面、确认及后端版本/准入门槛。从当前“我的创作”再次打开这些改写草稿，也进入当前工作台。

主要文件：`shared/contracts/platformRewriteDraft.ts`、`server/scripts/platformRewrite*`、`src/lib/{platformRewriteNavigation,readFreeCreationDraft,platformRewriteContinuation.test}.ts`、`src/App.tsx`、`src/components/assistant/AssistantBusinessSceneDialog.tsx`、`src/components/socialContent/{SocialContentWorkspace,SocialContentPlanningPage,SocialCreationWorkbench,SocialContentHistoryHome,useSocialCreationWorkbenchController}.tsx`；相应PRD、ADR和测试入口同步更新。未改数据库结构或基线指针。

## 实际验证

| 检查 | 结果 |
|---|---|
| `pnpm run test:assistant-quality` | 163/163通过，包含新增精确草稿恢复、跨项目拒绝回退、长稿完整性、两个版本分别导航 |
| `pnpm exec tsx --test src/lib/platformRewriteContinuation.test.ts server/scripts/platformRewrite.test.ts` | 5/5通过 |
| `pnpm exec tsx --test server/routes/studioProjectSaveRoutes.test.ts server/routes/studioProjectReadRoutes.test.ts server/routes/studioProjectSaveCas.integration.test.ts src/components/socialContent/SocialCreationWorkbench.draftRecovery.contract.test.ts src/components/socialContent/SocialContentWorkspace.contract.test.ts src/App.navigationState.test.ts` | 6/6通过 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint` | 通过 |
| `ARCHITECTURE_BASE_REF=efe54f4d pnpm run check:architecture` | 2977个生产TS文件通过，无预算上调；App 798行 |
| `pnpm run build` | 通过，原大chunk警告保留；Studio预算及导入边界检查通过 |
| `git diff --check` | 通过 |

没有迁移改动，未重新执行迁移或全仓quality/verify；未将前轮测试冒充本轮真实供应商验收。

## 隔离浏览器与保存读回

证据目录：`/Users/julia1/.codex/integration-evidence/20261026-rewrite-continuation/`。临时数据目录、合成企业/产品/源稿和loopback模型替身，实际策略鉴权与改写路由、实际Studio读路由及原保存路由。保存路由的外部素材端口使用空夹具，仅验证未含素材的可编辑草稿；不代表素材生产准入验收。

1. 首页选择源口播与TikTok、YouTube，生成后人工修改YouTube口播，确认保存两份草稿。
2. 完成页无旧脚本库按钮，分别显示两个平台“继续创作”；截图 `saved-platforms.png`。
3. 点击YouTube进入当前逐句口播/画面工作台，恢复人工编辑版本、YouTube平台与中文；在该页继续编辑，原版本化保存路由保存成功。
4. 刷新后仍恢复同一项目与修改后的口播；截图 `current-content-restored.png`。未选择产品或填写画面时，原“确认口播，进入分镜制作”按钮保持禁用。
5. 点击“我的创作”看到源稿和两份改写稿，打开TikTok版本，正确恢复TikTok口播与平台，未串用YouTube草稿。
6. HTTP重新读取确认总数仍为3，源稿未变，两个版本独立，继续编辑后的口播及配文保留；见 `readback.json`。

无真实模型费用、生成视频、发送、发布或投放；真实模型质量及生产供应商Ready未验收。源代码改动只保留功能分支，未合并本地基线、未推送或部署。基线在其他工作中由本轮初次只读观察的 `ff948eb3d043afa08cb2c7bd9ea08cca5357bdef` 推进为结束核对时的 `a0d965ae9af64ef2a6229198b496fa7a168f3374`，本分支未吸收或向其写入变更，不对新基线集成作结论。
