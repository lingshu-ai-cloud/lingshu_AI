# 助手业务场景与多平台改写最终本地合并

日期：2026-10-26（Asia/Shanghai）。用户明确限定仅合入助手经营、客户、投流场景查询，以及多平台改写并继续进入当前内容创作；其他候选不纳入。

## 固定提交与检出

- 原基线：`072c343baabc99da9a6ad975d438503740f33799`。
- 来源：`feature/assistant-scene-backend-closure-20261026`，`ca40301f0fb8364d2a39b49ee6532603febb29d2`；新增范围仅 `efe54f4df0d0ced6e534ee96bfb8dc5af7e0d81b` 与 `ca40301f`。
- 双亲合并：`58e103131019be049345b25c6f9afb3ad7ec00d8`，双亲分别为上述原基线和来源。治理检查点不改变生产代码，确切交接SHA用 `git log -1 --format=%H -- docs/governance/ASSISTANT-SCENES-FINAL-INTEGRATION-20261026.md` 查询。
- 默认分支与权威树：`baseline/unified-20261026`，`/Users/julia1/.codex/worktrees/lingshu-unified-baseline-20261026`。本地版本分支 `差图文创作加联调` 保留同一最终结果；远端未更新。
- 隔离候选：`integration/assistant-scenes-final-20261026`，`/Users/julia1/.codex/worktrees/assistant-scenes-final-20261026`。当前聊天目录不是Git仓库，App创建工作树返回Not a git repository，故从已核实主仓库使用Git创建隔离检出。仅软链已安装依赖，没有迁入业务数据库、凭据或媒体。
- 恢复点：`backup/pre-assistant-scenes-final-20261026` 指向原072c343b；来源分支未移动。

## 合并规则

1. 保留六组首页入口、企业知识库与产品稳定ID/素材默认选择、图文任务持久调度及逐张选图。
2. 新增内部场景资料的对象、日期、角色和租户校验；业务汇总不把首屏样例当作总量，不把来源失败当作零数据。
3. 多平台输出经用户编辑确认后保存为独立Studio草稿，继续创作和历史打开均进入当前工作台，不恢复旧脚本库跳转；保存保持幂等读回和精确项目版本。
4. 两个冲突文件：产品规范保留双方独立章节，以后续改写承接修订为准；工作台控制器同时保留draftRestored与产品素材loading/error的自动保存、制作阻断和effect依赖，避免恢复未完成时覆盖草稿或按空素材继续。
5. 没有新增依赖或迁移；没有合入媒体404、单条任务界面、本地执行器与其他工作树的未提交内容。

## 本轮实际检查

检查在合并候选完成；日志目录 `/Users/julia1/.codex/integration-evidence/20261026-assistant-scenes-final/`。Node使用本机捆绑运行时；质量门禁PB_BIN指向已有 `/Users/julia1/.local/share/lingshu/pocketbase/pocketbase`。quality的PocketBase演练仅使用测试创建的隔离库，不是目标业务库迁移。

| 命令/范围 | 结果 |
| --- | --- |
| `pnpm exec tsx --test`：businessScenes/evidence、sceneRouting，platformAds/readPages，platformRewrite，platformRewriteContinuation，Studio保存/读取/CAS，草稿恢复、工作台与导航合同 | 20/20，退出0；完整参数见focused.log |
| `pnpm exec tsx --test`：useSocialProductMaterials、SocialProductMaterialPicker、studioProductMaterialSelection、enterpriseFacts、enterpriseContextFailure | 17/17，退出0 |
| `pnpm run test:assistant-quality` | 164/165，唯一失败为旧卡片顺序断言 |
| 原072c343b树：`pnpm exec tsx --test src/lib/assistantHomeQuickPrompts.test.ts` | 复现同一失败；未修改生产卡片顺序或放宽测试 |
| `pnpm run test:assistant` | 完整脚本退出0，不仅最后一组 |
| `pnpm run test:platform-ads` | 74个测试文件通过，退出0 |
| `pnpm run test:image-replication` | 24/24，退出0 |
| `pnpm run test:content-production-v4` | 75/75，退出0 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm run lint` | 退出0 |
| `ARCHITECTURE_BASE_REF=072c343b pnpm run check:architecture` | 2997生产TS文件通过；相对原基线ratchet通过，没有提高预算 |
| `pnpm run check:digital-employee-migrations` | 204项只读，零阻塞 |
| `pnpm run build`、`pnpm run build:account-hub` | 均退出0；保留既有大chunk警告；Studio373279/485000字节 |
| `git diff --check 072c343b HEAD` | 通过 |
| `pnpm run quality` | 前置门禁、迁移guard、隔离HTTP/Worker与本地生产运行通过；既有M1失败，见下文 |

quality在 `weekly-golden-journey` 的M1用例记录 `user_input_required:controlled M1 forbids external network: api.heygen.com`，随后断言失败。前一基线治理文档已记录同一受控外网失败。本轮未绕过保护；测试断言失败后进程仍驻留，仅终止本轮创建的quality进程组，runner记录退出-15、170.9秒。后续quality阶段未执行，未运行verify；独立领域与构建结果不能称为完整quality通过。没有进行新合并版本的浏览器或真实供应商验收。

## 原现场保护与交接

- 基线原未提交视频排序补丁保持SHA-256 `ed50ec18853d813c6307d1c7dd9ff1c7d020ec37735282d44ea368ff334a289b`；文件SHA-256 `fe37e8cb96ba3c7109ec45119698b29a3419c7c16a07dfa3a27074d3e9edf7e9`。补丁不属于本轮版本，默认树仍非干净；原始证据保存在original-state.json与baseline-original.patch。
- 干净候选检出保留最终提交，便于不带该排序补丁复核；同名本地版本与默认基线同步，原远端072c343b继续保持。
- 未修改或清理来源工作树、其他功能树或预览数据库；未推送、部署、发送、投放、真实模型付费或执行目标数据库迁移。
- 后续开发以最终本地提交为起点；真实模型质量、渠道授权、供应商Ready、浏览器组合验收和上述既有质量失败仍需分别处理。
