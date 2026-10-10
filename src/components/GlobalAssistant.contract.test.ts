import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./GlobalAssistant.tsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const composerSource = fs.readFileSync(new URL('./assistant/AssistantComposer.tsx', import.meta.url), 'utf8');
const assistantGuidesSource = fs.readFileSync(new URL('../lib/assistantGuides.ts', import.meta.url), 'utf8');
const globalStylesSource = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function sourceSection(startMarker: string, endMarker: string, label: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `无法定位 ${label}`);
  return source.slice(start, end);
}

for (const surface of ['floating-reminder', 'conversation', 'decision']) {
  assert.match(source, new RegExp(`data-assistant-surface=["']${surface}["']`), `缺少 ${surface} 助手形态`);
}
assert.doesNotMatch(source, /data-assistant-surface=["']quick-actions["']|SKILL_AGENTS/, '灵小枢不得再展示四助手快捷轮盘');
assert.equal(source.match(/data-global-assistant=["']root["']/g)?.length, 1, '页面只能渲染一个灵小枢根入口');

const launcherClickSource = sourceSection('const handleLauncherClick', '\n  useEffect(', '灵小枢点击处理');
const launcherMarkup = sourceSection('<Badge count={pendingCount}', '</Button>', '灵小枢右上角入口');
assert.match(launcherClickSource, /openCurrentPageAgent\(\)/, '主入口点击灵小枢必须直接进入当前工作对话');
assert.doesNotMatch(launcherClickSource, /setMode\('expanded'\)|quick-actions|SKILL_AGENTS/, '点击灵小枢不得打开四助手快捷轮盘');
assert.match(source, /data-global-assistant="root"[\s\S]{0,220}className="fixed bottom-\[calc\(env\(safe-area-inset-bottom\)\+1rem\)\] right-4 z-\[75\]/, '灵小枢入口必须固定在页面右下角并避让设备安全区');
assert.match(source, /data-global-assistant="launcher"[\s\S]{0,300}aria-label=\{mode === 'chat' \? '收起灵小枢对话' : '询问灵小枢'\}/, '右上角入口必须以清晰文本直接打开或收起对话');
assert.match(launcherMarkup, /shape="round"/, '灵小枢入口必须采用紧凑胶囊形态');
assert.match(launcherMarkup, /!h-11/, '灵小枢入口必须保留 44px 触控高度');
assert.match(source, /aria-expanded=\{mode === 'chat'\}[\s\S]{0,80}aria-controls="global-assistant-panel"/, '入口必须暴露弹窗展开关系');
assert.match(launcherMarkup, /aria-haspopup="dialog"/, '灵小枢入口必须声明它会打开对话浮层');
assert.match(launcherMarkup, /var\(--ls-action-gradient\)/, '灵小枢入口图标必须复用全局主操作渐变 Token');
assert.doesNotMatch(source, /handlePointerDown|ASSISTANT_POSITION_KEY|data-global-assistant="edge-launcher"|setLauncherRetracted/, '右上角入口不得再保留拖动、旧坐标或自动缩边交互');
assert.doesNotMatch(globalStylesSource, /data-lingshu-assistant-clearance="bottom-navigation"/, '灵小枢入口不得依赖已经失效的旧底部导航标记');
assert.match(source, /id="global-assistant-panel"[\s\S]{0,720}bottom-14 right-0/, '灵小枢弹窗必须锚定在右下角入口上方');
assert.match(source, /role="dialog"[\s\S]{0,160}aria-modal="false"[\s\S]{0,160}aria-labelledby="global-assistant-panel-title"[\s\S]{0,160}aria-describedby="global-assistant-panel-description"/, '灵小枢必须以有名称和说明的非模态对话浮层呈现');
assert.match(source, /mode !== 'chat'\) return;[\s\S]{0,200}getElementById\('global-assistant-panel'\)\?\.focus\(\)/, '打开弹窗后必须把焦点移入对话区域');
assert.match(source, /setMode\('breathing'\);\s*window\.requestAnimationFrame\(\(\) => launcherButtonRef\.current\?\.focus\(\)\)/, '关闭弹窗后必须把焦点归还右上角入口');
assert.match(appSource, /\(!isAgentProductionSession\(\) \|\| page === 'digitalEmployees'\) && <GlobalAssistant/, '智能经营页不得因制作会话状态卸载灵小枢');
assert.match(appSource, /suppressForRightSidebar=\{page !== 'digitalEmployees' && \(/, '智能经营页必须保留入口，其他页仍遵守右侧栏避让规则');
assert.match(source, /width: assistantPanelWidth,\s*maxWidth: 'calc\(100vw - 32px\)'/, '灵小枢面板必须用视口宽度约束，不能被零宽定位根节点压缩');

assert.match(source, /const PRIMARY_ASSISTANT_THREAD:\s*OrbitAgentId\s*=\s*'business'/, '所有对话必须聚合到 business 主线程');
const persistThreadSource = sourceSection('const persistThread = useCallback', 'const openAgent', '助手线程持久化队列');
assert.match(persistThreadSource, /if \(queue\.running\) return/, '同一线程保存必须串行执行，不能并发全量覆盖');
assert.match(persistThreadSource, /expectedVersion/, '每次线程保存必须携带服务端版本前置条件');
assert.match(persistThreadSource, /response\.status === 409/, '版本冲突必须进入显式合并流程');
assert.match(persistThreadSource, /mergeAssistantThread\(remote, latestLocal\)/, '冲突恢复必须合并服务端状态与最新本地输入');
assert.match(persistThreadSource, /queue\.pending = cloneAssistantThread\(merged\)/, '合并后的最新状态必须重新排队保存');
assert.match(persistThreadSource, /assistantPersistenceRetryDelay\(queue\.retryAttempt\)/, '临时失败必须使用有界指数退避重新保存');
assert.match(persistThreadSource, /queue\.pending = cloneAssistantThread\(useAssistantStore\.getState\(\)\.threads\[agentId\]\)/, '失败重试必须始终携带最新本地快照');
assert.match(persistThreadSource, /keepalive:[\s\S]*ASSISTANT_PERSIST_KEEPALIVE_MAX_BYTES/, '所有不超过浏览器限制的保存都必须使用 keepalive，避免 pagehide 取消在途请求');
assert.match(persistThreadSource, /const fence = persistenceFenceRef\.current/, '每次保存必须绑定当前租户与用户的组件实例 fence');
assert.match(persistThreadSource, /if \(!fenceIsCurrent\(\)\) return/, '旧 scope 的异步保存返回后不得再读写全局线程状态');
assert.match(persistThreadSource, /\.\.\.scopedAuthHeaders/, '保存重试必须固定使用启动该队列时的认证范围');
assert.match(persistThreadSource, /signal: controller\.signal/, 'scope 卸载时必须能够取消旧身份的在途请求');
assert.doesNotMatch(persistThreadSource, /keepalive:\s*reason === 'lifecycle'/, 'keepalive 不得只覆盖 lifecycle 新请求，否则已在途保存仍会被取消');
assert.doesNotMatch(persistThreadSource, /fetch\([^]*\)\.catch\(\(\) => \{\}\)/, '不得继续使用无序且吞错的 fire-and-forget PUT');
assert.match(source, /window\.addEventListener\('online', retryPendingThreads\)/, '网络恢复后必须重试未保存会话');
assert.match(source, /document\.addEventListener\('visibilitychange', handleVisibility\)/, '页面重新可见时必须重试未保存会话');
assert.match(source, /window\.addEventListener\('pagehide', flushPendingThreads\)/, '页面离开前必须触发生命周期安全保存');
const openAgentSource = sourceSection('const openAgent = useCallback', 'const openCurrentPageAgent', '打开灵小枢会话');
assert.match(openAgentSource, /const agentId = PRIMARY_ASSISTANT_THREAD/, '从任一页面打开灵小枢都必须读取 business 主线程');
assert.match(source, /if \(page === 'socialInspiration' \|\| page === 'scriptLibrary'\) return 'director'/, '页面仍需保留内部业务路由');
assert.match(source, /if \(page === 'smartAssets'\) return 'content'/, '内容制作页仍需路由到内部内容能力');
assert.match(source, /if \(page === 'conversion'[^\n]+return 'customer'/, '客户相关页面仍需路由到内部客户能力');

assert.match(source, /scroller\.scrollHeight - scroller\.scrollTop - scroller\.clientHeight <= 24/, '必须识别用户是否仍在跟随最新消息');
assert.match(source, /!activeThread\.isFollowingLatest/, '用户浏览历史时不得强制滚动到底部');
assert.match(source, /跳到最新消息|回到最新消息/, '浏览历史消息时必须提供回到最新消息的明确入口');
const decisionSurfaceSource = sourceSection('data-assistant-surface="decision"', ') : isCustomerTodoView ?', '决策卡界面');
assert.doesNotMatch(
  decisionSurfaceSource,
  /onClick=\{\(\) => setPanelView\('chat'\)\}/,
  '从决策卡返回对话必须经过会话滚动恢复逻辑',
);
assert.doesNotMatch(
  source,
  /panelView === 'decision'\) setPanelView\('chat'\)/,
  '标题栏从决策卡返回时也必须恢复原会话滚动位置',
);

assert.match(source, /关闭窗口（任务继续）/, '关闭窗口必须与暂停任务分离');
assert.match(source, /暂停当前任务/, '必须提供独立的暂停操作');
assert.match(source, /assistantRunControl\(focusedTaskCard\)/, '暂停按钮只能由可执行运行任务的后端目标决定');
assert.doesNotMatch(source, /objectId:\s*focusedTaskCard\.taskId/, '不得把展示卡片编号猜成可执行运行编号');
assert.match(source, /const accepted = response\.status === 'accepted' \|\| response\.status === 'completed'/, '只有后端确认后才能改变本地暂停状态');
assert.match(source, /persistThread\(activeAgent\)/, '关闭前必须保留任务、对话和草稿');

const sendSource = sourceSection('const send = useCallback', 'const handleTaskCardAction', '自然语言发送流程');
assert.match(sendSource, /const threadAgent = PRIMARY_ASSISTANT_THREAD/, '发送消息必须写入 business 主线程');
assert.match(sendSource, /fetch\(API_PATH\[agentForOrbit\(routeAgent\)\]/, 'business 主线程聚合不得丢失当前页面的内部能力路由');
assert.doesNotMatch(sendSource, /setPaused\(targetAgent,\s*false\)/, '发送普通消息不得擅自把任务恢复为运行中');
assert.match(sendSource, /focusedNaturalLanguageActionInput\(focusedCard, focusedMutationActionId\)/, '自然语言确定性操作必须从当前卡片读取后端签发输入');
assert.match(sendSource, /\.\.\.\(focusedActionInput \?\? \{\}\)/, '只有兼容的聚焦操作输入才可进入自然语言请求');
assert.match(sendSource, /const signedFocusedMutationActionId = focusedActionInput \? focusedMutationActionId : undefined/, '只有找到唯一签名卡片动作后才可把自然语言映射为写操作');
assert.match(sendSource, /signedFocusedMutationActionId \? \{ actionId: signedFocusedMutationActionId \} : \{\}/, '自然语言写操作必须把唯一签名动作编号显式交给确定性路由');
assert.match(
  sendSource,
  /actionResponse\.status !== 'delegated' && actionResponse\.status !== 'not_handled'/,
  '后端返回 not_handled 时必须回落到现有对话链路，而不是提前结束',
);
assert.match(
  sendSource,
  /signedFocusedMutationActionId \? \{ deterministicActionId: signedFocusedMutationActionId \} : undefined/,
  '明确的自然语言确定性操作必须把动作意图传给操作请求错误处理',
);

const actionExecutionSource = sourceSection('const executeAssistantAction = useCallback', 'const presentActionResponse', '确定性操作请求');
assert.match(actionExecutionSource, /httpStatus === 409/, '冲突 HTTP 状态必须转换成过期操作卡');
assert.match(actionExecutionSource, /httpStatus === 422/, '缺输入 HTTP 状态必须转换成缺输入卡');
assert.match(actionExecutionSource, /if \(!response\.ok\) \{[\s\S]*return actionFailure/, '任何操作路由 HTTP 失败都必须展示失败或缺输入卡');
assert.match(actionExecutionSource, /missingInput \? 'missing_required_input' : 'failure'/, '缺输入和失败必须遵守对应通知规则');
assert.doesNotMatch(actionExecutionSource, /return null/, '路由错误或无效响应不得伪装成未处理并回落通用聊天');
assert.match(actionExecutionSource, /Only an explicit delegated\/not_handled/, '只有明确 delegated/not_handled 才允许回落通用聊天');

const naturalLanguageInputSource = sourceSection('function focusedNaturalLanguageActionInput', '\n}', '自然语言操作输入');
const focusedMutationPatternsSource = sourceSection('const FOCUSED_MUTATION_PATTERNS', '\n];', '聚焦卡自然语言动作匹配');
assert.match(focusedMutationPatternsSource, /批准\|确认[^\n]+报价/, '聚焦报价卡必须识别批准报价、确认报价和批准这份报价');
assert.match(focusedMutationPatternsSource, /'start_task'[^\n]+开始执行/, '开始执行当前任务只能映射到聚焦卡签发的 start_task 动作');
assert.match(naturalLanguageInputSource, /assistantActionTarget\(card, actionId\)/, '自然语言操作目标必须由后端签发的卡片动作解析');
assert.match(naturalLanguageInputSource, /matchingActions\.length !== 1/, '不明确或不兼容的卡片动作不得被猜测');
assert.match(naturalLanguageInputSource, /return \{ target, \.\.\.\(parameters \? \{ parameters \} : \{\}\) \}/, '兼容的自然语言操作必须携带目标、版本及原始参数');
assert.doesNotMatch(naturalLanguageInputSource, /text|报价|quote/i, '报价短句不得参与构造业务对象身份或选择参数');
assert.match(
  assistantGuidesSource,
  /暂停、继续、确认、修改、删除、发布等写操作只能通过当前任务卡的已签名动作执行[^']+禁止用对话文本声称成功/,
  '通用对话规范必须禁止模型声称写操作成功',
);

const integrationFactsSource = sourceSection('async function loadLiveIntegrationFacts', 'function mergeConsecutiveAssistant', '实时接入事实');
assert.match(integrationFactsSource, /socialAccounts\.filter\([^\n]+=== 'connected'\)/, '社媒账号只可统计 connected 状态');
assert.match(integrationFactsSource, /youtubeAccounts\.filter\([^\n]+=== 'connected'\)/, 'YouTube 账号只可统计 connected 状态');
assert.match(integrationFactsSource, /\[\.\.\.connectedSocialAccounts, \.\.\.connectedYoutubeAccounts\]\.reduce/, '曝光汇总只能使用已接通账号');
assert.match(integrationFactsSource, /if \(connectedSocialAccounts\.length\)[^\n]+已接入社媒账号/, '社媒账号数量只能来自已接通账号');
assert.match(integrationFactsSource, /if \(connectedYoutubeAccounts\.length\)[^\n]+已接入 YouTube 账号/, 'YouTube 账号数量只能来自已接通账号');
assert.doesNotMatch(integrationFactsSource, /if \(socialAccounts\.length\)|if \(youtubeAccounts\.length\)|\[\.\.\.socialAccounts, \.\.\.youtubeAccounts\]/, '未接通账号不得混入数量或曝光统计');

const taskCardActionSource = sourceSection('const handleTaskCardAction', '\n  useEffect(() => {', '任务卡按钮操作');
assert.match(taskCardActionSource, /const parameters = action\.parameters/, '按钮操作必须读取后端签发的 action.parameters');
assert.match(taskCardActionSource, /\.\.\.\(parameters \? \{ parameters \} : \{\}\)/, '按钮操作必须把同一 parameters 对象原样转发到请求');

const hydrationSource = sourceSection(
  'if (assistantThreadHydrationStartedRef.current)',
  "fetch('/api/overseas/enterprise/context'",
  '助手线程恢复流程',
);
assert.match(hydrationSource, /actionId:\s*'view_status'/, '恢复聚焦卡片时必须重新读取权威工作状态');
assert.match(hydrationSource, /executeAssistantAction\(PRIMARY_ASSISTANT_THREAD, request\)/, '刷新后必须由服务端重新签发可执行动作');
assert.match(hydrationSource, /assistantThreadHydrationStartedRef\.current/, '线程持久化快照每次挂载只能初始化一次');
assert.match(hydrationSource, /version:\s*Number\.isSafeInteger/, '恢复线程时必须同时恢复服务端 CAS 版本');
assert.match(hydrationSource, /threads\[PRIMARY_ASSISTANT_THREAD\]\s*!==\s*threadBeforeRequest/, '旧线程快照不得覆盖请求期间产生的本地输入');
assert.match(hydrationSource, /threads\[PRIMARY_ASSISTANT_THREAD\]\s*!==\s*hydratedThread/, '过期重签结果不得覆盖请求期间产生的新卡片或焦点');
assert.match(hydrationSource, /actionCardToTaskCard\(response\.card, response, CURRENT_STATUS_TASK_ID\)/, '重新签发的动作必须进入专用的权威状态卡');
assert.match(hydrationSource, /focusTaskCard\(PRIMARY_ASSISTANT_THREAD, CURRENT_STATUS_TASK_ID\)/, '恢复后只可聚焦最新权威状态卡');
assert.doesNotMatch(hydrationSource, /actionCardToTaskCard\(response\.card, response, persistedFocusedTaskId\)/, '不得把当前任意决策错误绑定到旧聚焦卡片');
assert.doesNotMatch(hydrationSource, /persistThread\(/, '重新签发的动作不得再次写回不可信线程快照');

const responseStatusSource = sourceSection('function taskStatusFromResponse', '\n}', '助手任务状态映射');
assert.match(responseStatusSource, /signedRunControl/, '刷新后的运行状态必须来自服务端签发的运行控制');
assert.match(responseStatusSource, /resume_task[^]*return 'paused'/, '签发继续动作时卡片必须恢复为已暂停状态');
assert.match(responseStatusSource, /pause_task[^]*return 'running'/, '签发暂停动作时卡片必须恢复为执行中状态');

const responseIdentitySource = sourceSection('function actionResponseCardId', '\n}', '响应卡片身份规则');
assert.match(responseIdentitySource, /request\.target\?\.objectId/, '同一业务对象的后续响应必须更新原卡片');
assert.match(responseIdentitySource, /responseTargets\.some\(target =>/, '响应动作目标与请求不一致时不得覆盖原对象卡片');
assert.match(responseIdentitySource, /target\.objectType !== requestObjectType/, '对象类型不一致也必须视为跨对象响应');
assert.match(responseIdentitySource, /if \(responseDisagreesWithRequest\) return response\.requestId \|\| request\.requestId/, '跨对象响应不得挂到任何旧对象卡片，必须建立独立响应卡');
assert.match(responseIdentitySource, /response\.requestId/, '没有业务对象的新响应必须用 requestId 建立独立卡片');
assert.match(responseIdentitySource, /matchingCardIds\.length === 1[\s\S]*response\.requestId \|\| request\.requestId/, '只有已存在的同一 objectId 才可更新原卡片，新对象必须以 requestId 建卡');
assert.doesNotMatch(responseIdentitySource, /:\s*objectId\s*;/, '新卡片不得直接用业务 objectId 代替 requestId');
assert.doesNotMatch(source, /`\$\{agentId\}:\$\{response\.actionId\}`/, '不得按 Agent 与动作名合并互不相关的新卡片');

const crossObjectFilterSource = sourceSection('function responseWithoutCrossObjectActions', '\n}', '跨对象动作过滤');
assert.match(crossObjectFilterSource, /responseHasCrossObjectAction\(request, response\)/, '响应进入展示前必须识别跨对象动作');
assert.match(crossObjectFilterSource, /action\.target\.objectId\.trim\(\) === requestObjectId/, '只可保留当前请求对象的签名动作');
assert.match(crossObjectFilterSource, /secondaryActions:[\s\S]*\.filter\(safeAction\)/, '跨对象的次级动作也必须全部过滤');

const presentResponseSource = sourceSection('const presentActionResponse', 'const send = useCallback', '操作结果展示');
const presentNotifyIndex = presentResponseSource.indexOf('shouldNotifyAssistant(');
const presentFocusIndex = presentResponseSource.indexOf('focusTaskCard(');
const presentDecisionIndex = presentResponseSource.indexOf("setPanelView('decision')");
assert.ok(
  presentNotifyIndex >= 0
    && presentFocusIndex >= 0
    && presentDecisionIndex >= 0,
  '用户主动操作的常规结果必须静默聚焦结果卡，不得只留下文本摘要',
);
assert.doesNotMatch(presentResponseSource, /role: 'assistant', content: response\.card\.summary/, '用户操作结果不得降级成丢失动作和工作区链接的纯文本摘要');
assert.match(presentResponseSource, /if \(!shouldNotifyAssistant\(notificationReason\)\)[\s\S]*focusTaskCard\(agentId, stableTaskId\)[\s\S]*setPanelView\('decision'\)/, '常规成功结果必须展示交互卡但不触发通知分支');
assert.match(presentResponseSource, /WORKFLOW_MUTATION_ACTIONS\.has\(response\.actionId\)[\s\S]*actionId: 'view_status'/, '任一成功 workflow mutation 后必须读取一次最新权威状态，不能依赖响应是否携带下一对象动作');
assert.match(presentResponseSource, /threads\[agentId\] !== threadAfterMutation/, '跨对象状态回读必须避免覆盖用户后续操作');
assert.match(presentResponseSource, /actionCardToTaskCard\(statusResponse\.card, statusResponse, CURRENT_STATUS_TASK_ID\)/, '新对象状态必须放入独立权威状态卡');
const mutationActionsSource = sourceSection('const WORKFLOW_MUTATION_ACTIONS', ']);', '工作流 mutation 动作集合');
assert.doesNotMatch(mutationActionsSource, /'view_status'/, 'view_status 不得被归类为 workflow mutation，避免状态回读递归');
assert.doesNotMatch(presentResponseSource, /actionCardToTaskCard\(statusResponse\.card, statusResponse, stableTaskId\)/, '新对象状态绝不能回填原 mutation 卡');

const cardEventEnd = source.indexOf("window.addEventListener('lingshu-assistant-card'");
const cardEventStart = source.lastIndexOf('useEffect(() => {', cardEventEnd);
assert.ok(cardEventStart >= 0 && cardEventEnd > cardEventStart, '无法定位任务卡事件处理');
const cardEventSource = source.slice(cardEventStart, cardEventEnd);
const cardNotifyIndex = cardEventSource.indexOf('shouldNotifyAssistant(');
const cardFocusIndex = cardEventSource.indexOf('focusTaskCard(');
const cardDecisionIndex = cardEventSource.indexOf("setPanelView('decision')");
assert.ok(
  cardNotifyIndex >= 0
    && (cardFocusIndex < 0 || cardNotifyIndex < cardFocusIndex)
    && (cardDecisionIndex < 0 || cardNotifyIndex < cardDecisionIndex),
  '常规后台卡片不得抢焦点、切换界面或打断用户',
);

assert.match(source, /shouldNotifyAssistant\(detail\.reason \?\? 'routine'\)/, '一次性语音气泡也必须遵守通知策略');
const routinePerformanceIgnored = /if \(!shouldNotifyAssistant\(reason\)\)[\s\S]{0,160}(?:return|setPerformance\(null\))/.test(source);
assert.ok(routinePerformanceIgnored, '常规后台性能事件不得触发灵小枢提示');

assert.match(source, /focusedTaskCard\.secondaryActions\.map/, '决策形态必须渲染交互选择卡操作');
assert.match(source, /focusedTaskCard\.workspace\.href/, '完整结果必须可以进入工作区');
assert.match(source, /<AssistantComposer/, '灵小枢必须使用统一输入组件');
assert.match(composerSource, /rows=\{1\}/, '输入框必须默认只占一行');
assert.match(composerSource, /maxLength=\{4000\}/, '输入框必须遵守确定性操作接口的长度边界');
assert.match(composerSource, /max-h-\[88px\]/, '输入框最多只能扩展到三行');
assert.match(source, /Math\.min\(input\.scrollHeight, 88\)/, '输入框必须自动增高但不得超过三行');

const attachmentSendSource = sourceSection('const sendComposerMessage = useCallback', 'const handleTaskCardAction', '附件发送流程');
assert.match(attachmentSendSource, /studioApi\.uploadMaterialFile/, '附件必须通过真实的我的素材上传接口持久化');
assert.match(attachmentSendSource, /if \(!result\.ok \|\| !result\.material\?\.id\)/, '没有真实素材编号时不得展示上传成功');
assert.match(attachmentSendSource, /uploadedAttachmentCacheRef\.current\.set/, '部分上传成功后必须缓存真实回执，重试不得重复上传');
assert.match(attachmentSendSource, /setAttachmentError/, '上传失败必须保留附件并明确提示');
assert.doesNotMatch(attachmentSendSource, /URL\.createObjectURL|data:/, '不得把本地 blob 或 data URL 伪装成持久化附件');
assert.match(sendSource, /uploadedAttachments\.length\s*\?\s*null\s*:\s*await executeAssistantAction/, '携带附件的消息不得猜测确定性操作参数');
assert.match(sendSource, /附件事实边界/, '对话模型必须获知附件只完成持久化、尚未证明已读取内容');

console.log('global assistant contract tests passed');
