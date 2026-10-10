import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./GlobalAssistant.tsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const composerSource = fs.readFileSync(new URL('./assistant/AssistantComposer.tsx', import.meta.url), 'utf8');
const assistantStylesSource = fs.readFileSync(new URL('./assistant/assistantDecisionCenter.css', import.meta.url), 'utf8');
const conversationContextSource = fs.readFileSync(new URL('../lib/assistantConversationContext.ts', import.meta.url), 'utf8');
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
const launcherMarkup = sourceSection('<Badge count={decisionTotal ?? pendingCount}', '</Button>', '灵小枢右下角入口');
assert.match(launcherClickSource, /openCurrentPageAgent\(\)/, '主入口点击灵小枢必须直接进入当前工作对话');
assert.doesNotMatch(launcherClickSource, /setMode\('expanded'\)|quick-actions|SKILL_AGENTS/, '点击灵小枢不得打开四助手快捷轮盘');
assert.match(source, /data-global-assistant="root"[\s\S]{0,350}fixed right-4[\s\S]{0,350}bottom-\[calc\(env\(safe-area-inset-bottom\)\+1rem\)\]/, '灵小枢入口必须固定在页面右下角并避让设备安全区');
assert.match(source, /data-global-assistant="launcher"[\s\S]{0,300}aria-label=\{mode === 'chat' \? '收起灵小枢对话' : '询问灵小枢'\}/, '右下角入口必须以清晰文本直接打开或收起对话');
assert.match(launcherMarkup, /shape="round"/, '灵小枢入口必须采用紧凑胶囊形态');
assert.match(launcherMarkup, /!h-11/, '灵小枢入口必须保留 44px 触控高度');
assert.match(source, /aria-expanded=\{mode === 'chat'\}[\s\S]{0,80}aria-controls="global-assistant-panel"/, '入口必须暴露弹窗展开关系');
assert.match(launcherMarkup, /aria-haspopup="dialog"/, '灵小枢入口必须声明它会打开对话浮层');
assert.match(launcherMarkup, /var\(--ls-action-gradient\)/, '灵小枢入口图标必须复用全局主操作渐变 Token');
assert.doesNotMatch(source, /handlePointerDown|ASSISTANT_POSITION_KEY|data-global-assistant="edge-launcher"|setLauncherRetracted/, '右下角入口不得再保留拖动、旧坐标或自动缩边交互');
assert.doesNotMatch(globalStylesSource, /data-lingshu-assistant-clearance="bottom-navigation"/, '灵小枢入口不得依赖已经失效的旧底部导航标记');
assert.match(source, /id="global-assistant-panel"[\s\S]{0,720}bottom-14 right-0/, '灵小枢弹窗必须锚定在右下角入口上方');
assert.match(source, /max-h-\[calc\(100dvh-env\(safe-area-inset-bottom\)-96px\)\]/, '灵小枢弹窗高度必须避让移动设备底部安全区');
assert.match(source, /role="dialog"[\s\S]{0,160}aria-modal="false"[\s\S]{0,160}aria-labelledby="global-assistant-panel-title"[\s\S]{0,160}aria-describedby="global-assistant-panel-description"/, '灵小枢必须以有名称和说明的非模态对话浮层呈现');
assert.match(source, /mode !== 'chat'\) return;[\s\S]{0,200}getElementById\('global-assistant-panel'\)\?\.focus\(\)/, '打开弹窗后必须把焦点移入对话区域');
assert.match(source, /setMode\('breathing'\);\s*window\.requestAnimationFrame\(\(\) => launcherButtonRef\.current\?\.focus\(\)\)/, '关闭弹窗后必须把焦点归还右下角入口');
assert.match(appSource, /<GlobalAssistant[\s\S]{0,650}compactMode=\{starterMode \|\| isAgentProductionSession\(\)\}/, '制作会话保留紧凑的灵小枢审批和聊天入口');
assert.match(source, /useState<AssistantPanelView>\('chat'\)/, '灵小枢默认页必须是单列对话');
assert.match(source, /openAgent\(currentPageAgent, 'chat'\)/, '入口必须直接打开单列对话而不是强制进入审批详情');
assert.doesNotMatch(source, /aria-label="灵小枢工作视图"/, '单列对话不得保留待办与聊天页签');
assert.match(source, /const \[decisionDialog,\s*setDecisionDialog\]/, '外部决策弹窗必须使用独立状态，不得复用助手内部分页');
const taskSummarySource = sourceSection(
  'data-assistant-summary="task-card"',
  'data-assistant-summary="decision-feed"',
  '普通任务概要气泡',
);
assert.match(taskSummarySource, /onClick=\{[\s\S]*openDecisionDialog\(/, '普通任务概要必须打开统一外部决策弹窗');
assert.doesNotMatch(taskSummarySource, /setPanelView\('decision'\)/, '普通任务详情不得再渲染在助手内部');
const decisionFeedSummarySource = sourceSection(
  'data-assistant-summary="decision-feed"',
  'variant="summary"',
  '权威待办概要气泡',
);
assert.match(decisionFeedSummarySource, /onOpenDetail=\{[\s\S]*openDecisionDialog\(/, '权威待办概要必须打开统一外部决策弹窗');
assert.doesNotMatch(decisionFeedSummarySource, /setPanelView\('approvals'\)/, '权威待办详情不得再渲染在助手内部');

const assistantPanelSource = sourceSection(
  'id="global-assistant-panel"',
  '<Modal',
  '灵小枢对话面板',
);
assert.doesNotMatch(assistantPanelSource, /variant="detail"|data-assistant-page="decision-detail"|focusedTaskCard\.details\.map/, '助手面板内不得渲染任何决策详情');
const externalDecisionDialogSource = sourceSection(
  '<Modal',
  '<Badge count={decisionTotal ?? pendingCount}',
  '外部决策弹窗',
);
assert.match(externalDecisionDialogSource, /data-global-assistant="decision-dialog"/, '外部决策弹窗必须有稳定语义标记');
assert.match(externalDecisionDialogSource, /open=\{Boolean\(decisionDialog\)\}/, '外部 Modal 只能由独立决策弹窗状态控制');
assert.match(externalDecisionDialogSource, /onCancel=\{closeDecisionDialog\}/, '关闭外部 Modal 必须走统一关闭流程');
assert.match(externalDecisionDialogSource, /decisionDialog\?\.kind === 'feed'[\s\S]*variant="detail"/, '权威待办详情必须在外部 Modal 重新读取');
assert.match(externalDecisionDialogSource, /decisionDialog\?\.kind === 'task'[\s\S]*dialogTaskCard/, '普通任务详情必须使用同一外部 Modal');
assert.doesNotMatch(externalDecisionDialogSource, /getContainer=\{false\}/, '外部 Modal 不得被挂载回灵小枢面板内');
const closeExternalDecisionDialogSource = sourceSection(
  'const closeDecisionDialog',
  'const handleDecisionActionResult',
  '关闭外部决策弹窗',
);
assert.match(closeExternalDecisionDialogSource, /setDecisionDialog\(null\)/, '关闭详情只清理外部弹窗状态');
assert.doesNotMatch(closeExternalDecisionDialogSource, /setMode\(|setMessages\(|setDraftInput\(|closeAssistant\(/, '关闭详情必须保留对话、草稿、附件与助手开启状态');
assert.match(closeExternalDecisionDialogSource, /setDecisionFeedRevision\(revision => revision \+ 1\)/, '关闭外部详情后必须重新读取概要权威状态');
assert.match(closeExternalDecisionDialogSource, /closeDecisionDialogForNavigation[\s\S]{0,360}decisionDialogRestoreFocusRef\.current = false;[\s\S]{0,120}setDecisionDialog\(null\)/, '深链导航必须先关闭外部弹窗并禁止把焦点送回旧页面');
const restoreExternalDecisionDialogFocusSource = sourceSection(
  'const restoreDecisionDialogFocus',
  'const rememberGuide',
  '外部决策弹窗焦点恢复',
);
assert.match(restoreExternalDecisionDialogFocusSource, /originalTrigger\?\.isConnected[\s\S]*querySelector<HTMLButtonElement>/, '概要刷新替换触发器后仍必须恢复到当前语义按钮');
assert.match(restoreExternalDecisionDialogFocusSource, /const shouldRestoreFocus = decisionDialogRestoreFocusRef\.current[\s\S]{0,300}if \(!shouldRestoreFocus\) return;\s*window\.requestAnimationFrame/, '导航关闭后不得由 afterClose 抢回新页面焦点');
assert.match(externalDecisionDialogSource, /afterClose=\{restoreDecisionDialogFocus\}/, 'Modal 关闭完成后必须统一恢复焦点');
assert.match(externalDecisionDialogSource, /focusTriggerAfterClose=\{false\}/, '必须关闭 Ant 自带焦点回送，避免导航后抢回旧页面焦点');
assert.match(externalDecisionDialogSource, /onNavigate=\{closeDecisionDialogForNavigation\}/, '权威待办深链必须通过显式回调关闭外部弹窗');
assert.match(externalDecisionDialogSource, /onActionResult=\{handleDecisionActionResult\}/, '权威待办动作结果必须回到对话壳形成一次性结果反馈');
assert.match(externalDecisionDialogSource, /href=\{dialogTaskCard\.workspace\.href\}[\s\S]{0,120}onClick=\{\(\) => closeDecisionDialogForNavigation\(\)\}/, '普通任务工作区链接也必须在导航前关闭外部弹窗');
assert.match(appSource, /suppressForRightSidebar=\{page !== 'digitalEmployees' && \(/, '智能经营页必须保留入口，其他页仍遵守右侧栏避让规则');
assert.match(source, /width: assistantPanelWidth,\s*maxWidth: 'calc\(100vw - 32px\)'/, '灵小枢面板必须用视口宽度约束，不能被零宽定位根节点压缩');
assert.match(source, /assistantTool === 'knowledge-intake' \? 560 : 420/, '灵小枢对话面板必须保持 420px 基准宽度，外部详情不得挤压对话宽度');

const decisionActionResultSource = sourceSection(
  'const handleDecisionActionResult',
  'const restoreDecisionDialogFocus',
  '周任务结果气泡',
);
assert.match(decisionActionResultSource, /execution\.goalId !== result\.card\.subject\.id/, '结果气泡只能接受与当前周目标相符的真实执行回执');
assert.match(decisionActionResultSource, /`\$\{execution\.runId\}:\$\{execution\.status\}`/, '结果必须按真实运行与状态去重');
assert.match(decisionActionResultSource, /handledDecisionResultsRef\.current\.has\(resultKey\)/, '普通重渲染不得重复插入结果气泡');
assert.match(decisionActionResultSource, /assistantDecisionExecutionFeedback\(execution\)/, '气泡文案必须按真实运行状态区分开始、等待、失败与完成');
assert.match(decisionActionResultSource, /setMessages\(PRIMARY_ASSISTANT_THREAD,[\s\S]{0,240}role: 'assistant'/, '已核验结果只追加一次普通助手气泡');
assert.match(decisionActionResultSource, /closeDecisionDialog\(\)[\s\S]{0,120}persistThread\(PRIMARY_ASSISTANT_THREAD\)/, '结果到达后关闭已处理详情并保存对话状态');

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
assert.doesNotMatch(source, /setPanelView\('(approvals|decision)'\)/, '决策详情已统一外置，不得恢复助手内部详情分页');

const revealWelcomeSource = sourceSection(
  'const revealConversationWelcomeOnce',
  'const openAgent',
  '空线程欢迎语显示规则',
);
assert.match(revealWelcomeSource, /if \(thread\.messages\.length\)[\s\S]*setWelcomeBubbleVisible\(false\)/, '已有消息时不得继续渲染欢迎语占位');
assert.match(revealWelcomeSource, /welcomeBubbleScopeRef\.current === welcomeBubbleStorageKey/, '同一身份范围内重复打开面板不得重播欢迎语');
assert.match(revealWelcomeSource, /localStorage\.getItem\(welcomeBubbleStorageKey\)[\s\S]*localStorage\.setItem\(welcomeBubbleStorageKey, 'true'\)/, '欢迎语首次展示状态必须跨面板开关保存');
assert.match(revealWelcomeSource, /setWelcomeBubbleVisible\(!alreadySeen\)/, '欢迎语只能在从未展示过的空线程中出现一次');
assert.match(source, /if \(!assistantThreadHydrated \|\| mode !== 'chat' \|\| panelView !== 'chat'\) return;[\s\S]{0,120}revealConversationWelcomeOnce\(\)/, '必须等待持久化线程恢复完成后再判断是否显示欢迎语');
const welcomeBubbleSource = sourceSection(
  'data-assistant-bubble="welcome"',
  '{activeThread.messages.map',
  '欢迎语气泡',
);
assert.match(welcomeBubbleSource, /ls-assistant-bubble-enter/, '欢迎语必须作为普通可滚动气泡进入消息流');
assert.match(source, /welcomeBubbleVisible && !activeThread\.messages\.length/, '线程恢复出任意消息后必须立即隐藏欢迎语');
assert.doesNotMatch(welcomeBubbleSource, /\b(?:sticky|fixed|absolute)\b/, '欢迎语不得置顶、固定或脱离消息滚动流');

assert.match(source, /function assistantBubbleStyle\(index: number\)[\s\S]*Math\.min\(Math\.max\(0, index\), 6\)[\s\S]*--assistant-bubble-delay': `\$\{boundedIndex \* 15\}ms`/, '气泡进入顺序必须使用 15ms 间隔并在第 6 项封顶');
for (const bubble of ['welcome', 'loading', 'task-summary', 'decision-summary']) {
  assert.match(source, new RegExp(`data-assistant-bubble=["']${bubble}["']`), `${bubble} 必须具有稳定的气泡语义标记`);
}
assert.match(source, /data-assistant-bubble=\{msg\.role\}[\s\S]{0,180}ls-assistant-bubble-enter|ls-assistant-bubble-enter[\s\S]{0,180}data-assistant-bubble=\{msg\.role\}/, '用户与助手消息必须使用统一气泡进入动效');
assert.match(source, /data-assistant-bubble="(?:task-summary|decision-summary)"[\s\S]{0,220}style=\{assistantBubbleStyle/, '概要气泡必须加入同一顺序索引');
assert.match(assistantStylesSource, /\.ls-assistant-bubble-enter\s*\{[\s\S]{0,220}animation:\s*ls-assistant-bubble-enter var\(--ls-motion-(?:fast|enter)\) var\(--ls-ease-enter\) both;[\s\S]{0,120}animation-delay:\s*var\(--assistant-bubble-delay, 0ms\)/, '普通气泡必须复用共享进入时长、缓动与有界顺序延迟');
assert.match(assistantStylesSource, /\.ls-assistant-summary-bubble-enter:has\([\s\S]{0,260}animation:\s*ls-assistant-bubble-enter var\(--ls-motion-(?:fast|enter)\) var\(--ls-ease-enter\) both;[\s\S]{0,140}animation-delay:\s*var\(--assistant-bubble-delay, 0ms\)/, '概要气泡外层必须复用同一进入动效和顺序延迟');
assert.match(assistantStylesSource, /\[data-assistant-bubble\] \.assistant-decision-summary\s*\{[\s\S]{0,80}animation:\s*none/, '概要卡位于气泡内时必须禁用自身动画，避免双重位移');
assert.match(assistantStylesSource, /@keyframes ls-assistant-bubble-enter\s*\{[\s\S]{0,160}opacity:\s*0;\s*transform:\s*translateY\((?:[1-8])px\)/, '气泡进入只能使用不超过 8px 的轻位移与透明度');
assert.match(assistantStylesSource, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ls-assistant-bubble-enter[\s\S]{0,180}animation:\s*none\s*!important/, '减少动态效果时必须立即显示全部气泡');

assert.match(source, /关闭窗口（任务继续）/, '关闭窗口必须与暂停任务分离');
assert.match(source, /暂停当前任务/, '必须提供独立的暂停操作');
assert.match(source, /assistantRunControl\(dialogTaskCard\)/, '外部任务详情的暂停按钮只能由可执行运行任务的后端目标决定');
assert.doesNotMatch(source, /objectId:\s*dialogTaskCard\.taskId/, '不得把展示卡片编号猜成可执行运行编号');
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
assert.match(sendSource, /selectAssistantConversationContext\(mergeConsecutiveAssistant\(thread\.messages\)\)/, '长对话必须按完整轮次和预算选择上下文');
assert.match(sendSource, /renderAssistantConversationBoundary\(conversationContext\)/, '被裁剪的较早对话必须向模型声明范围边界');
assert.match(sendSource, /strategyRequest \? '' : await loadLiveIntegrationFacts\(\)/, '经营主对话必须使用服务端核验事实而不是客户端汇总作为权威依据');
assert.match(sendSource, /userQuestion: visibleText[\s\S]{0,260}retainedUserInstructions/, '经营主对话必须把当前问题与有界历史约束交给服务端组装上下文');
assert.match(sendSource, /requestToken === getToken\(\)/, '身份切换后旧请求的异步响应必须被丢弃');

assert.doesNotMatch(
  source,
  /AssistantDecisionMemoryPanel|AssistantDecisionSaveButton|useAssistantDecisionMemory/,
  '对话记忆由后台默认机制维护，灵小枢前端不得显示查看、保存或撤销入口',
);
assert.match(conversationContextSource, /较早用户原话/, '历史用户约束必须保留原文且不得升级为已核验事实');

const responseErrorSource = sourceSection('async function responseErrorMessage', '\n}\n\nfunction todoToneClass', '助手请求错误提示');
const localizedMessageIndex = responseErrorSource.indexOf("if (typeof data?.message === 'string'");
const rawErrorIndex = responseErrorSource.indexOf('if (data?.error) return data.error;');
assert.ok(localizedMessageIndex >= 0 && rawErrorIndex > localizedMessageIndex, '额度错误特殊处理后必须优先展示服务端本地化 message，而不是原始错误码');

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
assert.match(integrationFactsSource, /\(socialAccounts \?\? \[\]\)\.filter\([^\n]+=== 'connected'\)/, '社媒账号只可统计 connected 状态');
assert.match(integrationFactsSource, /\(youtubeAccounts \?\? \[\]\)\.filter\([^\n]+=== 'connected'\)/, 'YouTube 账号只可统计 connected 状态');
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
const presentConversationIndex = presentResponseSource.indexOf("setPanelView('chat')");
assert.ok(
  presentNotifyIndex >= 0
    && presentFocusIndex >= 0
    && presentConversationIndex >= 0,
  '用户主动操作的结果必须静默聚焦真实卡片，并留在概要气泡所在的对话页',
);
assert.doesNotMatch(presentResponseSource, /role: 'assistant', content: response\.card\.summary/, '用户操作结果不得降级成丢失动作和工作区链接的纯文本摘要');
assert.match(presentResponseSource, /if \(!shouldNotifyAssistant\(notificationReason\)\)[\s\S]*focusTaskCard\(agentId, stableTaskId\)[\s\S]*setPanelView\('chat'\)/, '常规成功结果必须保留为概要气泡且不触发强制详情跳转');
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
    && cardDecisionIndex < 0,
  '常规后台卡片不得抢焦点、切换界面或打断用户',
);

assert.match(source, /shouldNotifyAssistant\(detail\.reason \?\? 'routine'\)/, '一次性语音气泡也必须遵守通知策略');
const routinePerformanceIgnored = /if \(!shouldNotifyAssistant\(reason\)\)[\s\S]{0,160}(?:return|setPerformance\(null\))/.test(source);
assert.ok(routinePerformanceIgnored, '常规后台性能事件不得触发灵小枢提示');

assert.match(source, /dialogTaskCard\.secondaryActions\.map/, '外部决策弹窗必须渲染交互选择卡操作');
assert.match(source, /dialogTaskCard\.workspace\.href/, '外部弹窗中的完整结果必须可以进入工作区');
assert.match(source, /data-assistant-summary="task-card"[\s\S]{0,1100}openDecisionDialog\([\s\S]{0,120}kind: 'task'/, '任务结果必须先以概要气泡呈现，用户点击后才打开外部详情');
assert.match(source, /<AssistantComposer/, '灵小枢必须使用统一输入组件');
assert.match(composerSource, /rows=\{1\}/, '输入框必须默认只占一行');
assert.match(composerSource, /maxLength=\{4000\}/, '输入框必须遵守确定性操作接口的长度边界');
assert.match(composerSource, /max-h-\[88px\]/, '输入框最多只能扩展到三行');
assert.match(composerSource, /aria-label="给灵小枢发送消息"/, '输入文本框必须有独立的可访问名称');
assert.match(source, /Math\.min\(input\.scrollHeight, 88\)/, '输入框必须自动增高但不得超过三行');
const composerMarkupStart = composerSource.indexOf('<div data-assistant-composer="true"');
const composerMarkupEnd = composerSource.indexOf('{error &&', composerMarkupStart);
assert.ok(composerMarkupStart >= 0 && composerMarkupEnd > composerMarkupStart, '无法定位灵小枢输入区');
const composerMarkup = composerSource.slice(composerMarkupStart, composerMarkupEnd).replace(/\{files\.map\([\s\S]*?\}\)\}/, '');
assert.match(composerMarkup, /data-assistant-composer-surface="true"/, '输入区必须使用一体化圆角表面承接输入与操作');
assert.doesNotMatch(composerMarkup.split('\n', 1)[0], /border(?:-t)?\b|bg-surface-2/, '输入区外层不得保留生硬的分割线或灰底方框');
assert.match(composerSource, /ls-assistant-composer__input[^"]*outline-none/, '文本框必须移除浏览器默认矩形焦点框');
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface\s*\{[\s\S]{0,180}border:\s*0;[\s\S]{0,120}border-radius:/, '输入表面不得使用硬描边并必须保持充分圆角');
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface\s*\{[\s\S]{0,220}background:\s*var\(--color-surface\)/, '输入表面必须与面板共用白色表面，不能形成灰底方框');
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface:focus-within\s*\{[\s\S]{0,220}box-shadow:[\s\S]{0,140}var\(--color-accent\)/, '输入区必须以外层柔和光环反馈焦点');
assert.match(assistantStylesSource, /\.ls-assistant-composer__input:focus-visible[\s\S]{0,120}outline:\s*0\s*!important/, '点击或键盘聚焦文本框时不得重新出现方形 outline');
assert.match(assistantStylesSource, /@media \(forced-colors:\s*active\)[\s\S]*\.ls-assistant-composer__surface:focus-within[\s\S]{0,120}outline:\s*2px solid Highlight/, '高对比模式下仍必须保留清晰的可访问焦点提示');
assert.match(composerSource, /h-11 min-w-11[\s\S]{0,520}aria-label="添加附件"/, '附件操作必须保留至少 44px 的可访问触控目标');
assert.match(composerSource, /h-11 w-11[\s\S]{0,400}aria-label=\{uploading \? '正在上传附件' : '发送消息'\}/, '发送操作必须保留 44×44px 的可访问触控目标');

const attachmentSendSource = sourceSection('const sendComposerMessage = useCallback', 'const handleTaskCardAction', '附件发送流程');
assert.match(attachmentSendSource, /studioApi\.uploadMaterialFile/, '附件必须通过真实的我的素材上传接口持久化');
assert.match(attachmentSendSource, /if \(!result\.ok \|\| !result\.material\?\.id\)/, '没有真实素材编号时不得展示上传成功');
assert.match(attachmentSendSource, /uploadedAttachmentCacheRef\.current\.set/, '部分上传成功后必须缓存真实回执，重试不得重复上传');
assert.match(attachmentSendSource, /setAttachmentError/, '上传失败必须保留附件并明确提示');
assert.doesNotMatch(attachmentSendSource, /URL\.createObjectURL|data:/, '不得把本地 blob 或 data URL 伪装成持久化附件');
assert.match(sendSource, /uploadedAttachments\.length\s*\?\s*null\s*:\s*await executeAssistantAction/, '携带附件的消息不得猜测确定性操作参数');
assert.match(sendSource, /附件事实边界/, '对话模型必须获知附件只完成持久化、尚未证明已读取内容');

console.log('global assistant contract tests passed');
