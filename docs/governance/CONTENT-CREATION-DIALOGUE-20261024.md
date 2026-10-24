# 内容创作首页自由创作对话验收

日期：2026-10-24（Asia/Shanghai）
结论：独立功能分支源码及离线交互验收通过；不建立主集成、目标数据库或真实供应商 Ready 基线。

## 位置与安全恢复点

- 工作树：`/Users/julia1/.codex/worktrees/xixi-content-creation-dialogue-20261024`。
- 分支：`feature/content-creation-dialogue-20261024`。
- 起点/安全恢复点：`89b175109149d4551aeb3ce590fe9c42c46bf23c`，来源 `xixi投流客服整合补齐基线v1`。开始时 Git 根目录、分支、HEAD 均与授权信息一致，工作区干净。
- 源码、测试、迁移及离线工具提交：`d4281ec6b337fad6f07906a398c12d2a37553495`。本记录、唯一 UI 规范、ADR 和截图另行提交。
- 主集成工作树、其他会话工作树、ChatGPT 项目镜像及 `sources/` 未修改。未合并、推送、部署、OAuth、发送、发布、投放或调用真实付费供应商。

## 实现与所有者

| 范围 | 主要文件 | 结果 |
| --- | --- | --- |
| 同源爆款参考 | `ContentCreationHome.tsx`、原 `viralVideoFeed.ts` / `InspirationVideoCards.tsx` | 原授权 `/videos` 数据源；“去创作”只选择，原查看详情仍可用 |
| 输入与问答 | `AssistantComposer.tsx`、`AssistantConversationPanel.tsx`、`ContentCreationChoices.tsx` | 引用卡替换加号、聚焦派活占位与扩展、产品多选、分镜抽屉、口播和数字人逐轮选择 |
| 媒体 | `ContentCreationShotPreview.tsx`、原认证图片/视频和媒体状态组件 | 首镜/素材片段播放、真实加载与错误重试、抽屉关闭释放播放器 |
| 会话与取消 | 原 `assistantStore`、thread journal、`useAssistantSend`、hydration/save queue | 同一线程/消息/CAS；草稿和选择恢复；失败、重新选择和身份切换 fence |
| 服务端事实 | `server/assistantContext/contentCreationDialogue.ts`、`server/routes/contentCreationDialogue.ts` | 当前租户严格知识库、逐镜证据、库存和人物资格；不读全局演示资料填空；尊重知识库 AI opt-out |
| 模型贯通 | 原 `strategy.ts /chat` 的 `creationSelection` | 模型调用前重验选择；系统上下文带核验后的来源、产品、片段和方案，普通上传不冒充参考身份 |
| 数字人方案 | 共享 `DigitalHumanRequirements`、既有编导复核及人物校验 | 首镜明确为数字人则沿用；明确非数字人则第二镜插入数字人槽；未知则待核验；内容与人物确认仍为 false |
| 持久化 schema | `1792800000_extend_assistant_creation_draft.js`、checksum 清单 | 现有 `assistant_threads` 追加有界 JSON 字段；无新聊天表、任务状态、队列或供应商路径 |

问题和控件随真实异步回包推进。每次返回重选会在确认时重读服务端事实；证据 hash 变化返回 409。每轮只保留当前选择快照，历史问答正文保留。口播是知识库完整事实句与所选画面的规则编辑草稿，自由追问走原模型路径；预估朗读时长不等于语音合成或生产回执。

## 实际检查

命令均在上述功能工作树执行。Node 路径通过本机已安装运行时加入 PATH，未修改依赖或锁文件。

| 检查 | 命令 | 实际结果 |
| --- | --- | --- |
| 助手完整专项 | `pnpm run test:assistant` | 退出 0；涵盖原普通聊天、动作、持久化、隔离及原助手合同 |
| 助手事实质量 | `pnpm run test:assistant-quality` | 28 项通过，含本次 5 项领域测试及真实 HTTP/auth/local store/loopback 模型传输验证 |
| 相关 UI/持久化 | 下方定向命令 | 23 项通过；含加载失败保留、过期回包忽略、journal 隔离、server CAS、新字段回读、旧客户端部分更新保留选择及动效动态切换 |
| 早期领域/素材专项 | 参考解析、人物权利/素材校验、爆款 feed、journal 等定向组 | 29 项通过；最终受影响检查另见上两行，不累计重复项 |
| 类型 | `pnpm run lint` | 退出 0，`tsc --noEmit` |
| 架构 | `ARCHITECTURE_BASE_REF=89b175109149d4551aeb3ce590fe9c42c46bf23c pnpm run check:architecture` | 2691 个生产 TS 文件通过；ratchet 通过；未改架构预算 |
| 迁移仓库只读 | `pnpm run check:digital-employee-migrations` | 198 项，零 blocker；无目标库访问或执行 |
| 构建 | `pnpm run build` | 退出 0；Studio 368867/485000 字节，视图导入边界通过 |
| 差异 | `git diff --check` | 通过 |

最终 UI/持久化定向命令：

```sh
node --import tsx --test \
  server/routes/assistantThreads.actions.test.ts \
  src/components/assistant/contentCreationRequest.test.ts \
  src/components/assistant/useAssistantSend.test.tsx \
  src/components/ContentCreationHome.contract.test.ts \
  src/components/assistant/AssistantComposer.test.tsx \
  src/components/ui/LsExperiencePrimitives.behavior.test.ts \
  src/lib/designTokens.test.ts src/lib/appearance.test.ts \
  src/components/DarkAppearance.contract.test.ts
```

模型贯通验证使用真实 strategy HTTP、认证、本机隔离 DataStore 和本机 SSE 供应商 stub：所选参考 ID、产品和片段画面进入模型 system context；其他租户参考返回 404、伪造片段返回 409，均未访问模型。未以可见卡片或普通附件上传作为接通证明。

检查原始回执摘要保存在 [checks.txt](evidence/content-creation-dialogue-20261024/checks.txt)。

## 浏览器复现

唯一端口 `5214`，不占用既有预览。该工具使用内存选择/会话和临时目录中的 FFmpeg 测试图样；无真实账户、凭据或外部执行。复现：

```sh
cd /Users/julia1/.codex/worktrees/xixi-content-creation-dialogue-20261024
CREATION_FIXTURE_PORT=5214 node --import tsx scripts/content-creation-dialogue-preview.ts
# 打开 http://127.0.0.1:5214/__content-creation-fixture
```

1. 在爆款区域点击或键盘 Enter 操作“去创作”：同页输入区显示参考卡、封面、取消操作；无旧生产跳转。点击输入区，占位变“给灵小枢派活”；实测舞台扩展到 600 CSS px。
2. 派活 → 产品问题 → 选择“样品杯”或多选“样品杯、样品盖” → 确认；用户回答保留在会话，出现参考钩子、工厂和产品共 4 张分镜卡。
3. 卡片打开右侧信息流，上下滚动勾选工厂/产品素材；左上勾选和边界同步，取消后总数变化。键盘 Enter 打开、原生 Escape 关闭；焦点回到该卡片。
4. 本机 3 秒测试片段在四个预览播放器均实际解码至 `readyState=4`、`duration=3`。测试图样不是素材分析或生产效果证据。
5. 确认 3 个分镜 → 3 版 23 秒口播草稿 → 选择口播 → 数字人问答。选择“是”时首镜形式及人物证据不足，显示待核验与待补齐，不产生生产或供应商任务。
6. 返回分镜，取消工厂片段并重新确认：新口播改用产品画面描述，不沿用已取消片段。返回产品和修改数字人选择均可用。
7. 切换数字员工：原任务入口保留，自由创作控件隐藏；切回后选择保留。刷新浏览器，当前对话与选择恢复。
8. 工具栏“下次请求失败”后刷新分镜：真实 503 显示错误，产品/分镜仍保留，后续可重试。“挂起请求”后省略号与 disabled 来自实际未完成 HTTP；重新选择参考再“释放请求”，旧回包不会恢复旧控件或覆盖新选择，无定时假成功。
9. “切换验收身份”后，旧对话与参考消失，另一身份爆款区显示真实空态；切回恢复原身份状态。
10. 日夜外观、桌面与窄屏均检查。请求 viewport 为 1440×1000 / 390×844，受浏览器既有缩放影响，实际 CSS 内容尺寸为约 1309×909 / 354×767；页面无横向溢出，窄屏 Drawer 实测宽约 354.55 CSS px、占满视口。临时 viewport override 已复位。

截图：

- [桌面夜间三版口播与参考卡](evidence/content-creation-dialogue-20261024/desktop-dark-narration.png)
- [窄屏日间分镜信息流](evidence/content-creation-dialogue-20261024/mobile-light-drawer.png)
- [数字人证据不足门禁](evidence/content-creation-dialogue-20261024/desktop-digital-human-gate.png)

## 已知限制和未执行项

- 新 PocketBase 字段仅有迁移源码与仓库完整性证据；未在目标库执行或做目标 schema 升级/回滚演练。不能将本地 DataStore 回读写成目标 PocketBase 已验收。
- 未进行真实付费模型的语言质量、真实人物认证/数字人生成、OAuth、生产、发布、发送、投放或部署验收，无外部 run/task ID。口播卡片没有伪造语音或视频成功。
- 原构建仍有大 chunk 提示，本次 `useAssistantHomeAnchor` 业务 chunk 约 669 kB；没有提高 Studio 或其他预算。浏览器见既有 Ant Modal `focusTriggerAfterClose` 弃用警告，不记为零控制台告警。
- 动态 reduced-motion 开关由原动效引擎/Token/组件测试覆盖，新增扩展有媒体查询即时退化；没有声称在真实移动设备、全部 80%–200% 浏览器缩放或所有浏览器上完成视觉矩阵。
- 推荐展示有界：产品最多 100 个、分镜最多 12 个；证据缺失/过长导致不能形成 15–30 秒完整事实口播时明确停止推荐，等待补齐或重新选择。
- 方案阶段不创建视频生产任务。进入原生产工作台后仍须依照既有人物、素材、参考使用及生成审批门禁确认；本任务没有另建自动执行旁路。

## 5215 完整应用本地验收补充（2026-10-24）

当前人工验收入口改用 `http://127.0.0.1:5215/?page=strategy`。上文 5214 仅保留历史离线组件验证记录，不再作为完整应用入口。

真实 Vite + `server/index.ts`（9015）使用专属预览账户和隔离目录 `/Users/julia1/.codex/integration-evidence/20261024-creator-ui/full-content-app`。企业、两款产品、两条参考和三条视频素材均通过本地 owner 写入；媒体对象根与素材目录同时隔离，不写目标库。所有数据标注本地验收/自制示意/非真实爆款，视频带英文验收水印；不代表真实产能、销量、认证或人物授权。种子脚本、原企业恢复点、HTTP报告及完整应用截图保存在该目录，不入源码或同步 sources。

实测发现创作回复的 `/studio-media` 裸地址不能携带 bearer，浏览器播放器无权读取。路由现复用已有 `signPathAssetUrl` / `signAssetUrl`，在领域完成证据摘要后为本租户的预览地址签名，不改证据身份、授权门禁或素材筛选。新增回归验证签名绑定本租户/local authority、不能换路径复用、重复签名不改变证据版本。

真实 HTTP 五步问答成功；浏览器在完整应用完成参考→产品→三分镜→三版约25秒口播→数字人问答→方案汇总。参考首镜实际裁出0–3秒独立片段；原视频、首镜和两段素材均实际解码至 `readyState=4`。已复核自制首镜无人，因此数字人拟放第二镜；人物授权资料缺失仍显示待补齐，未调用供应商、创建生产任务或生成视频。浏览器最终留在产品选择，便于用户自行重走。

本次定向领域/签名回归6项通过；签名回归已纳入 `test:assistant-quality`，该套29项全部通过；`pnpm run lint`（TypeScript）、architecture guard（2691生产文件）、`git diff --check` 通过。无目标库迁移、付费供应商、发布或部署验收结论。
