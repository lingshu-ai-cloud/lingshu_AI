import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import { readStudioApplicationSources } from '../../tests/fixtures/studioApplicationSources.js';
import { readVideoApplicationSources } from '../../tests/fixtures/videoApplicationSources.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMarketingEvents } from '../../src/components/publishing/marketingCalendar.js';
import { canMoveCalendarPost } from '../../src/lib/calendarModel.js';
import { resolvePendingDrop } from '../../src/components/publishing/schedulePolicy.js';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const enterprise = read('server/routes/enterprise.ts');
const enterpriseKnowledge = read('server/routes/enterpriseKnowledge.ts');
const enterpriseAssets = read('server/routes/enterpriseAssetRoutes.ts');
assert.match(enterprise, /enterpriseRouter\.use\(requireAuth\)/, 'enterprise routes must require authentication');
assert.match(enterprise, /readTenantProfile\(tenantId\)/, 'enterprise profile reads must be tenant scoped');
assert.match(enterprise, /writeTenantProfile\(tenantId, profile, userId\)/, 'enterprise profile writes must be tenant scoped');
assert.match(enterprise, /enterpriseRouter\.patch\('\/profile'[\s\S]*?readTenantProfile\(tenantId\)[\s\S]*?mergeEnterpriseProfile/, 'diagnosis autosave must merge into the authenticated tenant profile');
assert.match(enterprise, /context: buildEnterpriseContext\(profile\)/, 'enterprise facts must use the guarded AI context builder');
assert.match(enterpriseKnowledge, /dataGovernance\?\.aiAccessEnabled === false/, 'AI context must honor enterprise data authorization');
assert.doesNotMatch(
  enterprise.slice(enterprise.indexOf("enterpriseRouter.get('/profile'"), enterprise.indexOf('export const productApiRouter')),
  /req\.query\.tenantId|x-tenant-id/,
  'authenticated enterprise UI routes must not accept a caller-selected tenant id',
);
assert.match(enterprise, /registerEnterpriseAssetRoutes\(enterpriseRouter\)/, 'enterprise routes must mount the tenant-scoped asset adapter');
assert.match(enterpriseAssets, /enterpriseAssetObjectKey\(tenantId, storedName\)/, 'enterprise asset uploads must include the authenticated tenant in their object key');
assert.match(enterpriseAssets, /enterpriseAssetObjectKey\(tenantId, file\)/, 'enterprise asset reads must derive the object key from the authenticated tenant');
assert.match(enterpriseAssets, /Compatibility path while the resumable migration/, 'enterprise assets must retain a local fallback during migration');

const customers = read('server/routes/customerSuggestions.ts');
assert.match(customers, /customerSuggestionsRouter\.use\(requireAuth\)/, 'customer routes must require authentication');
assert.doesNotMatch(customers, /req\.query\.tenantId|x-tenant-id/, 'customer routes must use the authenticated tenant');
assert.match(read('server/whatsapp/historyImport.ts'), /item\.tenantId === customer\.tenantId/, 'WhatsApp timelines must include a tenant check');

const channelStatus = read('server/routes/channels.ts');
assert.match(channelStatus, /where: \{ tenantId, status: 'connected' \}/, 'connected channel lookups must remain tenant scoped');

const oauth = read('server/routes/whatsappOAuth.ts');
assert.match(oauth, /whatsappOAuthRouter\.use\(requireAuth, enforceSupportSessionReadOnly\)/, 'WhatsApp OAuth must authenticate and enforce support-session read-only restrictions');
assert.match(oauth, /if \(requested && requested !== tenantId\) \{ res\.status\(403\)\.json\(\{ error: 'tenant_not_allowed' \}\); return; \}/, 'all sessions including support sessions must reject a caller-selected foreign tenant before processing');
assert.match(oauth, /parsed\.tenantId !== tenantId \|\| parsed\.userId !== userId/, 'OAuth exchanges must bind nonce tenant and user to the authenticated session');

const oauthUi = read('src/components/YouTubeIntegration.tsx');
assert.match(oauthUi, /const popup = prepareOAuthPopup\('youtube-oauth'[\s\S]*?await fetch\('\/api\/overseas\/youtube\/oauth\/start'/, 'YouTube must open its OAuth window before awaiting the start request');
assert.match(oauthUi, /const popup = prepareOAuthPopup\(`\$\{platform\}-oauth`[\s\S]*?await fetch\(`\/api\/overseas\/social\/oauth\/\$\{platform\}\/start`/, 'social platforms must open their OAuth window before awaiting the start request');
assert.doesNotMatch(oauthUi, /isTikTokReviewPending|TikTok 账号正在审核中|status\?\.configured === false/, 'all social OAuth cards must keep their connection action available');
assert.match(oauthUi, /SocialPlatformIcon/, 'integration cards must use the shared social brand logos');
const socialPlatformIcon = read('src/components/SocialPlatformIcon.tsx');
for (const brand of ['youtube', 'tiktok', 'instagram', 'facebook', 'whatsapp']) {
  assert.match(socialPlatformIcon, new RegExp(`brand === '${brand}'`), `${brand} must have a real brand logo`);
}
const assistantUi = read('src/components/GlobalAssistant.tsx');
const assistantGuides = read('src/components/assistant/useAssistantFeatureGuides.ts');
const assistantReminders = read('src/components/assistant/AssistantFloatingReminders.tsx');
const assistantControls = read('src/components/assistant/useAssistantPanelControls.ts');
const assistantLauncher = read('src/components/assistant/AssistantLauncher.tsx');
const assistantBubbles = read('src/components/assistant/AssistantConversationBubbles.tsx');
const assistantNotifications = read('src/components/assistant/useAssistantNotifications.ts');
assert.match(assistantUi, /useAssistantFeatureGuides\(/, 'assistant must mount the enterprise guide lifecycle');
assert.match(assistantGuides, /ENTERPRISE_GUIDE_MEMORY_ID[\s\S]*?enterpriseGuideSeen/, 'enterprise center must remember its single proactive assistant guide');
assert.match(assistantUi, /<AssistantFloatingReminders[\s\S]*?enterpriseGuideSeen=\{enterpriseGuideSeen\}/, 'assistant must pass remembered guide state to reminders');
assert.match(assistantReminders, /要补资料？点我/, 'enterprise center must leave a concise click-to-open reminder after the proactive guide');
assert.match(assistantUi, /useAssistantPanelControls\(/, 'assistant must mount panel close controls');
assert.match(assistantControls, /const closeAssistant = useCallback\(\(\) => \{[\s\S]*?setAssistantTool\(null\)[\s\S]*?setPanelView\('chat'\)[\s\S]*?setMode\('breathing'\)/, 'assistant panels must fully close instead of leaving a hidden intake tool active');
const assistantRootTag = assistantUi.match(/data-global-assistant="root"[\s\S]*?\n\s*>/)?.[0] ?? '';
assert.match(assistantRootTag, /className=\{inlineHomeAnchor \? 'ls-assistant-home-root absolute inset-0 z-\[75\]' : `fixed/, 'only the anchored home assistant uses inline positioning; the shared launcher stays fixed');
for (const className of ['fixed', 'right-4', 'z-[75]', 'bottom-[calc(env(safe-area-inset-bottom)+1rem)]']) {
  assert.ok(assistantRootTag.includes(className), `the assistant launcher root must retain ${className}`);
}
assert.doesNotMatch(assistantUi, /page === 'conversion'[\s\S]{0,180}bottom-\[calc\(env\(safe-area-inset-bottom\)\+8rem\)\]/, 'the conversation page must not move the global launcher away from its shared safe-area position');
assert.match(assistantControls, /const handleLauncherClick[\s\S]{0,500}openCurrentPageAgent\(\)/, 'the assistant launcher must open the current-page panel directly');
assert.match(assistantUi, /openAgent\(currentPageAgent, 'chat'\)/, 'the confirmed unified assistant opens the current-page conversation without an agent selector');
assert.match(assistantUi, /<AssistantConversationPanel[\s\S]*?page=\{page\}/, 'assistant must pass current page to the conversation panel');
assert.match(assistantBubbles, /<AssistantDecisionCenter[\s\S]{0,300}page=\{page\}/, 'the assistant decision feed must be scoped to the current page');
assert.match(assistantUi, /<AssistantLauncher[\s\S]*?chatOpen=\{mode === 'chat'\}/, 'assistant must pass open state to the launcher');
assert.match(assistantLauncher, /data-global-assistant="launcher"[\s\S]{0,300}aria-label=\{chatOpen \? '收起灵小枢对话' : '询问灵小枢'\}/, 'the launcher must expose its direct open/close conversation behavior');
assert.doesNotMatch(assistantUi, /ASSISTANT_AUTO_RETRACT_MS|ASSISTANT_POSITION_KEY|assistantPosition|handlePointerDown/, 'the assistant must not restore the obsolete draggable or timer-driven auto-retract launcher');
assert.match(assistantUi, /useAssistantNotifications\(/, 'assistant must mount generation notifications');
assert.match(assistantNotifications, /lingshu-assistant-performance/, 'content generation must be able to wake the assistant for a waiting-time performance');
const enterpriseUi = read('src/components/EnterprisePage.tsx');
const enterpriseControls = read('src/components/enterprise/EnterpriseFormControls.tsx');
const enterpriseProductPanel = read('src/components/enterprise/EnterpriseProductPanel.tsx');
assert.match(enterpriseUi, /<EnterpriseProductPanel/, 'enterprise page must mount its product form');
assert.match(enterpriseProductPanel, /OptionSelector/, 'enterprise product form must use shared selectable controls');
assert.match(enterpriseControls, /function OptionSelector[\s\S]*?<Select[\s\S]*?mode=\{multiple \? 'multiple' : undefined\}[\s\S]*?allowClear[\s\S]*?options=/, 'enterprise selectable fields must use the shared accessible Ant single-select or multi-select control');
assert.doesNotMatch(enterpriseControls.slice(enterpriseControls.indexOf('function OptionSelector'), enterpriseControls.indexOf('function PaginationControls')), /<Chip/, 'enterprise option selectors must not fall back to chip-only selection');
const globalStyles = read('src/index.css');
for (const styleClass of ['.ui-field', '.ui-select', '.ui-chart-panel', '.ui-floating-panel']) {
  assert.match(globalStyles, new RegExp(styleClass.replace('.', '\\.')), `${styleClass} must remain part of the shared UI system`);
}
const publishingUi = read('src/components/TrafficPage.tsx');
const publishingView = read('src/components/SocialPublishPanelView.tsx');
const publishingSelection = read('src/components/publishing/publishPanelSelection.ts');
assert.doesNotMatch(publishingUi + publishingView, /平台发布推荐|publish-recommendations/, 'one-click publishing must not render the removed platform recommendation panel');
assert.match(publishingUi, /applyContentToAll[\s\S]*?title: activeItem\.title[\s\S]*?description: activeItem\.description[\s\S]*?platformCopy:[\s\S]*?firstComment: activeItem\.firstComment/, 'applying content to all videos must copy the current publishing content');
assert.match(publishingView, /发布队列[\s\S]*?平台账号选择[\s\S]*?内容编辑/, 'publishing queue, account selection, and content editing must remain separate sections');
assert.match(publishingView, /<Segmented[\s\S]{0,200}aria-label="发布方式"[\s\S]{0,200}setDeliveryMode\(value as DeliveryMode\)/, 'publishing delivery mode must use the shared segmented control');
for (const [value, label] of [['now', '立即发布'], ['flexible', '时间待定'], ['schedule', '定点排期']]) {
  assert.match(publishingView, new RegExp(`value: '${value}', label: '${label}'`), 'one-click publishing must expose three unambiguous delivery modes');
}
assert.match(publishingUi, /publishableItems/, 'publishing must use the explicit publishable selection');
assert.match(publishingSelection, /item\.deliveryMode !== 'flexible'/, 'time-undecided content must never be included in direct real publishing');
const calendarPlannerUi = read('src/components/publishing/CalendarPlanner.tsx');
const calendarUi = read('src/components/ui/LsCalendar.tsx');
assert.match(calendarPlannerUi, /<LsCalendar[\s\S]*?onDatesSet=\{info => \{ setVisibleRange/, 'publishing uses the shared calendar and its visible range');
assert.match(calendarPlannerUi, /buildMarketingEvents\(anchor\)[\s\S]*?本月电商节庆[\s\S]*?来源：\{event\.source\}/, 'monthly marketing events must retain their dated source attribution');
assert.doesNotMatch(calendarPlannerUi, /festivalNoticesByDay|dayFestivalNotices/, 'festival markers must not be rendered inside calendar day cells');
assert.match(calendarPlannerUi, /pendingTimeSelection[\s\S]*?选择具体发布时间[\s\S]*?确认时间/, 'flexible calendar drops must ask for an explicit publishing time');
assert.match(calendarPlannerUi, /editable: canMoveCalendarPost\(post, canEditSchedule && !demoMode\)/, 'event editing must honor the shared status and permission policy');
assert.match(calendarPlannerUi, /!canMoveCalendarPost\(current, canEditSchedule && !demoMode\)/, 'rescheduling must recheck the policy before calling the API');
assert.match(calendarUi, /startEditable: Boolean\(event\.editable && onMoveEvent\)/, 'calendar drag editing requires both event permission and a mutation handler');
assert.match(calendarUi, /if \(!event\.editable \|\| !moveRef\.current\)/, 'keyboard and pointer movement must share the same guard');
assert.match(calendarPlannerUi, /renderDetails=[\s\S]*?成片时长[\s\S]*?平台回执/, 'event details must expose actual content and platform receipt data');
assert.match(calendarPlannerUi, /row\.source === 'account_history'\) \? '账号真实数据' : '平台参考'/, 'recommendation labels must distinguish measured account data from platform references');
assert.match(calendarPlannerUi, /setScores\(\{\}\)/, 'failed recommendations must clear unavailable scores instead of synthesizing values');
assert.match(calendarPlannerUi, /selectedBestHour === null \? '暂无可用推荐时段'/, 'missing recommendation data must be visibly unavailable');
assert.match(calendarPlannerUi, /非账号实测/, 'platform references must not masquerade as account measurements');
assert.doesNotMatch(calendarPlannerUi, /fallbackPeakScore|Math\.sin|Math\.random/, 'calendar recommendations must not invent fallback scores');
const movablePost = { id: 'post-1', status: 'scheduled' };
assert.equal(canMoveCalendarPost(movablePost, true), true);
assert.equal(canMoveCalendarPost(movablePost, false), false, 'read-only users cannot move events');
for (const status of ['published', 'needs_attention', 'publishing', 'finalize_pending', 'partial', 'awaiting_reapproval']) {
  assert.equal(canMoveCalendarPost({ ...movablePost, status }, true), false, `${status} posts cannot move`);
}
for (const locked of [{ scheduleLocked: true }, { platformPostId: 'remote-post' }, { id: 'demo-calendar-1' }]) {
  assert.equal(canMoveCalendarPost({ ...movablePost, ...locked }, true), false, 'locked, published and demo posts cannot move');
}
const schedulingNow = new Date('2026-10-10T00:00:00Z');
const droppedDay = new Date('2026-10-12T00:00:00Z');
assert.equal(resolvePendingDrop({ deliveryMode: 'now' }, droppedDay, '', schedulingNow).kind, 'blocked');
assert.equal(resolvePendingDrop({ deliveryMode: 'flexible' }, droppedDay, '', schedulingNow).kind, 'needs-time');
const fixedSchedule = '2026-10-13T08:30:00Z';
assert.deepEqual(resolvePendingDrop({ deliveryMode: 'schedule', scheduledAt: fixedSchedule }, droppedDay, '', schedulingNow), { kind: 'ready', scheduledAt: new Date(fixedSchedule), locked: true }, 'dropping a fixed event must preserve its confirmed timestamp');
assert.doesNotMatch(calendarPlannerUi, /setError\(loadError instanceof Error \? loadError\.message : 'load_failed'\)/, 'calendar UI must not expose raw transport errors');
const strategyUi = read('src/components/StrategyDataBoard.tsx');
assert.match(strategyUi, /onClick=\{\(\) => openWorkspaceView\('accountManagement', 'accounts'\)\}[\s\S]{0,450}已接入账号'[\s\S]{0,80}\{exposure\.accountCount\}/, 'home connected-account affordance must navigate to the current account management page');
const publishingRoutes = read('server/routes/publishing.ts');
assert.match(publishingRoutes, /scheduleLocked: req\.body\?\.scheduleLocked === true/, 'calendar creation must persist the fixed-time lock');
assert.match(publishingRoutes, /currentStats\.scheduleLocked === true[\s\S]*?定点排期时间已锁定/, 'calendar API must reject accidental fixed-time changes');
const events2026 = buildMarketingEvents(new Date(2026, 0, 1));
const eventDates2026 = Object.fromEntries(events2026.filter(event => event.date.startsWith('2026-')).map(event => [event.id, event.date]));
assert.equal(eventDates2026['2026-lunar-new-year'], '2026-02-17', '2026 Lunar New Year must use its real calendar date');
assert.equal(eventDates2026['2026-eid-al-fitr'], '2026-03-20', '2026 Eid al-Fitr must use its real calendar date');
assert.equal(eventDates2026['2026-diwali'], '2026-11-08', '2026 Diwali must use its real calendar date');
assert.equal(eventDates2026['2026-black-friday'], '2026-11-27', 'Black Friday must be derived from Thanksgiving');
assert.equal(eventDates2026['2026-cyber-monday'], '2026-11-30', 'Cyber Monday must be derived from Thanksgiving');
const studioUi = readAiStudioApplicationSources();
assert.match(studioUi, /buildPublishPayload[\s\S]*?sourceProjectId: projectId \|\| undefined[\s\S]*?platform: platform as[\s\S]*?goPublishCurrentWork[\s\S]*?buildPublishPayload\(\)/, 'AI materials must carry their project and platform format into one-click publishing');
const socialSetupGuide = read('docs/客户社媒账号配置与授权操作指南.md');
assert.doesNotMatch(socialSetupGuide, /https:\/\/lingshu\.site\/api\//, 'production OAuth guidance must use the canonical app subdomain');
assert.match(socialSetupGuide, /https:\/\/app\.lingshu\.site\/api\/overseas\/youtube\/oauth\/callback/, 'the canonical YouTube callback must remain documented');

const tenantPlatformApps = read('server/lib/tenantPlatformApps.ts');
assert.match(tenantPlatformApps, /export type TenantPlatform = [^\n]*'tiktok'/, 'tenant platform applications must include TikTok even when additional platforms are supported');
assert.match(tenantPlatformApps, /getTenantTikTokOAuthClient[\s\S]*?getTenantPlatformAppFrom\(dataStore, tenantId, 'tiktok'\)[\s\S]*?app\?\.tenant_id === tenantId[\s\S]*?return null;[\s\S]*?return getTikTokOAuthClient\(\)/, 'tenant TikTok credentials must remain isolated; only unscoped requests use global credentials');
const publicPlatformApp = tenantPlatformApps.slice(
  tenantPlatformApps.indexOf('export function publicTenantPlatformApp'),
  tenantPlatformApps.indexOf('export async function upsertTenantPlatformApp'),
);
assert.doesNotMatch(publicPlatformApp, /\bappSecret\s*:/, 'customer-facing platform app data must not expose plaintext app secrets');
const adminRoutes = read('server/routes/admin.ts');
assert.match(adminRoutes, /function adminTenantPlatformApp[\s\S]*?appSecret:\s*''/, 'admin delivery responses must keep app secrets write-only');
assert.match(adminRoutes, /\['meta', 'google', 'tiktok', 'wecom'\]/, 'admin delivery cards must include TikTok for every tenant');
assert.match(adminRoutes, /kind === 'tiktok'[\s\S]*?tiktok_test_passed/, 'admin delivery must provide a TikTok credential check');
for (const route of ["'/oauth-config'", "'/delivery/platform-apps'"]) {
  assert.match(adminRoutes, new RegExp(`adminRouter\\.get\\(${route}[\\s\\S]*?requireAdminUser\\(req\\)`), `${route} must require an administrator before returning credentials`);
}
assert.match(adminRoutes, /adminRouter\.delete\('\/oauth-config\/:platform'[\s\S]*?requireAdminUser\(req\)/, 'clearing global OAuth credentials must require an administrator');
assert.match(adminRoutes, /disconnectTenantPlatformAccounts\(admin\.tenantId, platform\)/, 'clearing global OAuth credentials must only disconnect the current administrator tenant');
const oauthConfig = read('server/lib/oauthConfig.ts');
assert.match(oauthConfig, /disabledPlatforms\?: OAuthPlatform\[\]/, 'cleared OAuth platforms must persist an explicit disabled state');
assert.match(oauthConfig, /youtubeDisabled \? '' :[\s\S]*?metaDisabled \? '' :[\s\S]*?tiktokDisabled \? '' :/, 'cleared OAuth platforms must not silently reactivate from environment variables');
const adminSocialSetup = read('src/components/AdminSocialAccountSetup.tsx');
assert.match(adminSocialSetup, /ClearConfigButton[\s\S]*?清除配置/, 'administrator platform cards must expose a clear action');
assert.match(adminSocialSetup, /role="dialog"[\s\S]*?确认清除/, 'clearing a platform must require an explicit second confirmation');
assert.match(adminSocialSetup, /disconnectedAccounts[\s\S]*?配置已清除/, 'the administrator must receive a clear success result after platform cleanup');

const socialRoutes = read('server/routes/social.ts');
const socialOAuthSupport = read('server/routes/socialOAuthSupport.ts');
assert.match(socialOAuthSupport, /getTikTokClient\(tenantId\?: string\)[\s\S]*?getTenantAwareTikTokOAuthClient\(tenantId\)/, 'customer TikTok OAuth must resolve tenant-aware credentials');
assert.match(socialRoutes, /getTikTokClient\(tenantId\)/, 'customer TikTok OAuth must pass the authenticated tenant');
const platformIntegrationRoutes = read('server/routes/platformIntegrations.ts');
assert.match(platformIntegrationRoutes, /put\('\/oauth-config', requireAuth[\s\S]*?tenantId[\s\S]*?upsertTenantPlatformApp/, 'customer OAuth credentials must be authenticated and tenant scoped');
assert.match(platformIntegrationRoutes, /delete\('\/oauth-config\/:platform', requireAuth[\s\S]*?tenantId[\s\S]*?deleteTenantPlatformApp\(tenantId, typedPlatform\)/, 'customer OAuth credential deletion must be authenticated and tenant scoped');
assert.match(platformIntegrationRoutes, /publicTenantPlatformApp/, 'customer OAuth config responses must use the secret-safe public serializer');
assert.match(platformIntegrationRoutes, /webhookVerifyToken:\s*text\(req\.body\?\.metaWebhookVerifyToken\)/, 'customer OAuth config must save the tenant-owned Messenger webhook verification setting');
const socialAccountCleanup = read('server/lib/socialAccountCleanup.ts');
assert.match(socialAccountCleanup, /where: \{ tenantId \}/, 'platform account cleanup must only query the authenticated tenant');
const userSocialCredentials = read('src/components/UserSocialAppCredentials.tsx');
assert.match(userSocialCredentials, /清除配置[\s\S]*?role="dialog"[\s\S]*?确认清除/, 'integration-center credential cards must expose a confirmed clear action');
const socialCredentialsUi = read('src/components/UserSocialAppCredentials.tsx');
assert.doesNotMatch(socialCredentialsUi, /Messenger Webhook Callback URL|Messenger Webhook Verify Token|Instagram Webhook Callback URL|Instagram Webhook Verify Token/, 'first-review customer integrations must not expose messaging webhook configuration');
const assistLinks = read('server/routes/assistLinks.ts');
assert.match(assistLinks, /platform === 'meta' \|\| platform === 'google' \|\| platform === 'tiktok'/, 'assist links must accept TikTok');
assert.match(assistLinks, /getTenantAwareTikTokOAuthClient\(tenantId\)/, 'TikTok assist links must use the tenant application');
const deliveryUi = read('src/components/AdminDeliveryPage.tsx');
const deliveryComponents = read('src/components/AdminDeliveryComponents.tsx');
assert.match(deliveryUi, /<PlatformWizard/, 'admin delivery UI must mount the platform setup wizard');
assert.match(deliveryComponents, /type Platform = 'meta' \| 'google' \| 'tiktok' \| 'wecom'/, 'admin delivery UI must include TikTok');
assert.match(deliveryComponents, /label="Client Key"[\s\S]*?label="Client Secret"[\s\S]*?app\.oauthRedirectUri/, 'admin delivery UI must expose TikTok credentials and callback');
assert.match(read('pb_migrations/1784800000_expand_tiktok_tenant_apps.js'), /\^\(meta\|google\|tiktok\|wecom\)\$/, 'PocketBase tenant platform validation must accept TikTok');

const videos = readVideoApplicationSources();
assert.match(videos, /const \{ tenantId \} = res\.locals as AuthLocals/, 'video routes must resolve tenant from auth locals');
assert.match(videos, /get\('\/ops\/queue'[\s\S]*?crawlerOpsRecordIdsForTenant\(tenantId\)[\s\S]*?filterCrawlerOpsTasksForRecordIds/, 'crawler ops queue must only expose tasks backed by current-tenant videos');
assert.match(videos, /get\('\/ops\/stats'[\s\S]*?crawlerOpsRecordIdsForTenant\(tenantId\)[\s\S]*?crawlerOpsStats\(tenantId, visibleRecordIds\)/, 'crawler ops stats must only aggregate current-tenant tasks');
assert.match(videos, /post\('\/ops\/run-once'[\s\S]*?runCrawlerOpsWorkerOnce\(\{ tenantId \}\)/, 'an HTTP worker tick must be tenant scoped');
assert.match(videos, /post\('\/ops\/:taskId\/resolve'[\s\S]*?store\.getById<Record<string, unknown>>\(COL, task\.recordId\)[\s\S]*?record\.tenantId[\s\S]*?tenantId/, 'crawler ops resolution must verify the backing video belongs to the authenticated tenant');
assert.match(videos, /runCrawlerOpsWorkerOnce\(options: \{ recoverInterrupted\?: boolean; tenantId\?: string \}/, 'the worker must accept an optional tenant without removing global background mode');
assert.match(videos, /enqueueOpsTasksFromRecords\(options\.recoverInterrupted === true, tenantId, maxAttempts\)[\s\S]*?pendingCrawlerOpsTasks\(maxAttempts, visibleRecordIds\)/, 'tenant-scoped worker ticks must constrain both enqueue and candidate selection');
assert.match(videos, /patch\('\/:id\/reanalyze'[\s\S]*?resetCrawlerOpsTaskForExplicitRetry/, 'an explicit tenant-scoped reanalysis must reset its own exhausted ops task before retrying');

for (const route of ['agentChat', 'strategy', 'draftReply', 'studio']) {
  const source = read(`server/routes/${route}.ts`);
  assert.match(source, /Router\.use\(requireAuth\)|studioRouter\.use\(requireAuth\)/, `${route} routes must require authentication`);
}
assert.doesNotMatch(read('server/routes/draftReply.ts'), /body\.tenantId/, 'draft replies must not accept a caller-selected tenant id');
assert.match(read('server/routes/agentChat.ts'), /readTenantEnterpriseProfile\(tenantId\)/, 'agent chat must use tenant enterprise context');
assert.match(read('server/routes/strategy.ts'), /readTenantEnterpriseProfile\(tenantId\)/, 'strategy chat must use tenant enterprise context');
assert.match(readStudioApplicationSources(), /buildEnterpriseContext\(await readTenantEnterpriseProfile\(tenantId\)\)/, 'social generation must use tenant enterprise context');
assert.match(read('server/knowledge/retrieve.ts'), /await readTenantEnterpriseProfile\(tenantId\)/, 'knowledge retrieval must use the authenticated tenant profile');
const strategyRetrieval = read('server/knowledge/strategyRetrieve.ts');
assert.match(strategyRetrieval, /where: \{ tenant_id: tenantId, status: 'active' \}/, 'strategy memory retrieval must be tenant scoped');
const styleMemory = read('server/knowledge/styleMemory.ts');
assert.match(styleMemory, /await readTenantEnterpriseProfile\(tenantId\)/, 'style distillation must read the tenant profile');
assert.match(styleMemory, /await updateTenantEnterpriseProfile\(tenantId,/, 'style distillation must update the tenant profile');
assert.doesNotMatch(styleMemory, /readEnterpriseProfile|updateEnterpriseProfile/, 'style learning must not use the global profile file');
const whatsappInbound = read('server/whatsapp/historyInbound.ts');
assert.match(read('server/whatsapp/historyImport.ts'), /handleInboundMessage\(tenantId,/, 'verified WhatsApp ingress must pass the tenant into inbound handling');
assert.match(whatsappInbound, /await readTenantEnterpriseProfile\(tenantId\)/, 'WhatsApp autonomy must use the inbound message tenant profile');

const assetAccess = read('server/lib/assetAccess.ts');
assert.match(assetAccess, /segments\[0\] === 'tenants' && segments\[1\] === viewerTenantId/, 'private assets must enforce tenant path ownership');
const materialAssets = read('server/storage/materialAssets.ts');
assert.match(materialAssets, /MATERIAL_ASSET_PREFIX = 'materials\/tenants'/, 'private COS materials must use a tenant prefix');
assert.match(materialAssets, /materialAssetTenantKey\(tenantId\)/, 'material object keys must derive their tenant segment from authenticated tenant data');
const studio = readStudioApplicationSources();
const studioMaterialProjection = read('server/routes/studioMaterialProjection.ts');
assert.match(studio, /saveMaterialUploadToDatabase\(\{[\s\S]*?tenantId, name, folder/, 'material uploads must pass the authenticated tenant into database persistence');
const cloudMaterials = read('server/lib/cloudMaterials.ts');
assert.match(cloudMaterials, /tenantId: input\.tenantId/, 'PocketBase material records must derive tenant ownership from the authenticated upload input');
assert.match(cloudMaterials, /materialTenantId\(record\) !== input\.tenantId/, 'PocketBase material writes must verify the returned tenant before exposing the record');
assert.match(studio, /materialResponse\(/, 'Studio routes must use the protected material response projection');
assert.match(studioMaterialProjection, /material\.objectKey[\s\S]*?privateStudioAssetUrl\('materials', tenantId/, 'private COS material reads must use the signed application route');
assert.match(studio, /get\('\/private-assets\/:namespace\/:file'[\s\S]*?objectStorageGetObject\(tenantPrivateObjectKey\(namespace, tenantId, req\.params\.file\)/, 'the private asset route must bind object reads to the authenticated tenant');
assert.match(studio, /item\.id === req\.params\.id && item\.tenantId === tenantId/, 'material mutations must enforce tenant ownership');
const studioProjectRead = read('server/routes/studioProjectReadRoutes.ts');
const studioProjectSave = read('server/routes/studioProjectSaveRoutes.ts');
const studioProjectReview = read('server/routes/studioProjectReviewRoutes.ts');
assert.match(studio, /createStudioProjectReadRouter\(loadMaterials, store\)/, 'Studio must mount tenant-scoped project reads');
assert.match(studioProjectRead, /where: \{ tenant_id: tenantId \}/, 'studio projects must be queried by authenticated tenant');
assert.match(studio, /createStudioProjectSaveRouter\(/, 'Studio must mount guarded project writes');
assert.match(studioProjectSave, /existing\?\.tenant_id === tenantId/, 'studio project saves must enforce tenant ownership');
assert.match(studioProjectReview, /existing\.tenant_id !== tenantId/, 'studio project review mutations must enforce tenant ownership');
assert.match(studio, /item\.tenantId === tenantId/, 'variation batches must be tenant filtered');
assert.match(studio, /tenantPrivateObjectKey\(namespace, tenantId, file\)/, 'studio private objects must use tenant-prefixed storage');
assert.match(studio, /persistPrivateStudioAsset\('tts', tenantId/, 'TTS objects must use private storage');
assert.match(studio, /persistPrivateStudioAsset\('voice-samples', tenantId/, 'voice samples must use private storage');
const serverIndex = read('server/index.ts');
for (const prefix of ['media', 'bgm', 'tts', 'voice-samples', 'covers']) {
  assert.match(serverIndex, new RegExp(`app\\.use\\('/${prefix}', requireScopedAsset`), `${prefix} assets must use scoped access`);
}

const scheduler = read('server/routes/scheduler.ts');
assert.match(scheduler, /findIndex\(t => t\.id === req\.params\.id && t\.tenantId === tenantId\)/, 'scheduled task updates must check tenant ownership');

const caddy = read('Caddyfile');
assert.doesNotMatch(caddy, /PB_DOMAIN|pocketbase:8090/, 'PocketBase must not be exposed by the public reverse proxy');
const compose = read('docker-compose.yml');
assert.doesNotMatch(compose, /pocketbase:[\s\S]*?ports:\s*\n\s*-\s*["']?8090/m, 'PocketBase must not publish port 8090');

const setup = read('scripts/setup-pb.ts');
assert.doesNotMatch(setup, /WORKBENCH_ADMIN|ensureWorkbenchAdmin/, 'schema repair must not own application-account creation');
const workbenchBootstrap = read('scripts/bootstrap-workbench-admin.mjs');
assert.match(workbenchBootstrap, /role:\s*'super_admin'/, 'the one-time record bootstrap must provision the workbench administrator explicitly');
assert.doesNotMatch(workbenchBootstrap, /\/api\/collections\/(?:\$\{[^}]+\}|[^/`'"?]+)(?:[`'"?]|$)(?!\/records)/, 'the workbench bootstrap must not mutate collection schemas');
assert.match(read('server/lib/demoAccounts.ts'), /WORKBENCH_ADMIN_EMAIL/, 'workbench administrator must receive dashboard access');
assert.match(read('Dockerfile.pocketbase'), /TARGETARCH/, 'PocketBase image must follow the server CPU architecture');
assert.match(read('scripts/backup-production-data.sh'), /docker cp/, 'production backup must read the PocketBase Docker volume');

console.log('tenant isolation checks passed');
