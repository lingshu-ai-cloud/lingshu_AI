# 创作前端整合与主导航调整（2026-10-24）

## 版本与范围

- 工作树：`/Users/julia1/.codex/worktrees/xixi-feature-integration-20261023`；本地开发分支继续为 `xixi代码架构清理后合并链条v1`。
- 恢复点：`3193ead1a2778b854a381a09ca3a940a62fe187b`，另有本地 `backup/creator-ui-before-20261024-3193ead1`。
- 验证源码提交：`9b03cb5360aa32c995d24bc17fe81bea5e1f5a10`。文档另行提交；最终历史合并仅记录已完成语义移植的来源祖先，不替换此源码树。
- 来源：用户确认的 `64bb648150af7b53d9ca21e7372f7771ad4e08ff`，相对 `62f85f8c` 共七笔前端增量：`6e3368e5`、`9ed3f975`、`54c250d2`、`ae36884d`、`ab676bc9`、`797363e3`、`64bb6481`。以语义移植适配已治理基线，未直接覆盖旧大文件。
- 用户指定远端版本分支：`xixi改tab顺序+前端整合`；只普通推送该命名分支，不推标签、不创建或合并 PR、不触发部署。

## 最终行为

主导航自上而下为 **经营总览 → 灵感爆款 → 内容创作 → 平台投流 → 客户会话**。导航与页面注册表保持同一名称；首页完整入口与对应标题同步称为“灵感爆款”。保留原页面 ID、角色权限、数字员工模式下的参考入口可见性和投流开关。

创作首页挂载原全局助手会话及上传/保存接口；支持日夜外观、创作模式、连续媒体墙和竖向视频预览。经营总览页签挂载到当前 `ConfiguredDigitalEmployeeWorkspace`，客服阅读布局适配到现有 chat/rail 所有者；原会话/客户、生产、审批、预算、排期与发布业务模块仍由原模块负责。

## 冲突处理与边界

- 来源的 DigitalEmployeePage/ConversionPage/GlobalAssistant 大文件改动分别落到当前配置工作区、客服子组件和助手 panel/bubbles/controls，不恢复治理前的大文件结构。
- 不引入来源 `architecture.config.json`；800 行上限、历史冻结预算和 Studio 485000 字节预算不变。`GlobalAssistant.tsx` 当前 800 行，架构检查通过。
- 不保留重复的 `assistantAppearance.ts`，复用当前助手常量与 API 入口。首页 feed 复用 `recordsToVideos` 投影；详情媒体从 leaf 模块导入，沿用认证读取。
- 修复 Masonry 首次布局前所有视频同时启用的问题：观察器在布局帧后注册；保留分析失败/警示层，不采用来源隐藏全部 overlay 的 CSS。
- Vite 原 studio-support 图标分组追加两个共享纯图标，修复视图到工作台 chunk 的静态导入边界；未扩大预算。
- `server/`、`shared/`、迁移及架构配置相对恢复点无改动。未修改生产数据库或真实供应商状态。

## 实际验证

源码树执行并通过：

| 检查 | 结果 |
| --- | --- |
| `git diff --check`、暂存区检查 | 通过 |
| 20 个受影响前端测试文件（导航、注册表、首页、主题、助手、客服、媒体、经营页签及素材） | 37/37；首次旧投流名称断言失败，按用户新名称修正后通过 |
| `pnpm run lint` | TypeScript 通过；最后一次名称修订后复跑通过 |
| `pnpm run check:architecture`，基准 `3193ead1` | 2685 个生产 TS；一个既有冻结例外；通过 |
| `pnpm run test:architecture-ratchet` | 通过 |
| `pnpm run check:digital-employee-migrations` | 197 项仓库只读检查通过 |
| `pnpm run test:migration-guard`，基准 `3193ead1` | 通过；未执行目标库迁移 |
| `test:assistant`、`test:assistant-production` | 全组通过 |
| `test:customer-pipeline`、`test:platform-ads` | 全组通过 |
| `test:social-content-frontend`、`test:digital-employees` | 全组通过 |
| `pnpm run build` | 最后名称修订后通过；Studio 368861/485000 字节；视图导入边界通过 |

本次浏览器在 `127.0.0.1:5202`、隔离后端 `9002` 验证已登录状态、五项导航最终顺序/名称及经营总览、灵感爆款、内容创作、平台投流、客户会话入口，未点击付费/授权/发送/生产动作。最终截图在下述私有证据目录 `tab-order-final.png`。

此前隔离浏览器已验证首屏媒体按需启用、模式切换保留输入；真实本地附件上传返回 201、原线程保存返回 200。模型响应及视频列表使用受控夹具，不代表真实模型/供应商验收。扩大浏览器脚本在附件引用传入模型请求的断言处停止：既有策略请求仍只传用户文本，附件上传/保存不等于模型已读取附件；该请求构造器与恢复点字节一致，本次未改后端或扩展附件理解能力。因此不声明完整浏览器整链、附件理解、后续换片/主题/生产重复进入等全部验收通过。

证据目录：`/Users/julia1/.codex/integration-evidence/20261024-creator-ui/`；最终日志前缀 `tab-`。来源清单为 `source-audit.json`，移植 patch SHA-256 为 `1881aa665f51739d38e3f27150e3a6ca84e9018d68c1b3ad112645798d322cac`。不将私有运行数据、账号、凭据或媒体夹具提交到仓库。

## 同步、推送与限制

用户已修订要求：已确认预览树和内容生成树也随安全基线变化。本次同步前两树均干净；预览为 detached `64bb6481`，内容生成为 `feature/content-generation-20261024` / `3193ead1`。来源祖先记录后可快进到本版；只在重新确认干净且可快进时执行，不覆盖独有开发成果，不改运行数据。同步后的实际 HEAD/状态在操作后另行核验。

可见 workflows 仅标签 push、PR 或手动/定时事件，不匹配此次命名分支的普通 push；未发现有效 pre-push hook。未运行全仓 `pnpm test`、`quality`、`verify`，不声明远端 CI、真实账号/付费调用或上线就绪；未部署。

## 2026-10-24 追加：客服与投流保持原功能区、统一主外观

起点 `2b4c0a91f67b9873de82bc21e4c87bbfad8fa0bf`，源码/测试 `1dd111866635cf83ccf02cf129a3a3fc64713d0c`，本地分支仍 `xixi改tab顺序+前端整合`。本节覆盖此前审计发现的投流导航和夜间弹窗缺口；不扩大到真实供应商或上一节未通过的附件理解整链。

### 变化与保留

- `PlatformAdsPage.tsx` 使用既有 Ant Tabs 常驻“计划创编 / 投放数据 / 素材管理”，仍调用原 `onNavigate` 和页面 ID，保持同一个广告工作区的状态与 API。账户真实历史、本地计划回执、平台广告素材、投放素材、创作素材及原 AI 投手 Drawer 均保留。
- `pageRegistry.ts` 将计划、素材子页挂到平台投流导航归属；`Layout.tsx` 复用既有 `PLATFORM_ADS_PAGE_IDS`，让子页面使用与主页面相同的侧栏、账号区和顶部间距，修复子页外壳不一致。
- 客服继续保留收件箱、潜客、成交客户、沉默客户及原三栏和移动端区域切换。`ConversionPage.tsx`、`ConversionChatThread.tsx`、`ConversionCustomerList.tsx`、`ConversionCustomerRail.tsx` 的四份源码，剔除 JSX `className` 并按同一 TypeScript printer 输出后，与起点一致；这是样式以外源码未变的证据，不替代运行验收。
- 原生创编弹窗、表单、步骤、说明、遮罩、表格悬停与素材卡片使用现有 Surface/Text/Border/Accent/Mask Token；补齐共享主题的夜间 primary/info-bg/selected/hover 别名。移除旧绿色品牌强调和白底继承浅字，保留成功、警告、错误及平台语义色。
- `server/`、`shared/`、package/lockfile、客户加载/发送/恢复接口及投流 API 未改动；未换技术栈、未引入新组件系统或平行业务链。

### 验证

| 实际检查 | 结果 |
| --- | --- |
| 8 份定向前端测试文件（含导航归属、外观外壳、客户边界、布局） | 23/23 |
| `pnpm run test:customer-pipeline` | 80/80 |
| `pnpm run test:platform-ads` | 47 文件通过 |
| `pnpm run lint` | 最终源码通过 |
| `check:architecture`、`test:architecture-ratchet`（基准 2b4c0a91） | 通过，预算未变 |
| `check:digital-employee-migrations` | 197 项仓库只读通过；无迁移改动 |
| `git diff --check`、暂存区检查 | 通过 |
| `pnpm run build` | 最后样式调整后通过；Studio 368861/485000；视图导入边界通过 |

实际浏览器在本地 5202/9002 检查：三项投流路由切换、主导航持续高亮、素材内部页签保留；创编表单日间/夜间可读；客服模拟记录的原四分类、三栏、多语消息、翻译和右侧功能区日夜显示。只打开并关闭表单，没有提交草稿、生成方案、发送消息或授权；原自动外观偏好已恢复。

私有证据沿用前述目录，日志前缀 `workspace-theme-`；AST 对比为 `workspace-customer-behavior-ast.json`，截图 `workspace-ads-modal-dark.png` / `workspace-ads-modal-light.png` / `workspace-ads-creatives-light.png` / `workspace-customer-dark.png` / `workspace-customer-light.png`。模拟客户不是实际客户通道验收，无广告账户时不声称真实报表、审批、投递或付费链路可用。

未运行全仓 test/quality/verify；未部署。源码与文档分别提交，普通推送当前同名分支；可见 workflow 触发条件未变。两棵关联树仅在重新核对干净且可快进时同步。
