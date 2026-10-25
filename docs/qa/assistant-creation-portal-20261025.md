# 灵小枢内容创作门户与内部问答联调

工作树 `/Users/julia1/Documents/ChatGPT/1025灵小枢外部信息`，分支 `feature/assistant-reply-quality-20261025`，HEAD与安全恢复参照 `7801dd0f90ce5b27a52540069b8fbfd330ae654b`。本轮开始前已有外部信息/来源折叠等未提交改动，原样保留；本轮无提交、合并、推送、部署、数据库迁移或真实渠道发布。

## 复用与修正

- 复用 `assistantProductionIntent`、原主会话保存/CAS/journal、共享消息渲染和`lingshu:navigate`。非创作页面的明确新建内容/视频意图先生成类型化门户消息，再点击进入原内容规划页，不要求门户出现前选产品或猜产品ID。已有参考创作与签名执行入口继续原链路。
- 门户合同位于 `shared/contracts/assistantCreationPortal.ts`，仅允许目标、数量与平台/时长提示，不允许任意href、任务ID或执行参数。入口不是已建立生产任务或已完成视频的回执。服务端消息边界、journal与连续消息合并保留该结构。
- `AssistantCreationPortalCard.tsx` 采用主题Token和原消息卡片结构。`App.tsx`/原内容规划页仅为此入口保留准备工作台；把目标、平台、时长和可编辑数量带入原控制器。原自动保存可创建租户内草稿，未生成视频。
- 每个入口UUID使用独立草稿恢复键，同一入口可恢复，另一入口不接错旧草稿。
- 联调确认原即时ContentTask强制一条内容一个任务，不能直接传数量3。新增薄协调器 `socialContentPlanningBatch.ts` 复用 `submitContentIntakeBatch` 与原createTask，分别建立单条草稿并保持各自幂等身份，部分成功/未知结果不重建已确认项；完成后逐条进入原制作，不自动生成。单任务输入拒绝多条，避免服务端静默归一化造成误报。
- 内部问答沿原OperatingContext租户/角色白名单和限量读取，支持内容任务brief对象/有界JSON。具名内容任务可直接解释状态及目标数量，不把数量当已完成成片数。

主要改动文件：门户合同、`assistantProductionIntake.ts`、`useAssistantSend.ts`、`AssistantConversationBubbles.tsx`、`appSession.ts`、`assistantThreadMessageInput.ts`、`assistantThreadJournal.ts`、`globalAssistantRuntime.ts`；原App导航、SocialContentWorkspace/PlanningPage/Workbench及控制器、socialContentPlanningTask/Batch；原operatingContext/taskStatusAnswer与定向回归。产品决定写入UI规范16.24与 `docs/architecture/adr/2026-10-25-assistant-creation-portal.md`。

## 已执行开发验证

- 首轮相关定向测试20/20（入口解析、原产品核验/原子提交、CAS、未知回执恢复、journal、主助手合同与内部状态）。
- 新入口/批量草稿回归6/6：数量、门户/消息保存、部分成功后续接、跨身份停止。已并入原 `pnpm run test:assistant-quality`，本轮82/82。
- 类型、架构、构建和原助手生产领域回归结果以本轮最终交接实际命令为准。未声明全仓quality/verify、黄金E2E或供应商生产Ready。

## 本地真实HTTP联调证据

沿用前端5265、后端8865、独立 `/tmp/lingshu-assistant-browser-20261025` 数据目录；只使用标记为本地验收的合成企业及 `qa-transformer` 产品，使用原local-preview-session登录并检查企业标识后调用现有业务接口。HTTP创建没有启动生产。

首次直接提交instant任务数量3，返回目标数量1，确认了原单条合同；保留该最小复现任务 `socialtask_80d3cf09b724d4bd484cfba3`，不把它当作多条成功。

改用实际新协调器调用原create/read接口后，取得3个独立任务，每个目标1条，均 `plan_review`：

- `socialtask_ab0e42722eaf9707c5037eb4`
- `socialtask_b243552b53a8272653625fcf`
- `socialtask_8336ebf9eac1d4cc7453b500`

同一需求再次调用得到6份回执但仍只有这3个唯一任务，未重复建立。未调用start、脚本/视频供应商、付费、OAuth、发布或发送接口；无外部生产run。证据 `/tmp/lingshu-assistant-browser-20261025/portal-batch-evidence.json` 与 `portal-http-batch.mts`；测试日志同目录 `portal-*.log`。这些是开发数据，不推进共享源码或生产数据基线。

## 浏览器验收范围

使用实际Chrome页面发送需求、点击门户和读取内部任务。首轮“3条TikTok新视频”的数量未被识别，已修复平台名与“新”字词序并加入回归。最终页面截图与结果按交接记录；不能用静态渲染测试代替浏览器交互结果，也不能把进入制作页当作已生成成片。

页面首轮进一步核对：已进入原工作台，数量3、时长18秒可见，原自动保存显示“草稿名称已保存”。工作台内容目标与平台是固定枚举，不能直接把整段目标或小写平台码塞进去：完整需求改带入补充说明，平台转换为既有选项名称，用户后续修改的平台会沿原任务参数传递。入口导航同步更新view=create，清除旧首页view参数。产品仍由用户选择，未自动生成或承诺完成。

## 最终浏览器结果

- 输入“帮我创建3条TikTok新视频，每条18秒，介绍我们的产品。”，消息返回“3条视频”门户与总体结论。点击进入现有制作页，数量3、时长18、平台TikTok、完整原话在补充说明中，草稿名称保存成功。
- 点击首页“写一条爆款视频脚本”快捷建议后发送，返回“1条视频”门户；点击后URL为 `?page=smartAssets&view=create`，数量1，与上一入口分离。
- 输入“查询本地批量验收视频 · 1/3任务状态，有多少条已完成？”，真实页面返回“等待方案确认”、目标1条不代表成片完成数及总体结论。
- 截图在本仓库 `artifacts/assistant-browser-20261025/`：`12-creation-portal-three.jpg`、`13-creation-workbench.jpg`、`14-content-task-answer.jpg`、`15-shortcut-single-portal.jpg`。截图使用现有预览主题。
- 最终定向测试9/9通过，包含门户、批量、任务合同、原草稿恢复/产品选择、主助手合同。
- 最终 `pnpm run lint`（tsc --noEmit）、`pnpm run check:architecture`、`ARCHITECTURE_BASE_REF=7801dd0f pnpm run check:architecture`、`pnpm run build`、`git diff --check`通过。架构检查2794个生产TS文件；Studio chunk 371875/485000 bytes，构建仍有既有chunk大小警告。

验收边界：已验证意图到门户、门户到原工作台、草稿保存、原内部创建/读取接口及幂等和内部状态问答。未点击付费脚本生成或视频生成按钮，因此没有把供应商执行、成片质量或发布标记为通过；批量真实创建通过HTTP服务验证，浏览器验证止于创作准备。

## 回复精简（用户截图反馈）

删除具名任务回复中重复的“目标数量不代表完成数量”“不能证明此前是否开展工作”“其他进展应以记录为准”等句式。改为状态、计划数量，用户问完成数时只说一次“已完成数量：暂未查到”；结尾总体结论给出对应状态的下一步。缺失数据不补零，不虚构已完成数量。门户回复同样改为入口及下一步，通用回答规则要求仅说明影响本题答案的缺失信息一次，保留必要日期、范围及失败原因。

同一问题已在Chrome复测，返回“等待方案确认 / 计划数量：1条 / 已完成数量：暂未查到 / 总体结论：请在内容创作页确认方案”。截图 `artifacts/assistant-browser-20261025/16-concise-task-answer.jpg`。本轮定向测试6/6，架构预算相对7801dd0f通过；无供应商调用、提交或部署。

## 问答后的确认跳转

按用户后续修订，已有内容任务的问答结束后先询问是否前往处理，不立即显示卡片。服务端仅从唯一匹配的租户内容任务task_id生成offered元数据，明确肯定回复后本地返回ready门户；不调用模型、创建任务或执行接口。卡片点击复用原socialContentTaskId导航，实际打开后仍由原页面读取任务、恢复/保存制作项目及校验产品。

Chrome实测顺序：发送原具名状态问题 → 仅出现“是否前往内容创作页确认这条任务的方案？” → 回复“是” → 出现“内容创作 · 确认方案”门户 → 点击打开原 `socialtask_ab0e42722eaf9707c5037eb4` 工作台，标题“本地批量验收视频 · 1/3”，产品“验收用变压器”。原工作台创建/恢复制作项目 `studio_projects_3cd6af5c27f049d39e3cccc504884ded` 并显示本地测试产品资料待核对提示；未执行生成或确认方案动作。截图依次为 `17-task-navigation-offer.jpg`、`18-task-navigation-confirmed.jpg`、`19-task-portal-destination.jpg`，均在上述artifacts目录。

定向测试15/15通过，覆盖未确认不渲染、肯定确认、否定/带条件回复不确认、未知身份不提供入口、严格消息与journal保留、原任务导航及确认不发API请求；`pnpm run test:assistant-quality` 84/84通过。架构预算相对7801dd0f通过。范围限于已有内容任务的确定性状态问答；通用模型回复不会自行生成可执行门户。

## 输入框预填建议（用户批注修订）

在原AssistantComposer增加建议占位文字，首次Enter仅转成真实可编辑草稿，第二次Enter沿原send发送。发送按钮在占位阶段仍禁用；输入中、附件、回复流式进行中、创作选择时不展示建议，不覆盖已有草稿。Shift+Enter、IME候选确认及长按Enter不接受或发送建议。

续接来源：外部回答默认仅有折叠来源和“查看本次回答的信息来源”建议；用户发送后列出原回答已保存来源，建议换成“打开第1条来源原文”；明确发送打开原文后才返回严格HTTP(S)来源门户。多来源且未指定序号时先请求选择，不猜URL。来源门户沿原消息边界、journal、克隆和消息渲染保存，不执行新搜索，也不自动打开网站。新增文件 `shared/contracts/assistantSourcePortal.ts`、`src/lib/assistantFollowUp.ts`及测试；其余复用原Composer、Panel、Send、门户组件及消息保存链路。

Chrome实测原任务问答显示“打开这条任务”占位建议 → 点击输入框并Enter后只填入草稿，消息和门户未新增 → 再Enter发送后出现原任务门户。截图 `20-follow-up-suggestion.jpg`、`21-follow-up-draft-only.jpg`、`22-follow-up-sent-portal.jpg`。来源续接通过真实send钩子的离线响应回归验证，不声明本轮重新进行了外部供应商联调。

最终定向18/18通过，扩展后的原send钩子回归1/1通过，`pnpm run test:assistant-quality`87/87通过；`pnpm run lint`、相对7801dd0f架构预算、构建与`git diff --check`通过。构建保留既有chunk大小警告，Studio 371875/485000字节。HEAD仍7801dd0f，未提交、推送、部署或启动生成。

## 首页输入栏紧凑化与本地拖入（用户截图修订）

删除输入区倾斜加号卡片与其专属引导，原输入框改为共享蓝紫细边框，18px圆角。主页初始区域从230px降至156px，输入文字区从76px降至40px；原回复与输入分别14/18px，统一为共享body-large 16/24与系统无衬线字体。保留来源元数据等次要层级。拖入文件复用mergeAssistantAttachments校验、原待发送附件条与既有发送上传流程；忙碌时拒绝接收且阻止浏览器打开文件，普通文字拖放不拦截。纸夹按钮继续支持键盘和触屏。

Chrome只读DOM核对：输入框、助手正文、用户消息fontFamily完全一致，均16px/24px，textarea高度40px；截图 `23-compact-composer.jpg`。实际两次Enter分别填入“打开这条任务”与发送后返回门户。纸夹选择本地验收图片后显示文件名、53KB与“待随消息上传”，移除成功，未发送该图片；截图 `24-compact-pending-attachment.jpg`。本轮真实浏览器验证文件选择入口与列表；桌面文件拖动本身通过同一drop处理器定向测试验证，未声称人工Finder拖动已验收。

定向测试10/10通过，覆盖正文/来源/主助手合同、移除旧入口后附件合同、图片视频拖入接收、忙碌阻止、去重和非文件拖动不拦截；架构相对7801dd0f、构建和diff检查通过。当前源码HEAD7801dd0f，修改未提交、推送或部署。

## 输入边框随对话展开显示

仅改首页CSS，复用GlobalAssistant既有data-home-empty状态：初始首页无内层蓝紫边框，单纯聚焦也不出现光环；开始对话后显示蓝紫边框。Chrome实测聚焦初始输入时backgroundImage=none、boxShadow=none；发送具名本地任务状态问题后状态变为展开，backgroundImage含共享蓝紫渐变。截图 `25-composer-before-chat.jpg`、`26-composer-chat-open.jpg`。架构、构建和diff检查通过，保留既有构建chunk大小警告；无新增执行调用、提交或部署。
