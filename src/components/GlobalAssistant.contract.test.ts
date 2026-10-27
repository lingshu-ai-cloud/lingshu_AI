import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./GlobalAssistant.tsx', import.meta.url), 'utf8');
const sendHookSource = fs.readFileSync(new URL('./assistant/useAssistantSend.ts', import.meta.url), 'utf8');
const quickExecutionHookSource = fs.readFileSync(new URL('./assistant/useAssistantQuickExecution.tsx', import.meta.url), 'utf8');
const taskCardActionsHookSource = fs.readFileSync(new URL('./assistant/useAssistantTaskCardActions.ts', import.meta.url), 'utf8');
const decisionDialogHookSource = fs.readFileSync(new URL('./assistant/useAssistantDecisionDialog.ts', import.meta.url), 'utf8');
const panelControlsHookSource = fs.readFileSync(new URL('./assistant/useAssistantPanelControls.ts', import.meta.url), 'utf8');
const conversationPanelSource = fs.readFileSync(new URL('./assistant/AssistantConversationPanel.tsx', import.meta.url), 'utf8');
const chatStreamSource = fs.readFileSync(new URL('../lib/assistantChatStream.ts', import.meta.url), 'utf8');
const actionRequestSource = fs.readFileSync(new URL('../lib/assistantActionRequest.ts', import.meta.url), 'utf8');
const decisionDialogSource = fs.readFileSync(new URL('./assistant/AssistantDecisionDialog.tsx', import.meta.url), 'utf8');
const floatingRemindersSource = fs.readFileSync(new URL('./assistant/AssistantFloatingReminders.tsx', import.meta.url), 'utf8');
const launcherSource = fs.readFileSync(new URL('./assistant/AssistantLauncher.tsx', import.meta.url), 'utf8');
const weeklyPlanSource = fs.readFileSync(new URL('./assistant/AssistantWeeklyPlanExperience.tsx', import.meta.url), 'utf8');
const weeklyPlanHookSource = fs.readFileSync(new URL('./assistant/useAssistantWeeklyPlanExperience.ts', import.meta.url), 'utf8');
const decisionCenterSource = fs.readFileSync(new URL('./assistant/AssistantDecisionCenter.tsx', import.meta.url), 'utf8');
const decisionApiSource = fs.readFileSync(new URL('../lib/assistantDecisionApi.ts', import.meta.url), 'utf8');
const launcherRetractionSource = fs.readFileSync(new URL('./assistant/useAssistantLauncherRetraction.ts', import.meta.url), 'utf8');
const homeAnchorSource = fs.readFileSync(new URL('./assistant/useAssistantHomeAnchor.ts', import.meta.url), 'utf8');
const conversationBubblesSource = fs.readFileSync(new URL('./assistant/AssistantConversationBubbles.tsx', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('./assistant/globalAssistantRuntime.ts', import.meta.url), 'utf8');
const saveQueueSource = fs.readFileSync(new URL('./assistant/useAssistantThreadSaveQueue.ts', import.meta.url), 'utf8');
const actionProjectionSource = fs.readFileSync(new URL('./assistant/assistantActionProjection.ts', import.meta.url), 'utf8');
const productionIntakeSource = fs.readFileSync(new URL('./assistant/assistantProductionIntake.ts', import.meta.url), 'utf8');
const productionRequestSource = fs.readFileSync(new URL('./assistant/assistantProductionRequest.tsx', import.meta.url), 'utf8');
const featureGuidesSource = fs.readFileSync(new URL('./assistant/useAssistantFeatureGuides.ts', import.meta.url), 'utf8');
const notificationsSource = fs.readFileSync(new URL('./assistant/useAssistantNotifications.ts', import.meta.url), 'utf8');
const hydrationHookSource = fs.readFileSync(new URL('./assistant/useAssistantThreadHydration.ts', import.meta.url), 'utf8');
const pageSignalsSource = fs.readFileSync(new URL('./assistant/useAssistantPageSignals.ts', import.meta.url), 'utf8');
const chatPromptSource = fs.readFileSync(new URL('./assistant/assistantChatPrompt.ts', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const appModulesSource = fs.readFileSync(new URL('../appPageModules.tsx', import.meta.url), 'utf8');
const appShellChromeSource = fs.readFileSync(new URL('./AppShellChrome.tsx', import.meta.url), 'utf8');
const appPageSlotSource = fs.readFileSync(new URL('../AppPageSlot.tsx', import.meta.url), 'utf8');
const contentCreationOverviewSource = fs.readFileSync(new URL('./ContentCreationOverviewPage.tsx', import.meta.url), 'utf8');
const appBoundarySource = fs.readFileSync(new URL('./AppPageBoundary.tsx', import.meta.url), 'utf8');
const conversionPageSource = fs.readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');
const conversionDraftEffectsSource = fs.readFileSync(new URL('./customers/useConversionDraftEffects.ts', import.meta.url), 'utf8');
const trafficPageSource = fs.readFileSync(new URL('./TrafficWorkspacePage.tsx', import.meta.url), 'utf8');
const composerSource = fs.readFileSync(new URL('./assistant/AssistantComposer.tsx', import.meta.url), 'utf8');
const assistantStylesSource = fs.readFileSync(new URL('./assistant/assistantDecisionCenter.css', import.meta.url), 'utf8');
const conversationContextSource = fs.readFileSync(new URL('../lib/assistantConversationContext.ts', import.meta.url), 'utf8');
const assistantGuidesSource = fs.readFileSync(new URL('../lib/assistantGuides.ts', import.meta.url), 'utf8');
const globalStylesSource = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const layoutSource = fs.readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');

function sourceSection(startMarker: string, endMarker: string, label: string, target = source) {
  const start = target.indexOf(startMarker);
  const end = endMarker ? target.indexOf(endMarker, start + startMarker.length) : target.length;
  assert.ok(start >= 0 && end > start, `无法定位 ${label}`);
  return target.slice(start, end);
}

for (const surface of ['floating-reminder', 'conversation', 'decision']) {
  assert.match(`${source}\n${conversationPanelSource}\n${decisionDialogSource}\n${floatingRemindersSource}`, new RegExp(`data-assistant-surface=["']${surface}["']`), `缺少 ${surface} 助手形态`);
}
assert.doesNotMatch(source, /data-assistant-surface=["']quick-actions["']|SKILL_AGENTS/, '灵小枢不得再展示四助手快捷轮盘');
assert.equal(source.match(/data-global-assistant=["']root["']/g)?.length, 1, '页面只能渲染一个灵小枢根入口');
assert.match(source, /<AssistantConversationPanel[\s\S]*activeThread=\{activeThread\}[\s\S]*send=\{send\}[\s\S]*persistThread=\{persistThread\}/, '浮层必须把当前线程与发送、保存动作接入独立对话面板');

const launcherClickSource = sourceSection('const handleLauncherClick', '\n  useEffect(', '灵小枢点击处理', panelControlsHookSource);
const launcherMarkup = sourceSection('ref={launcherButtonRef}', '</Button>', '灵小枢右下角入口', launcherSource);
const edgeLauncherMarkup = sourceSection('ref={edgeLauncherButtonRef}', 'title="展开灵小枢入口"', '灵小枢贴边入口', launcherSource);
const retractControlMarkup = sourceSection('data-global-assistant="retract-control"', 'title="收起灵小枢入口到右侧"', '灵小枢收起控件', launcherSource);
const assistantRootMarkup = sourceSection('data-global-assistant="root"', '<AssistantConversationPanel', '灵小枢根定位容器');
assert.match(launcherClickSource, /openCurrentPageAgent\(\)/, '主入口点击灵小枢必须直接进入当前工作对话');
assert.doesNotMatch(launcherClickSource, /setMode\('expanded'\)|quick-actions|SKILL_AGENTS/, '点击灵小枢不得打开四助手快捷轮盘');
assert.match(assistantRootMarkup, /fixed/, '灵小枢完整入口必须使用固定定位');
assert.match(assistantRootMarkup, /z-\[75\]/, '灵小枢完整入口必须保持在页面操作层之上');
assert.match(assistantRootMarkup, /bottom-\[calc\(env\(safe-area-inset-bottom\)\+1rem\)\]/, '灵小枢完整入口必须避让设备安全区');
assert.match(assistantRootMarkup, /launcherRetracted && mode === 'breathing'[\s\S]*right-0 md:right-0[\s\S]*right-4 md:right-5/, '灵小枢收起后必须贴右边，展开时恢复页面内边距');
assert.match(assistantRootMarkup, /bottom-\[calc\(env\(safe-area-inset-bottom\)\+1rem\)\][\s\S]*md:bottom-5/, '灵小枢入口必须使用统一安全区基准，桌面端不得留下大块底部空白');
assert.doesNotMatch(assistantRootMarkup, /5\.5rem/, '制作页不得通过额外抬高灵小枢入口制造底部空白');
assert.match(conversationPanelSource, /assistantUsesMobileClearance[\s\S]{0,240}viewport\.height - \(assistantUsesMobileClearance \? 160 : 96\)/, '移动端抬高入口时必须同步收紧对话高度，不能把面板顶部裁掉');
assert.match(launcherSource, /const closedLabel = weeklyPlanOperating \? '周计划正在运营中' : '周计划待生成'/, '右下角入口必须根据真实周运行状态给出明确文案');
assert.match(weeklyPlanHookSource, /digitalEmployeeApi\.createGoal\(defaultWeeklyGoal\(next\.config\)\.draft\)/, '提示词必须复用真实周计划生成接口');
assert.match(weeklyPlanHookSource, /请先点击上方『让灵小枢认识我』完成基础资料/, '缺少初始资料时必须直接告知用户可操作的页面入口');
assert.match(weeklyPlanSource, /确认周计划/, '完整周计划弹窗必须只显示直接的计划确认动作');
assert.doesNotMatch(weeklyPlanSource, /Checkbox|generationAuthorized|确认授权/, '周计划弹窗不得增加独立授权复选框或授权按钮');
assert.match(weeklyPlanHookSource, /confirmedWeeklyExecution/, '启动成功必须由真实运行与任务回执确认');
assert.match(weeklyPlanHookSource, /approveGoal\(current\.goal\.id, current\.plan\.businessPackage\.revision, true\)/, '周计划确认必须发送显式生成授权');
assert.match(decisionCenterSource, /contentGenerationAuthorized: action\.id === 'approve_and_start'/, '助手待办点击计划确认动作时必须自动记录生成授权');
assert.doesNotMatch(decisionCenterSource, /授权数字员工开始生成内容|确认授权并开始/, '助手待办不得增加独立生成授权确认');
assert.match(decisionApiSource, /contentGenerationAuthorized[\s\S]*newContentGenerationAuthorization/, '助手待办接口必须发送显式生成授权合同');
assert.match(weeklyPlanSource, /assistant-weekly-plan-celebration/, '确认成功后必须提供有限时长的庆祝与收束反馈');
assert.match(launcherMarkup, /shape="round"/, '灵小枢入口必须采用紧凑胶囊形态');
assert.match(launcherMarkup, /!h-11/, '灵小枢入口必须保留 44px 触控高度');
assert.match(launcherSource, /aria-expanded=\{chatOpen\}[\s\S]{0,80}aria-controls="global-assistant-panel"/, '入口必须暴露弹窗展开关系');
assert.match(source, /<AssistantLauncher[\s\S]*chatOpen=\{mode === 'chat'\}[\s\S]*badgeCount=\{decisionTotal \?\? pendingCount\}/, '入口必须接收对话状态与权威待办数量');
assert.match(launcherMarkup, /aria-haspopup="dialog"/, '灵小枢入口必须声明它会打开对话浮层');
assert.match(launcherMarkup, /var\(--ls-action-gradient\)/, '灵小枢入口图标必须复用全局主操作渐变 Token');
assert.match(retractControlMarkup, /aria-label="收起灵小枢入口到右侧"[\s\S]*onClick=\{onRetract\}[\s\S]*!h-11 !w-11/, '必须提供独立、可键盘操作的 44px 收起控件');
assert.match(edgeLauncherMarkup, /shape="circle"[\s\S]*data-global-assistant="edge-launcher"[\s\S]*aria-label="展开灵小枢入口"[\s\S]*onClick=\{onRestore\}[\s\S]*!h-11 !w-11[\s\S]*!rounded-l-full !rounded-r-none/, '收起后必须保留贴右边的 44px 恢复入口');
assert.match(launcherSource, /if \(retracted && !chatOpen\)[\s\S]{0,100}<Badge count=\{badgeCount\}/, '贴边入口必须继续显示权威待办 Badge');
assert.match(launcherRetractionSource, /ASSISTANT_LAUNCHER_RETRACTED_KEY[\s\S]*localStorage\.getItem\(ASSISTANT_LAUNCHER_RETRACTED_KEY\)[\s\S]*localStorage\.setItem\(ASSISTANT_LAUNCHER_RETRACTED_KEY, String\(retracted\)\)/, '用户手动收起偏好必须跨刷新保存');
assert.match(launcherRetractionSource, /const retractLauncher[\s\S]{0,260}edgeLauncherButtonRef\.current\?\.focus\(\)/, '收起后焦点必须交给贴边恢复入口');
assert.match(launcherRetractionSource, /const restoreLauncher[\s\S]{0,260}launcherButtonRef\.current\?\.focus\(\)/, '恢复后焦点必须交回完整入口');
assert.match(source, /<AssistantFloatingReminders[\s\S]*launcherRetracted=\{launcherRetracted\}/, '提示气泡必须接收当前入口收起状态');
assert.match(floatingRemindersSource, /const canShow = !launcherRetracted && mode === 'breathing'/, '收起态不得显示任何横向提示气泡');
assert.match(floatingRemindersSource, /canShow && hasPerformancePriority && performance[\s\S]*canShow && !hasPerformancePriority && speechBubble[\s\S]*weeklyPlanKickoffAvailable[\s\S]*featureGuide/, '等待、短消息、周计划和引导提示优先级必须保留');
assert.doesNotMatch(source, /handlePointerDown|ASSISTANT_POSITION_KEY/, '右下角入口不得恢复拖动、旧坐标或自动缩边交互');
assert.match(launcherMarkup, /!bg-surface[\s\S]*active:!bg-surface[\s\S]*focus-visible:!bg-surface/, '灵小枢入口在点击和聚焦时必须保持与日夜主题一致的不透明表面');
assert.match(edgeLauncherMarkup, /!bg-surface[\s\S]*active:!bg-surface[\s\S]*focus-visible:!bg-surface/, '灵小枢贴边入口也必须使用日夜主题表面');
assert.doesNotMatch(launcherMarkup + edgeLauncherMarkup, /!bg-white/, '夜间模式的灵小枢入口不得强制纯白');
assert.doesNotMatch(globalStylesSource, /data-lingshu-assistant-clearance="bottom-navigation"/, '灵小枢入口不得依赖已经失效的旧底部导航标记');
assert.match(conversationPanelSource, /id="global-assistant-panel"[\s\S]{0,720}bottom-14 right-0/, '灵小枢弹窗必须锚定在右下角入口上方');
assert.match(conversationPanelSource, /max-h-\[calc\(100dvh-env\(safe-area-inset-bottom\)-96px\)\]/, '灵小枢弹窗高度必须避让移动设备底部安全区');
assert.match(conversationPanelSource, /role="dialog"[\s\S]{0,160}aria-modal="false"[\s\S]{0,160}aria-labelledby="global-assistant-panel-title"[\s\S]{0,160}aria-describedby="global-assistant-panel-description"/, '灵小枢必须以有名称和说明的非模态对话浮层呈现');
assert.match(source, /mode !== 'chat'\) return;[\s\S]{0,300}panel\?\.focus\(\{ preventScroll: true \}\)/, '打开弹窗后必须在不滚动页面的前提下把焦点移入对话区域');
assert.match(source, /appMain\?\.scrollTop[\s\S]{0,80}appMain\.scrollTop = 0/, '打开助手时必须修正历史滚动偏移，避免页面底部出现空白');
assert.match(layoutSource, /<main className="app-main[^\n]*overflow-clip"/, '应用主容器不得成为可被焦点程序滚动的隐藏滚动容器');
assert.match(panelControlsHookSource, /setMode\('breathing'\);\s*window\.requestAnimationFrame\(\(\) => \{\s*if \(launcherRetracted\) edgeLauncherButtonRef\.current\?\.focus\(\);\s*else launcherButtonRef\.current\?\.focus\(\)/, '关闭弹窗后必须按用户偏好把焦点归还完整或贴边入口');
assert.match(appSource, /<AppShellChrome/);
assert.match(appShellChromeSource, /<GlobalAssistant[\s\S]{0,650}compactMode=\{starterMode \|\| isAgentProductionSession\(\)\}/, '制作会话保留紧凑的灵小枢审批和聊天入口');
assert.match(appModulesSource, /const loadGlobalAssistant = \(\) => retryDynamicModule\([\s\S]{0,160}import\('\.\/components\/GlobalAssistant'\)[\s\S]{0,160}import\('\.\/components\/GlobalAssistant\?recovery'\)/, '灵小枢异步模块必须用不同模块 URL 自动重试一次，避免复用浏览器缓存的失败结果');
assert.match(appShellChromeSource, /<OptionalFeatureErrorBoundary[\s\S]{0,260}<Suspense fallback=\{null\}>[\s\S]{0,120}<GlobalAssistant/, '灵小枢必须有独立错误边界，加载失败不得拖垮主页面');
assert.match(appBoundarySource, /class OptionalFeatureErrorBoundary[\s\S]*重新加载\{this\.props\.label\}/, '可选外壳能力失败时必须保留主页面并提供恢复入口');
assert.match(source, /useState<AssistantPanelView>\('chat'\)/, '灵小枢默认页必须是单列对话');
assert.match(source, /openAgent\(currentPageAgent, 'chat'\)/, '入口必须直接打开单列对话而不是强制进入审批详情');
assert.doesNotMatch(source, /aria-label="灵小枢工作视图"/, '单列对话不得保留待办与聊天页签');
assert.match(decisionDialogHookSource, /const \[decisionDialog,\s*setDecisionDialog\]/, '外部决策弹窗必须使用独立状态，不得复用助手内部分页');
const taskSummarySource = sourceSection(
  'data-assistant-bubble="task-summary"',
  'data-assistant-bubble="weekly-plan-kickoff"',
  '普通任务概要气泡',
  conversationBubblesSource,
);
assert.match(taskSummarySource, /onClick=\{event => onOpenTaskDetail\(/, '普通任务概要必须交给外部决策弹窗回调');
assert.match(conversationPanelSource, /onOpenTaskDetail=\{[\s\S]*openDecisionDialog\(\{ kind: 'task', taskId \}, trigger\)/, '普通任务概要必须打开统一外部决策弹窗');
assert.doesNotMatch(taskSummarySource, /setPanelView\('decision'\)/, '普通任务详情不得再渲染在助手内部');
const decisionFeedSummarySource = sourceSection(
  'data-assistant-summary="decision-feed"',
  'variant="summary"',
  '权威待办概要气泡',
  conversationBubblesSource,
);
assert.match(decisionFeedSummarySource, /onOpenDetail=\{onOpenFeedDetail\}/, '权威待办概要必须通过外部详情回调打开');
assert.match(conversationPanelSource, /onOpenFeedDetail=\{trigger => openDecisionDialog\(\{ kind: 'feed' \}, trigger\)\}/, '权威待办概要必须打开统一外部决策弹窗');
assert.doesNotMatch(decisionFeedSummarySource, /setPanelView\('approvals'\)/, '权威待办详情不得再渲染在助手内部');
assert.match(conversationPanelSource, /<AssistantConversationBubbles[\s\S]*goalId=\{pageContext\.goalId\}/, '权威待办概要必须读取当前数字员工周目标，而不是默认最新目标');
assert.ok(
  conversationBubblesSource.indexOf('data-assistant-summary="decision-feed"') < conversationBubblesSource.indexOf('{messages.map'),
  '权威待办概要必须固定在历史对话消息之前',
);
assert.match(source, /executeAssistantAction\(/, '确定性操作必须走独立动作请求适配层');
assert.match(actionRequestSource, /withAssistantIdleTimeout\(fetch\([\s\S]*signal: controller\.signal[\s\S]*options\?\.timeoutMs \?\? 20_000/, '操作路由必须有客户端超时，不能永久保持思考中');
assert.match(chatStreamSource, /function withAssistantTimeout<T>[\s\S]*reject\(new AssistantRequestTimeoutError/, '超时必须由 Promise 竞速确定性结束，不能只依赖代理响应 abort');
assert.match(chatStreamSource, /ASSISTANT_CHAT_RESPONSE_TIMEOUT_MS = 20_000[\s\S]*ASSISTANT_CHAT_STREAM_IDLE_TIMEOUT_MS = 30_000[\s\S]*onTimeout\(\); controller\.abort\(\)/, '模型首响应和流式空闲超时必须中止连接');
assert.match(sendHookSource, /await streamAssistantReply\([\s\S]*onTimeout: \(\) => \{ chatTimedOut = true; \}[\s\S]*finally \{[\s\S]{0,160}setLoading\(false\)/, '模型超时后必须退出思考状态');
assert.match(source, /ASSISTANT_UI_WATCHDOG_TIMEOUT_MS = 25_000[\s\S]*if \(!loading\) return;[\s\S]*setLoading\(false\)[\s\S]*本次连接在 25 秒内没有返回/, '独立 UI 看门狗必须在网络 Promise 不回调时结束思考状态并解释原因');
assert.match(source, /if \(!fence\.active \|\| fence\.scopeKey !== persistenceScopeKey\)[\s\S]{0,180}persistenceFenceRef\.current = fence/, 'StrictMode 二次 effect setup 必须恢复当前用户作用域的活动栅栏');
assert.match(sendHookSource, /const currentInstance = \(\) => \([\s\S]*persistenceFenceRef\.current === requestFence[\s\S]*const currentScope = currentInstance/, '同一租户用户的令牌轮换不得丢弃回答，身份范围变化仍必须使实例栅栏失效');
assert.match(sendHookSource, /finally \{[\s\S]{0,220}setLoading\(false\)/, '请求作用域变化、断线或异常退出时也必须无条件结束当前组件的思考状态');

const assistantPanelSource = sourceSection(
  'id="global-assistant-panel"',
  '</motion.section>',
  '灵小枢对话面板',
  conversationPanelSource,
);
assert.doesNotMatch(assistantPanelSource, /variant="detail"|data-assistant-page="decision-detail"|focusedTaskCard\.details\.map/, '助手面板内不得渲染任何决策详情');
assert.match(source, /<AssistantDecisionDialog[\s\S]*goalId=\{pageContext\.goalId\}[\s\S]*closeDecisionDialog=\{closeDecisionDialog\}/, '页面必须把当前周目标和关闭流程传给独立决策弹窗');
const externalDecisionDialogSource = sourceSection(
  '<Modal',
  '</Modal>',
  '外部决策弹窗',
  decisionDialogSource,
);
assert.match(externalDecisionDialogSource, /data-global-assistant="decision-dialog"/, '外部决策弹窗必须有稳定语义标记');
assert.match(externalDecisionDialogSource, /open=\{Boolean\(decisionDialog\)\}/, '外部 Modal 只能由独立决策弹窗状态控制');
assert.match(externalDecisionDialogSource, /onCancel=\{closeDecisionDialog\}/, '关闭外部 Modal 必须走统一关闭流程');
assert.match(externalDecisionDialogSource, /decisionDialog\?\.kind === 'feed'[\s\S]*variant="detail"/, '权威待办详情必须在外部 Modal 重新读取');
assert.match(externalDecisionDialogSource, /goalId=\{goalId\}/, '权威待办详情必须使用页面传入的当前周目标');
assert.match(externalDecisionDialogSource, /decisionDialog\?\.kind === 'task'[\s\S]*dialogTaskCard/, '普通任务详情必须使用同一外部 Modal');
assert.doesNotMatch(externalDecisionDialogSource, /getContainer=\{false\}/, '外部 Modal 不得被挂载回灵小枢面板内');
const closeExternalDecisionDialogSource = sourceSection(
  'const closeDecisionDialog',
  'const handleDecisionActionResult',
  '关闭外部决策弹窗',
  decisionDialogHookSource,
);
assert.match(closeExternalDecisionDialogSource, /setDecisionDialog\(null\)/, '关闭详情只清理外部弹窗状态');
assert.doesNotMatch(closeExternalDecisionDialogSource, /setMode\(|setMessages\(|setDraftInput\(|closeAssistant\(/, '关闭详情必须保留对话、草稿、附件与助手开启状态');
assert.match(closeExternalDecisionDialogSource, /setDecisionFeedRevision\(revision => revision \+ 1\)/, '关闭外部详情后必须重新读取概要权威状态');
assert.match(closeExternalDecisionDialogSource, /closeDecisionDialogForNavigation[\s\S]{0,360}decisionDialogRestoreFocusRef\.current = false;[\s\S]{0,120}setDecisionDialog\(null\)/, '深链导航必须先关闭外部弹窗并禁止把焦点送回旧页面');
const restoreExternalDecisionDialogFocusSource = sourceSection(
  'const restoreDecisionDialogFocus',
  '  return {',
  '外部决策弹窗焦点恢复',
  decisionDialogHookSource,
);
assert.match(restoreExternalDecisionDialogFocusSource, /originalTrigger\?\.isConnected[\s\S]*querySelector<HTMLButtonElement>/, '概要刷新替换触发器后仍必须恢复到当前语义按钮');
assert.match(restoreExternalDecisionDialogFocusSource, /const shouldRestoreFocus = decisionDialogRestoreFocusRef\.current[\s\S]{0,300}if \(!shouldRestoreFocus\) return;\s*window\.requestAnimationFrame/, '导航关闭后不得由 afterClose 抢回新页面焦点');
assert.match(externalDecisionDialogSource, /afterClose=\{restoreDecisionDialogFocus\}/, 'Modal 关闭完成后必须统一恢复焦点');
assert.match(externalDecisionDialogSource, /focusTriggerAfterClose=\{false\}/, '必须关闭 Ant 自带焦点回送，避免导航后抢回旧页面焦点');
assert.match(externalDecisionDialogSource, /onNavigate=\{closeDecisionDialogForNavigation\}/, '权威待办深链必须通过显式回调关闭外部弹窗');
assert.match(externalDecisionDialogSource, /onActionResult=\{handleDecisionActionResult\}/, '权威待办动作结果必须回到对话壳形成一次性结果反馈');
assert.match(source, /useAssistantFeatureGuides\(\{ page, compactMode, mode \}\)/, '浮层必须将功能引导生命周期交给独立 hook');
assert.match(featureGuidesSource, /GUIDE_COOLDOWN_MS = 45_000[\s\S]*GUIDE_VISIBLE_MS = 6_000[\s\S]*seenGuideIdsRef[\s\S]*setFeatureGuide/, '功能引导应保留冷却、去重和显示时限');
assert.match(featureGuidesSource, /document\.addEventListener\('pointerover'[\s\S]*document\.removeEventListener\('pointerover'/, '功能引导的事件监听必须配对清理');
assert.match(externalDecisionDialogSource, /href=\{dialogTaskCard\.workspace\.href\}[\s\S]{0,120}onClick=\{\(\) => closeDecisionDialogForNavigation\(\)\}/, '普通任务工作区链接也必须在导航前关闭外部弹窗');
assert.match(appShellChromeSource, /suppressForRightSidebar=\{page !== 'digitalEmployees' && \(/, '智能经营页必须保留入口，其他页仍遵守右侧栏避让规则');
assert.match(conversationPanelSource, /width: inlineHomeBounds\?\.width \?\? assistantPanelWidth,\s*maxWidth: inlineHomeBounds \? '100%' : 'calc\(100vw - 32px\)'/, '首页面板使用锚点尺寸，其余页面继续受视口宽度约束');
assert.match(source, /inlineHomeAnchor \? createPortal\(assistantRoot, inlineHomeAnchor\) : assistantRoot/, '首页助手必须挂载在内容节点中随页面原生滚动');
assert.match(source, /!inlineHome && <AssistantLauncher/, '首页只有创作输入区，不叠加全局浮动入口');
assert.match(homeAnchorSource, /ASSISTANT_HOME_PROMPT_EVENT = 'lingshu:assistant-home-prompt'[\s\S]*useAssistantHomeInteraction[\s\S]*const draft = mergeAssistantHomePrompt[\s\S]*setDraftInput\(agent, draft\)/, '首页快捷建议必须写入原助手草稿');
assert.match(source, /pendingHomeSubmissionRef = useRef<AssistantHomePendingSubmission \| null>/, '结构化查询条件必须等待用户显式发送');
assert.match(source, /useAssistantHomeInteraction\([\s\S]{0,300}setPendingHomeSubmission\)/, '首页草稿须保留待提交的结构化条件');
assert.match(conversationPanelSource, /<AssistantComposer variant=\{inlineHome \? 'home' : 'default'\}/, '首页沿用同一聊天与上传契约，仅切换输入区外观');
assert.match(conversationPanelSource, /ls-assistant-panel__header[^"\n]*bg-surface/, '助手标题栏统一使用主题表面');
assert.doesNotMatch(conversationPanelSource, /bg-gradient-to-r from-blue-50 via-violet-50 to-pink-50/, '夜间模式不得保留浅色专用标题条');
assert.match(conversationPanelSource, /assistantTool === 'knowledge-intake' \? 560 : 420/, '灵小枢对话面板必须保持 420px 基准宽度，外部详情不得挤压对话宽度');

const closedDecisionCountSource = sourceSection(
  "if (mode === 'chat' || suppressForRightSidebar) return;",
  '  }, [mode, page, goalId,',
  '灵小枢关闭时的待办数量刷新',
  pageSignalsSource,
);
assert.match(source, /useAssistantDecisionCount\(\{ mode, page, goalId: pageContext\.goalId,/, '页面必须传入当前周目标给关闭态待办数量刷新');
assert.match(closedDecisionCountSource, /assistantDecisionApi\.feed\(\{[\s\S]{0,180}goalId,/, '关闭助手时仍必须按当前周目标轻量读取真实待办数量');
assert.match(closedDecisionCountSource, /setInterval\(refreshDecisionCount, 30_000\)/, '关闭态数量刷新必须低频轮询，不能充当运行监控台');
assert.doesNotMatch(closedDecisionCountSource, /events|executionLog|providerLog|console\./, '关闭态刷新不得读取或展示执行日志');

const liveContextSource = sourceSection(
  'const detail = (event as CustomEvent<Partial<AssistantContext>>).detail;',
  '  }, [page, setLiveContext]);',
  '灵小枢页面对象上下文',
  pageSignalsSource,
);
assert.match(source, /useAssistantPageContextSignal\(page, setLiveContext\)/, '页面必须接入上下文来源过滤 hook');
assert.match(liveContextSource, /const sourcePage = contextIdentifier\(detail\.sourcePage, 80\);[\s\S]{0,100}if \(!sourcePage \|\| sourcePage !== pageKey\(page\)\) return;/, '所有页面上下文事件都必须显式标记来源页面');
assert.doesNotMatch(liveContextSource, /contextIdentifier\(detail\.sourcePage, 80\) \?\? pageKey\(page\)/, '缺失 sourcePage 的事件不得默认归属当前页');
assert.match(conversionPageSource, /useConversionDraftEffects\(/, '客户转化页必须接入上下文副作用');
assert.match(conversionDraftEffectsSource, /agent: 'conversion',[\s\S]{0,80}sourcePage: 'conversion'/, '客户转化页必须绑定自己的页面来源');
assert.match(trafficPageSource, /agent: 'traffic',[\s\S]{0,80}sourcePage,/, '社媒共享页必须发送由路由传入的准确页面来源');
for (const [key, sourcePage] of [['legacy-traffic', 'traffic'], ['smart-assets-', 'smartAssets'], ['social-monitoring-accounts', 'socialMonitoring']]) {
  assert.match(appPageSlotSource, new RegExp(`key=[^\\n]*${key}[\\s\\S]{0,160}sourcePage=["']${sourcePage}["']`), `${key} 必须标记准确的助手上下文来源`);
}
assert.match(appPageSlotSource, /page === 'socialInspiration'[\s\S]{0,300}<ContentCreationOverviewPage/, '内容创作页必须使用独立经营式工作区');
assert.match(contentCreationOverviewSource, /<CreationPlan[^\n]*onCreate=\{\(\)=>setCreateOpen\(true\)\}/, '内容创作计划入口必须打开创建表单');
assert.match(contentCreationOverviewSource, /<CreateContentPlanModal open=\{createOpen\}[\s\S]{0,350}productionPortalNavigation\(taskId\)/, '创建表单完成后必须导航到真实任务门户');
for (const reference of ['goalId', 'planId', 'runId', 'taskId', 'contentId', 'viewKey']) {
  assert.match(liveContextSource, new RegExp(`${reference}: contextIdentifier\\(detail\\.${reference}`), `页面上下文必须安全绑定 ${reference}`);
}
assert.match(liveContextSource, /workflowStage: detail\.workflowStage/, '灵小枢必须接收当前周计划阶段，不能只依赖已有待办');
assert.match(chatPromptSource, /assistantBusinessObjectContext\(context\)/, '问答请求必须携带当前选中的业务对象边界');
assert.match(source, /liveContext\?\.sourcePage === normalizedPage/, '切换页面后不得继续使用上一页的任务上下文');
assert.match(source, /workflowStage === 'unplanned'/, '灵小枢必须识别尚未制定周计划的真实空白状态');
assert.match(floatingRemindersSource, /data-lingshu-weekly-plan-prompt="true"[\s\S]{0,900}先制定本周计划[\s\S]{0,500}制定周计划/, '关闭态灵小枢必须主动说明先预览计划再生产');
assert.match(conversationBubblesSource, /data-assistant-bubble="weekly-plan-kickoff"[\s\S]{0,900}确认后，数字员工才会开始生产[\s\S]{0,500}制定周计划/, '打开灵小枢后必须提供同一条计划制定入口');
assert.match(source, /openWeeklyPlanFromAssistant[\s\S]{0,300}lingshu:open-weekly-plan[\s\S]{0,120}source: 'assistant'/, '灵小枢计划按钮必须派发明确来源的页面动作');
assert.doesNotMatch(source, /productionSuggestions|data-assistant-surface="production-suggestions"|aria-label="生产快捷问题"/, '不得在页面快捷入口上方重复渲染生产快捷问题');
const pageQuickEntrySource = sourceSection(
  '<AssistantQuickEntries',
  '<AssistantComposer',
  '输入框上方的页面快捷入口',
  conversationPanelSource,
);
assert.match(pageQuickEntrySource, /page=\{page\}/, '移除重复生产问题后仍须保留当前页面快捷入口');
assert.match(pageQuickEntrySource, /onQuestion=\{entry => void send\(entry\.prompt, currentPageAgent\)\}/, '页面快捷问题仍须进入当前业务上下文');

const decisionActionResultSource = sourceSection(
  'const handleDecisionActionResult',
  'const restoreDecisionDialogFocus',
  '周任务结果气泡',
  decisionDialogHookSource,
);
assert.match(decisionActionResultSource, /execution\.goalId !== result\.card\.subject\.id/, '结果气泡只能接受与当前周目标相符的真实执行回执');
assert.match(decisionActionResultSource, /`\$\{execution\.runId\}:\$\{execution\.status\}`/, '结果必须按真实运行与状态去重');
assert.match(decisionActionResultSource, /handledDecisionResultsRef\.current\.has\(resultKey\)/, '普通重渲染不得重复插入结果气泡');
assert.match(decisionActionResultSource, /assistantDecisionExecutionFeedback\(execution\)/, '气泡文案必须按真实运行状态区分开始、等待、失败与完成');
assert.match(decisionActionResultSource, /setMessages\(PRIMARY_ASSISTANT_THREAD,[\s\S]{0,240}role: 'assistant'/, '已核验结果只追加一次普通助手气泡');
assert.match(decisionActionResultSource, /closeDecisionDialog\(\)[\s\S]{0,120}persistThread\(PRIMARY_ASSISTANT_THREAD\)/, '结果到达后关闭已处理详情并保存对话状态');

assert.match(runtimeSource, /const PRIMARY_ASSISTANT_THREAD:\s*OrbitAgentId\s*=\s*'business'/, '所有对话必须聚合到 business 主线程');
assert.match(source, /const \{ persistThread, waitForInFlightThreadSave \} = useAssistantThreadSaveQueue\(\{[\s\S]*stablePersistenceScope, persistenceFenceRef, assistantThreadSaveQueuesRef,[\s\S]*hydrateThread, setPersistenceMetadata/, '浮层必须连接同一作用域、身份栅栏和保存队列');
const persistThreadSource = sourceSection('const persistThread = useCallback', 'const waitForInFlightThreadSave', '助手线程持久化队列', saveQueueSource);
assert.match(persistThreadSource, /if \(queue\.running\) return/, '同一线程保存必须串行执行，不能并发全量覆盖');
assert.match(persistThreadSource, /expectedVersion/, '每次线程保存必须携带服务端版本前置条件');
assert.match(persistThreadSource, /response\.status === 409/, '版本冲突必须进入显式合并流程');
assert.match(persistThreadSource, /mergeAssistantThread\(remote, latestLocal\)/, '冲突恢复必须合并服务端状态与最新本地输入');
assert.match(runtimeSource, /messages:\s*local\.messages\.slice\(-MAX_PERSISTED_MESSAGES\)/, '版本冲突只能保留当前会话消息，不得把远端旧历史追加到最新回复后');
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
assert.match(runtimeSource, /if \(page === 'socialInspiration' \|\| page === 'scriptLibrary'\) return 'director'/, '页面仍需保留内部业务路由');
assert.match(runtimeSource, /if \(page === 'smartAssets'\) return 'content'/, '内容制作页仍需路由到内部内容能力');
assert.match(runtimeSource, /if \(page === 'conversion'[^\n]+return 'customer'/, '客户相关页面仍需路由到内部客户能力');

assert.match(conversationPanelSource, /scroller\.scrollHeight - scroller\.scrollTop - scroller\.clientHeight <= 24/, '必须识别用户是否仍在跟随最新消息');
assert.match(source, /!activeThread\.isFollowingLatest/, '用户浏览历史时不得强制滚动到底部');
assert.match(conversationPanelSource, /跳到最新消息|回到最新消息/, '浏览历史消息时必须提供回到最新消息的明确入口');
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
  '{messages.map',
  '欢迎语气泡',
  conversationBubblesSource,
);
assert.match(welcomeBubbleSource, /ls-assistant-bubble-enter/, '欢迎语必须作为普通可滚动气泡进入消息流');
assert.match(conversationBubblesSource, /welcomeBubbleVisible && !inlineHome && !messages\.length/, '线程恢复出任意消息后必须立即隐藏欢迎语，首页也不显示欢迎气泡');
assert.match(conversationPanelSource, /messages=\{activeThread\.messages\}/, '气泡必须使用当前已恢复的对话线程');
assert.doesNotMatch(welcomeBubbleSource, /\b(?:sticky|fixed|absolute)\b/, '欢迎语不得置顶、固定或脱离消息滚动流');

assert.match(runtimeSource, /function assistantBubbleStyle\(index: number\)[\s\S]*Math\.min\(Math\.max\(0, index\), 6\)[\s\S]*--assistant-bubble-delay': `\$\{boundedIndex \* 15\}ms`/, '气泡进入顺序必须使用 15ms 间隔并在第 6 项封顶');
for (const bubble of ['welcome', 'loading', 'task-summary', 'weekly-plan-kickoff', 'decision-summary']) {
  assert.match(conversationBubblesSource, new RegExp(`data-assistant-bubble=["']${bubble}["']`), `${bubble} 必须具有稳定的气泡语义标记`);
}
assert.match(conversationBubblesSource, /data-assistant-bubble=\{msg\.role\}[\s\S]{0,180}ls-assistant-bubble-enter|ls-assistant-bubble-enter[\s\S]{0,180}data-assistant-bubble=\{msg\.role\}/, '用户与助手消息必须使用统一气泡进入动效');
assert.match(conversationBubblesSource, /data-assistant-bubble="(?:task-summary|decision-summary)"[\s\S]{0,220}style=\{assistantBubbleStyle/, '概要气泡必须加入同一顺序索引');
assert.match(assistantStylesSource, /\.ls-assistant-bubble-enter\s*\{[\s\S]{0,220}animation:\s*ls-assistant-bubble-enter var\(--ls-motion-(?:fast|enter)\) var\(--ls-ease-enter\) both;[\s\S]{0,120}animation-delay:\s*var\(--assistant-bubble-delay, 0ms\)/, '普通气泡必须复用共享进入时长、缓动与有界顺序延迟');
assert.match(assistantStylesSource, /\.ls-assistant-summary-bubble-enter:has\([\s\S]{0,260}animation:\s*ls-assistant-bubble-enter var\(--ls-motion-(?:fast|enter)\) var\(--ls-ease-enter\) both;[\s\S]{0,140}animation-delay:\s*var\(--assistant-bubble-delay, 0ms\)/, '概要气泡外层必须复用同一进入动效和顺序延迟');
assert.match(assistantStylesSource, /\[data-assistant-bubble\] \.assistant-decision-summary\s*\{[\s\S]{0,80}animation:\s*none/, '概要卡位于气泡内时必须禁用自身动画，避免双重位移');
assert.match(assistantStylesSource, /@keyframes ls-assistant-bubble-enter\s*\{[\s\S]{0,160}opacity:\s*0;\s*transform:\s*translateY\((?:[1-8])px\)/, '气泡进入只能使用不超过 8px 的轻位移与透明度');
assert.match(assistantStylesSource, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ls-assistant-bubble-enter[\s\S]{0,180}animation:\s*none\s*!important/, '减少动态效果时必须立即显示全部气泡');

assert.match(conversationPanelSource, /关闭窗口（任务继续）/, '关闭窗口必须与暂停任务分离');
assert.match(decisionDialogSource, /暂停当前任务/, '必须提供独立的暂停操作');
assert.match(source, /assistantRunControl\(dialogTaskCard\)/, '外部任务详情的暂停按钮只能由可执行运行任务的后端目标决定');
assert.doesNotMatch(source, /objectId:\s*dialogTaskCard\.taskId/, '不得把展示卡片编号猜成可执行运行编号');
assert.match(taskCardActionsHookSource, /const accepted = response\.status === 'accepted' \|\| response\.status === 'completed'/, '只有后端确认后才能改变本地暂停状态');
assert.match(panelControlsHookSource, /persistThread\(activeAgent\)/, '关闭前必须保留任务、对话和草稿');

const sendSource = sendHookSource;
assert.match(sendSource, /const threadAgent = PRIMARY_ASSISTANT_THREAD/, '发送消息必须写入 business 主线程');
assert.match(productionIntakeSource, /function assistantProductionIntent[\s\S]*hasProductionVerb[\s\S]*hasProductionArtifact/, '明确的脚本、视频与分镜生产指令必须被识别为生产任务');
assert.match(sendHookSource, /import \{ assistantProductionIntent, assistantCreationPortal \} from '\.\/assistantProductionIntake'/, '助手必须调用企业产品准入模块');
assert.match(sendSource, /assistantProductionIntent\(visibleText\)[\s\S]*await runAssistantProductionRequest\(/, '生产指令必须交给真实任务执行链路');
assert.match(productionRequestSource, /resolveProduct\(productionIntent\.productQuery\)/, '生产指令必须解析真实企业产品');
assert.match(productionRequestSource, /createAtVersion[\s\S]*dueAt: null[\s\S]*mode: 'instant'/, '单条生产指令必须通过原子入口建立即时 ContentTask，不伪造周任务截止时间');
assert.match(productionRequestSource, /contentTaskCardToAssistantCard\(authoritativeCard\)[\s\S]*focusTaskCard\(threadAgent, assistantCard\.taskId\)/, '自然语言生产回执必须聚焦服务端权威任务卡');
assert.doesNotMatch(productionRequestSource, /agentTaskDemo: true/, '真实执行不得进入演示页面');
assert.match(productionRequestSource, /productId: productionProduct\.id[\s\S]*productRef: productionProduct\.label/, '周任务必须绑定企业中心的真实产品身份');
assert.match(sendSource, /assistantAtomicMutationRef\.current = true[\s\S]*await runAssistantProductionRequest[\s\S]*assistantAtomicMutationRef\.current = false/, '原子建任务期间必须暂停后台会话保存，避免抢占 CAS 版本');
assert.match(productionRequestSource, /await waitForInFlightThreadSave\(threadAgent\)[\s\S]*createAtVersion/, '原子建任务必须等待已经发出的会话 PUT 释放 CAS 后再开始 POST');
assert.match(productionRequestSource, /creationIdempotencyKey[\s\S]*idempotencyKey: creationIdempotencyKey/, '会话版本重试不得改变已开始业务任务的幂等身份');
assert.doesNotMatch(productionRequestSource, /lingshu:navigate|window\.location|page: 'smartAssets'/, '任务建立后应留在同一权威任务卡，不得强制跳离对话');
assert.ok(sendSource.indexOf('await runAssistantProductionRequest') < sendSource.indexOf('await streamAssistantReply'), '生产任务分流必须发生在千问文本生成请求之前');
assert.match(sendSource, /endpoint: API_PATH\[agentForOrbit\(routeAgent\)\]/, 'business 主线程聚合不得丢失当前页面的内部能力路由');
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
  /\{ deterministicActionId: signedFocusedMutationActionId \}/,
  '明确的自然语言确定性操作必须把动作意图传给操作请求错误处理',
);
assert.match(sendSource, /selectAssistantConversationContext\(mergeConsecutiveAssistant\(thread\.messages\)\)/, '长对话必须按完整轮次和预算选择上下文');
assert.match(chatPromptSource, /renderAssistantConversationBoundary\(conversationContext\)/, '被裁剪的较早对话必须向模型声明范围边界');
assert.match(sendSource, /strategyRequest \? '' : await loadLiveIntegrationFacts\(\)/, '经营主对话必须使用服务端核验事实而不是客户端汇总作为权威依据');
assert.match(chatPromptSource, /content: strategyRequest \? visibleText : \[/, '经营主对话不得把前端导航提示和策略规则重复塞入千问上下文');
assert.match(sendSource, /buildAssistantChatMessages\(\{[\s\S]*historyForApi, conversationContext, strategyRequest, visibleText, context/, '发送主流程必须使用独立的问答上下文组装模块');
assert.match(sendSource, /userQuestion: visibleText[\s\S]{0,700}retainedUserInstructions/, '经营主对话必须把当前问题、当前业务对象与有界历史约束交给服务端组装上下文');
assert.match(sendSource, /requestFence\.active[\s\S]{0,100}persistenceFenceRef\.current === requestFence/, '租户或用户范围切换后旧请求的异步响应必须被丢弃');
assert.match(actionProjectionSource, /function isWeeklyPlanKickoffRequest[\s\S]{0,500}开始\|启动\|制定\|生成\|创建[\s\S]{0,220}运营计划\|周计划\|计划\|周任务/, '空白周计划必须识别用户对灵小枢发出的明确开工或制定计划请求');
assert.match(source, /from '\.\/assistant\/assistantActionProjection'/, '助手页面必须接入独立的签名动作投影');
assert.match(sendSource, /isWeeklyPlanKickoffRequest\(draft\)[\s\S]{0,650}await prepareWeeklyPlan\(\)[\s\S]{0,400}role: 'assistant'/, '灵小枢收到明确请求时必须先生成文字概览与计划卡，不能绕过用户确认直接生产');
assert.match(sendSource, /sameAssistantRequestIdentity\(requestToken, getToken\(\), stablePersistenceScope\)/, '身份切换后丢弃旧响应，同身份令牌刷新不丢弃文字');

assert.doesNotMatch(source, /AssistantDecisionMemoryPanel|AssistantDecisionSaveButton|useAssistantDecisionMemory/, '对话记忆由后台维护，灵小枢首屏不得暴露记忆管理工具');
assert.match(conversationContextSource, /较早用户原话/, '历史用户约束必须保留原文且不得升级为已核验事实');

const responseErrorSource = sourceSection('async function responseErrorMessage', '', '助手请求错误提示', runtimeSource);
assert.match(responseErrorSource, /assistant_preview_real_queries_not_enabled[^\n]+未启用真实联网问答/, '本地预览未授权真实查询时必须说明原因，不能无响应');
const localizedMessageIndex = responseErrorSource.indexOf("if (typeof data?.message === 'string'");
const rawErrorIndex = responseErrorSource.indexOf('if (data?.error) return data.error;');
assert.ok(localizedMessageIndex >= 0 && rawErrorIndex > localizedMessageIndex, '额度错误特殊处理后必须优先展示服务端本地化 message，而不是原始错误码');

assert.match(source, /import \{ executeAssistantAction \} from '\.\.\/lib\/assistantActionRequest'/, '浮层必须使用独立的确定性操作请求适配层');
const actionExecutionSource = sourceSection('export async function executeAssistantAction', '\n}', '确定性操作请求', actionRequestSource);
assert.match(actionExecutionSource, /httpStatus === 409/, '冲突 HTTP 状态必须转换成过期操作卡');
assert.match(actionExecutionSource, /httpStatus === 422/, '缺输入 HTTP 状态必须转换成缺输入卡');
assert.match(actionExecutionSource, /if \(!response\.ok\) \{[\s\S]*return actionFailure/, '任何操作路由 HTTP 失败都必须展示失败或缺输入卡');
assert.match(actionExecutionSource, /missingInput \? 'missing_required_input' : 'failure'/, '缺输入和失败必须遵守对应通知规则');
assert.doesNotMatch(actionExecutionSource, /return null/, '路由错误或无效响应不得伪装成未处理并回落通用聊天');
assert.match(actionExecutionSource, /Only an explicit delegated\/not_handled/, '只有明确 delegated/not_handled 才允许回落通用聊天');

const naturalLanguageInputSource = sourceSection('function focusedNaturalLanguageActionInput', '\n}', '自然语言操作输入', actionProjectionSource);
const focusedMutationPatternsSource = sourceSection('const FOCUSED_MUTATION_PATTERNS', '\n];', '聚焦卡自然语言动作匹配', actionProjectionSource);
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

const integrationFactsSource = sourceSection('async function loadLiveIntegrationFacts', 'function mergeConsecutiveAssistant', '实时接入事实', runtimeSource);
assert.match(integrationFactsSource, /\(socialAccounts \?\? \[\]\)\.filter\([^\n]+=== 'connected'\)/, '社媒账号只可统计 connected 状态');
assert.match(integrationFactsSource, /\(youtubeAccounts \?\? \[\]\)\.filter\([^\n]+=== 'connected'\)/, 'YouTube 账号只可统计 connected 状态');
assert.match(integrationFactsSource, /\[\.\.\.connectedSocialAccounts, \.\.\.connectedYoutubeAccounts\]\.reduce/, '曝光汇总只能使用已接通账号');
assert.match(integrationFactsSource, /if \(connectedSocialAccounts\.length\)[^\n]+已接入社媒账号/, '社媒账号数量只能来自已接通账号');
assert.match(integrationFactsSource, /if \(connectedYoutubeAccounts\.length\)[^\n]+已接入 YouTube 账号/, 'YouTube 账号数量只能来自已接通账号');
assert.doesNotMatch(integrationFactsSource, /if \(socialAccounts\.length\)|if \(youtubeAccounts\.length\)|\[\.\.\.socialAccounts, \.\.\.youtubeAccounts\]/, '未接通账号不得混入数量或曝光统计');

const taskCardActionSource = sourceSection('const handleTaskCardAction', 'const toggleTaskPaused', '任务卡按钮操作', taskCardActionsHookSource);
assert.match(taskCardActionSource, /const parameters = action\.parameters/, '按钮操作必须读取后端签发的 action.parameters');
assert.match(taskCardActionSource, /\.\.\.\(parameters \? \{ parameters \} : \{\}\)/, '按钮操作必须把同一 parameters 对象原样转发到请求');

const hydrationSource = sourceSection(
  'useEffect(() => {',
  '  return assistantThreadHydrated;',
  '助手线程恢复流程',
  hydrationHookSource,
);
assert.match(source, /useAssistantThreadHydration\(\{[\s\S]*page, stablePersistenceScope, persistThread, hydrateThread,[\s\S]*executeAssistantAction, upsertTaskCard, focusTaskCard, requestId/, '浮层必须将当前租户的线程恢复与动作重签交给独立 hook');
assert.match(hydrationSource, /actionId:\s*'view_status'/, '恢复聚焦卡片时必须重新读取权威工作状态');
assert.match(hydrationSource, /executeAssistantAction\(PRIMARY_ASSISTANT_THREAD, request\)/, '刷新后必须由服务端重新签发可执行动作');
assert.match(hydrationSource, /return \(\) => \{ cancelled = true; \}/, '线程恢复必须取消旧请求并允许 StrictMode 重挂载重新读取');
assert.match(hydrationSource, /version:\s*Number\.isSafeInteger/, '恢复线程时必须同时恢复服务端 CAS 版本');
assert.match(hydrationSource, /storedJournal\.conversationKey \|\| 'business'\) === conversationKey/, '仅恢复同一会话的本地日志');
assert.match(hydrationSource, /readAssistantConversationKey\(stablePersistenceScope\)/, '活动会话必须按租户与用户隔离');
assert.match(hydrationSource, /conversationResetVersion: item\.conversationResetVersion/, '恢复时必须读取清空版本，防止旧日志复活');

const pageConversationResetSource = sourceSection(
  'const previousPage = conversationPageRef.current',
  'setLiveContext(null)',
  '跨页面会话重置',
);
assert.doesNotMatch(pageConversationResetSource, /resetTransientConversation\(\)|focusTaskCard\(PRIMARY_ASSISTANT_THREAD, null\)/, '页面切换不得暗中清空用户的会话或任务引用');

const transientConversationResetSource = sourceSection(
  'const resetTransientConversation = useCallback',
  'const openAgent = useCallback',
  '临时会话清空内容',
);
assert.match(transientConversationResetSource, /setMessages\(PRIMARY_ASSISTANT_THREAD, \[\]\)/, '清空临时会话必须清空消息');
assert.match(transientConversationResetSource, /setDraftInput\(PRIMARY_ASSISTANT_THREAD, ''\)/, '清空临时会话必须清空草稿');
assert.match(transientConversationResetSource, /setPendingAttachments\(\[\]\)/, '清空临时会话必须清空未发送附件');

const samePageConversationExpirySource = sourceSection(
  'const openCurrentPageAgent = useCallback',
  'const presentActionResponse',
  '同页关闭会话过期规则',
);
assert.doesNotMatch(samePageConversationExpirySource, /resetTransientConversation\(\)|ASSISTANT_CLOSED_CONVERSATION_TTL_MS/, '关闭重开不得自动过期，清空必须显式确认');
assert.match(source, /useAssistantConversationManagement\(\{/, '必须接入显式会话管理');
assert.match(conversationPanelSource, /conversationControls/, '首页及浮层应展示同一会话管理入口');
assert.match(panelControlsHookSource, /assistantClosedRef\.current = \{ page, at: Date\.now\(\) \}/, '关闭会话时必须记录当前页面和关闭时间');

const quickExecutionSource = sourceSection(
  'return useCallback(async function executeEntry',
  '\n}',
  '快捷执行入口',
  quickExecutionHookSource,
);
assert.match(quickExecutionSource, /if \(!confirmations\)/, '生产任务启动前必须确认');
assert.match(quickExecutionSource, /startAssistantAction\(entry\.taskId, entry\.expectedVersion, executionRequestId\)/, '确认完成后必须向真实任务提交对象版本和幂等键');
assert.match(quickExecutionSource, /upsertTaskCard\(PRIMARY_ASSISTANT_THREAD/, '真实执行回执必须投影为任务卡片');
assert.match(taskCardActionsHookSource, /destination\.origin === window\.location\.origin[\s\S]*socialContentTaskId: productionTaskId, socialContentPage: 'smartAssets', directStudio: true/, '生产回执链接必须原子恢复指定任务而非刷新成空制作页');
assert.match(conversationPanelSource, /<AssistantQuickEntries[\s\S]*onQuestion=\{entry => void send\(entry\.prompt, currentPageAgent\)\}[\s\S]*onExecute=\{entry => void runQuickExecution\(entry\)\}/, '输入框上方必须同时接通页面问答与快捷执行');
assert.match(hydrationSource, /threads\[PRIMARY_ASSISTANT_THREAD\]\s*!==\s*threadBeforeRequest/, '旧线程快照不得覆盖请求期间产生的本地输入');
assert.match(hydrationSource, /threads\[PRIMARY_ASSISTANT_THREAD\]\s*!==\s*hydratedThread/, '过期重签结果不得覆盖请求期间产生的新卡片或焦点');
assert.match(hydrationSource, /actionCardToTaskCard\(response\.card, response, CURRENT_STATUS_TASK_ID\)/, '重新签发的动作必须进入专用的权威状态卡');
assert.match(hydrationSource, /focusTaskCard\(PRIMARY_ASSISTANT_THREAD, CURRENT_STATUS_TASK_ID\)/, '恢复后只可聚焦最新权威状态卡');
assert.doesNotMatch(hydrationSource, /actionCardToTaskCard\(response\.card, response, persistedFocusedTaskId\)/, '不得把当前任意决策错误绑定到旧聚焦卡片');
assert.doesNotMatch(hydrationSource, /persistThread\(/, '重新签发的动作不得再次写回不可信线程快照');

const responseStatusSource = sourceSection('function taskStatusFromResponse', '\n}', '助手任务状态映射', actionProjectionSource);
assert.match(responseStatusSource, /signedRunControl/, '刷新后的运行状态必须来自服务端签发的运行控制');
assert.match(responseStatusSource, /resume_task[^]*return 'paused'/, '签发继续动作时卡片必须恢复为已暂停状态');
assert.match(responseStatusSource, /pause_task[^]*return 'running'/, '签发暂停动作时卡片必须恢复为执行中状态');

const responseIdentitySource = sourceSection('function actionResponseCardId', '\n}', '响应卡片身份规则', actionProjectionSource);
assert.match(responseIdentitySource, /request\.target\?\.objectId/, '同一业务对象的后续响应必须更新原卡片');
assert.match(responseIdentitySource, /responseTargets\.some\(target =>/, '响应动作目标与请求不一致时不得覆盖原对象卡片');
assert.match(responseIdentitySource, /target\.objectType !== requestObjectType/, '对象类型不一致也必须视为跨对象响应');
assert.match(responseIdentitySource, /if \(responseDisagreesWithRequest\) return response\.requestId \|\| request\.requestId/, '跨对象响应不得挂到任何旧对象卡片，必须建立独立响应卡');
assert.match(responseIdentitySource, /response\.requestId/, '没有业务对象的新响应必须用 requestId 建立独立卡片');
assert.match(responseIdentitySource, /matchingCardIds\.length === 1[\s\S]*response\.requestId \|\| request\.requestId/, '只有已存在的同一 objectId 才可更新原卡片，新对象必须以 requestId 建卡');
assert.doesNotMatch(responseIdentitySource, /:\s*objectId\s*;/, '新卡片不得直接用业务 objectId 代替 requestId');
assert.doesNotMatch(source, /`\$\{agentId\}:\$\{response\.actionId\}`/, '不得按 Agent 与动作名合并互不相关的新卡片');

const crossObjectFilterSource = sourceSection('function responseWithoutCrossObjectActions', '\n}', '跨对象动作过滤', actionProjectionSource);
assert.match(crossObjectFilterSource, /responseHasCrossObjectAction\(request, response\)/, '响应进入展示前必须识别跨对象动作');
assert.match(crossObjectFilterSource, /action\.target\.objectId\.trim\(\) === requestObjectId/, '只可保留当前请求对象的签名动作');
assert.match(crossObjectFilterSource, /secondaryActions:[\s\S]*\.filter\(safeAction\)/, '跨对象的次级动作也必须全部过滤');

const presentResponseSource = sourceSection('const presentActionResponse', 'const contentIntake = useContentTaskIntake', '操作结果展示');
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
const mutationActionsSource = sourceSection('const WORKFLOW_MUTATION_ACTIONS', ']);', '工作流 mutation 动作集合', runtimeSource);
assert.doesNotMatch(mutationActionsSource, /'view_status'/, 'view_status 不得被归类为 workflow mutation，避免状态回读递归');
assert.doesNotMatch(presentResponseSource, /actionCardToTaskCard\(statusResponse\.card, statusResponse, stableTaskId\)/, '新对象状态绝不能回填原 mutation 卡');

const cardEventEnd = notificationsSource.indexOf("window.addEventListener('lingshu-assistant-card'");
const cardEventStart = notificationsSource.lastIndexOf('useEffect(() => {', cardEventEnd);
assert.ok(cardEventStart >= 0 && cardEventEnd > cardEventStart, '无法定位任务卡事件处理');
const cardEventSource = notificationsSource.slice(cardEventStart, cardEventEnd);
const cardNotifyIndex = cardEventSource.indexOf('shouldNotifyAssistant(');
const cardFocusIndex = cardEventSource.indexOf('focusTaskCard(');
const cardDecisionIndex = cardEventSource.indexOf("setPanelView('decision')");
assert.ok(
  cardNotifyIndex >= 0
    && (cardFocusIndex < 0 || cardNotifyIndex < cardFocusIndex)
    && cardDecisionIndex < 0,
  '常规后台卡片不得抢焦点、切换界面或打断用户',
);

assert.match(notificationsSource, /shouldNotifyAssistant\(detail\.reason \?\? 'routine'\)/, '一次性语音气泡也必须遵守通知策略');
const routinePerformanceIgnored = /if \(!shouldNotifyAssistant\(reason\)\)[\s\S]{0,160}(?:return|setPerformance\(null\))/.test(notificationsSource);
assert.ok(routinePerformanceIgnored, '常规后台性能事件不得触发灵小枢提示');
assert.match(source, /useAssistantNotifications\(\{[\s\S]*mode, setMode, primaryEntry, compactMode, focusTaskCard, setUnreadCount, upsertTaskCard/, '浮层必须将通知事件生命周期交给独立 hook');

assert.match(decisionDialogSource, /dialogTaskCard\.secondaryActions\.map/, '外部决策弹窗必须渲染交互选择卡操作');
assert.match(decisionDialogSource, /dialogTaskCard\.workspace\.href/, '外部弹窗中的完整结果必须可以进入工作区');
assert.match(conversationBubblesSource, /data-assistant-summary="task-card"[\s\S]{0,1100}onOpenTaskDetail\(/, '任务结果必须先以概要气泡呈现');
assert.match(conversationPanelSource, /onOpenTaskDetail=\{[\s\S]*openDecisionDialog\(\{ kind: 'task', taskId \}, trigger\)/, '任务结果点击后才打开外部详情');
assert.match(conversationPanelSource, /<AssistantComposer/, '灵小枢必须使用统一输入组件');
assert.match(conversationPanelSource, /onSuggest=\{suggestion => \{[\s\S]{0,260}setDraftInput\(activeAgent, suggestion\)[\s\S]{0,260}assistantInputRef\.current\?\.focus\(\)/, '快捷回复卡片必须填入当前输入框并聚焦，不能自动发送');
assert.doesNotMatch(conversationPanelSource, /onSuggest=\{suggestion => void send\(/, '快捷回复卡片不得绕过输入框直接发送');
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
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface\s*\{[\s\S]{0,260}box-shadow:\s*0 0 0 2px var\(--color-accent\)/, '输入区未聚焦时也必须持久展示蓝色边框');
assert.doesNotMatch(composerMarkup.split('\n', 1)[0], /border(?:-t)?\b|bg-surface-2/, '输入区外层不得保留生硬的分割线或灰底方框');
assert.match(composerSource, /ls-assistant-composer__input[^"]*outline-none/, '文本框必须移除浏览器默认矩形焦点框');
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface\s*\{[\s\S]{0,180}border:\s*0;[\s\S]{0,120}border-radius:/, '输入表面不得使用硬描边并必须保持充分圆角');
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface\s*\{[\s\S]{0,220}background:\s*var\(--color-surface\)/, '输入表面必须与面板共用白色表面，不能形成灰底方框');
assert.match(assistantStylesSource, /\.ls-assistant-composer__surface:focus-within\s*\{[\s\S]{0,220}box-shadow:[\s\S]{0,140}var\(--color-accent\)/, '输入区必须以外层柔和光环反馈焦点');
assert.match(assistantStylesSource, /\.ls-assistant-composer__input:focus-visible[\s\S]{0,120}outline:\s*0\s*!important/, '点击或键盘聚焦文本框时不得重新出现方形 outline');
assert.match(assistantStylesSource, /@media \(forced-colors:\s*active\)[\s\S]*\.ls-assistant-composer__surface:focus-within[\s\S]{0,120}outline:\s*2px solid Highlight/, '高对比模式下仍必须保留清晰的可访问焦点提示');
assert.match(composerSource, /h-11 min-w-11[\s\S]{0,520}aria-label="添加附件"/, '附件操作必须保留至少 44px 的可访问触控目标');
assert.match(composerSource, /h-11 w-11[\s\S]{0,400}aria-label=\{uploading \? '正在上传附件' : '发送消息'\}/, '发送操作必须保留 44×44px 的可访问触控目标');

const attachmentSendSource = sourceSection('const sendComposerMessage = useCallback', 'return { send, sendComposerMessage }', '附件发送流程', sendHookSource);
assert.match(attachmentSendSource, /studioApi\.uploadMaterialFile/, '附件必须通过真实的我的素材上传接口持久化');
assert.match(attachmentSendSource, /if \(!result\.ok \|\| !result\.material\?\.id\)/, '没有真实素材编号时不得展示上传成功');
assert.match(attachmentSendSource, /uploadedAttachmentCacheRef\.current\.set/, '部分上传成功后必须缓存真实回执，重试不得重复上传');
assert.match(attachmentSendSource, /setAttachmentError/, '上传失败必须保留附件并明确提示');
assert.doesNotMatch(attachmentSendSource, /URL\.createObjectURL|data:/, '不得把本地 blob 或 data URL 伪装成持久化附件');
assert.match(sendSource, /const actionResponse = signedFocusedMutationActionId\s*\?\s*await executeAssistantAction/, '普通对话必须绕过确定性操作路由并直接进入模型');
assert.match(sendSource, /const signedFocusedMutationActionId = focusedActionInput \? focusedMutationActionId : undefined/, '只有绑定服务端任务卡与版本的明确操作才可进入确定性操作路由');
assert.match(chatPromptSource, /附件事实边界/, '对话模型必须获知附件只完成持久化、尚未证明已读取内容');

console.log('global assistant contract tests passed');
