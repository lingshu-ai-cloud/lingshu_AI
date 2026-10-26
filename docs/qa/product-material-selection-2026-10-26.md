# 产品 ID 与创作素材默认选择

工作区 `/Users/julia1/Documents/ChatGPT/1026企业知识库`，功能分支 `feature/enterprise-knowledge-20261026`，修改前恢复点 `9227224be0893ee75d92357823ec29172fea5a51`。本次不推进共享集成基线。

## 结果与边界

- 创作产品选择沿用企业档案 `id → productId → sku`，旧名称/顺序型草稿仅在唯一匹配时转换；明确 ID 优先，未知 ID 和同名歧义不猜测。后端已在读取归一化时补齐历史 ID，并在资料保存时持久化，本次不执行数据迁移。
- 新版自由创作、复刻产品映射和原制作工作台接入同一默认选择规则：仅当前租户素材接口中的产品 ID 精确匹配、可用图片/视频；排除共享参考、数字人输入/授权、blocked 及无媒体地址的素材。
- 默认项可取消，异步刷新不勾回；更换产品移除本轮自动带入项，保留手选。恢复历史草稿保留已有选择，新增加的产品才补默认素材。
- 新版素材区显示按产品分组的勾选项及无素材提示，读取失败可重试。产品事实/文案沿用现有企业资料和服务端事实核验，不另建文案事实源。
- 自由创作草稿写入现有 `selected`、`materialSnapshots`；后续任务把所选素材加入原 `socialmaterial:` 来源，既有租户读取与制作验收继续生效。开场钩子和逐镜选择不再覆盖产品候选。
- 不会因为选择产品而调用分析或付费生成；默认选择不等于镜头采用、授权证明或发布许可。

## 实际验证

- `node --import tsx --test --test-concurrency=1`：产品 ID、素材选择、Social 选择/恢复/口播/新素材区、库存、素材归属、规划任务/批次、素材匹配、项目持久化/组合/合并、任务恢复以及企业布局共 58 项通过，无跳过。完整日志见证据目录。
- `pnpm run lint`：TypeScript 检查通过。
- `ARCHITECTURE_BASE_REF=9227224b pnpm run check:architecture`：2877 个生产 TypeScript 文件及增量预算检查通过；原超限工作台维持 7030 行，未增加预算或豁免。
- `pnpm run build`：主站/账号中心及 Studio chunk 边界、包体预算检查通过。
- `git diff --check` 通过。
- 本地浏览器以原 Mock 租户实际执行：选择精华液和面膜，自动勾选 4 项；取消一项后为 3 项；刷新后从“继续制作”恢复仍为 3 项；加入洁面乳增至 5 项，移除洁面乳回到 3 项。产品事实和素材均为明确 Mock 预览资料，未复制其他租户数据。
- 本地验证草稿 ID：`studio_projects_f49ef418c0dd4b4a991dcb088567c6f9`。仅本地预览草稿，无外部 run 或供应商 task。
- 窄窗口后续显示修正：产品选择名称截断；本地 Mock 图片缺失显示类型占位并保留素材名称与操作，不伪造图片。相关 4 项界面测试及重新构建通过。

证据目录：`/Users/julia1/.codex/integration-evidence/20261026-product-materials/`。

本次另保留并提交此前用户确认的“经营经验完成标签”和顶部知识概览删除。未推送、部署、生产写入、真实供应商调用或付费生成；本地检查不构成真实生产端到端验收。

## 八项审计问题收口与最小范围复核

本轮恢复点为 `042a348a44c0564a74ed2a827ac3810e5edcc2a7`。执行前工作树干净，仍在上述功能分支；未推进共享集成基线。

| 原问题 | 基于现有代码的修正 | 实际回归 |
| --- | --- | --- |
| 补图仍查顺序/名称 ID | 原补图回调复用 `enterpriseProductIdentity` | 直接执行原 onUpload，重排、改名、同名仍仅更新目标产品并保留 If-Match |
| 同名抢配明确 ID | 原 resolver 统一明确 ID 优先；纯名称旧记录只唯一匹配 | 前端 helper、服务端 resolver、当前租户多产品创建回读 |
| 批量跳过素材关联 | 原批量 create 回调串接原 add/remove source，成功后才确认该项 | 第 2 项关联失败、未就绪、续传不重复创建；改选后重试明确拒绝 |
| 读取失败仍提交 | 原按钮和原提交函数同时阻断 loading/error | 库存失败、错误展示和就绪条件复核 |
| 取消跨交接失效 | 原 brief/source 同步保存取消；只删除旧归属明确的产品 source | 删除失败及添加失败后重试，旧元数据直到全部同步成功才替换；手选/参考保留 |
| 恢复丢自动归属 | 原 Hook state 写原 snapshot，恢复走原 applySpec/任务种子 | JSON 往返、自动归属/取消恢复；同 commit reset 跳过旧副作用 |
| 任务丢多产品身份 | 原 brief 可选扩展两个字段，贯穿 parser/default/projection/seed | 新/旧形状兼容、租户外 ID 拒绝、A/B 回读及素材分组 |
| 旧分镜未迁移 | 原 restore helper 同时处理顶层及所有 assembly，目录后到时补迁 | 实际 applySpec，含未激活版本、晚加载、稳定引用不触发循环 |

### 范围审计结果

- 修改 26 个既有生产 TypeScript 文件，集中在产品解析、既有选择 Hook、项目生命周期桥、任务 brief 的读写层和原任务 sources 编排。新增生产模块、HTTP 路由、存储表、依赖、迁移均为 0。
- 任务 brief 新增可选 `productIds`、`productMaterialSelection`；现有任务 JSON 持久化不需数据库迁移。状态类型从旧客户端文件移到现有共享契约并重新导出，只有一个定义。
- 服务端之所以涉及原 guided 调用点：原非对话任务只给首产品构建事实、候选及主图。现改为复用已存在的 guided 多产品事实/分组函数，并遍历原图片注册调用，避免“简报存了 A/B、实际只读 A”。没有复制素材准入或供应商执行逻辑。
- 现有 `StudioDraftSnapshot` 和生命周期 ports 仅增加上述字段的可选类型与原 Hook getter/reset；超限主工作台仍为 7030 行，未增加预算或豁免。
- 明确 ID 失效不再按同名商品修补，这是已确认的身份规则修正；原名称修补测试更新为“未知 ID 拒绝、纯名称唯一兼容”，没有删除覆盖。旧稿没有归属记录时保守保留，不能追溯伪造自动/手选历史。
- 改动过程中发现源契约测试仍要求旧名称数组表达式、类型快照缺少可选字段以及 loadProject 测试 harness 缺少 autoGen 端口，分别修正后重新执行。最终组合回归为 **77/77，无跳过**。

### 本轮验证

- `node --import tsx --test --test-concurrency=1`：产品 ID、实际补图/项目恢复、选择状态、Social 素材/草稿/口播、任务种子、任务创建/列表/候选、guided 路由、脚本事实、图片库存、批次重试、项目合并和素材匹配共 77 项通过；详细日志 `lingshu-selection-audit-all-final.log`。
- `pnpm run lint` 通过；`ARCHITECTURE_BASE_REF=042a348a pnpm run check:architecture` 通过（2877 生产 TS 文件，含 ratchet）；`pnpm run build` 通过，Studio 包体 373267/485000 bytes；`git diff --check` 通过。
- 浏览器实际验证原本地 Mock 草稿：原 4 项历史素材，加洁面乳后 6 项；持久化 JSON 中洁面乳 2 项明确为 automatic；刷新仍 6 项，移除洁面乳回到 4 项；取消精华液 1 项后为 3 项，再刷新保留。全程未调用生成或外部供应商。
- 仅上述 Mock 草稿发生本地写入。证据目录 `/Users/julia1/.codex/integration-evidence/20261026-product-selection-closure/`，含日志、范围清单、选择状态快照和预览截图。
- 已确认并仅重启本工作区 55301 预览后端，运行 `role=web`、`backgroundJobs=false`，健康接口返回 `status=ok`；其他工作区服务未改动。健康响应的构建 SHA 为 unknown，仅作为进程存活证据，不用它宣称提交归属或供应商验收。

架构决定见 `docs/architecture/adr/2026-10-26-product-selection-handoff.md`。本轮无生产迁移、推送、部署、付费请求或外部 run；不把本地与测试通过写成真实供应商验收。
