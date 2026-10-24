import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const pageSlot = readFileSync(new URL('../AppPageSlot.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
const pageTransition = readFileSync(new URL('./ui/LsPageTransition.tsx', import.meta.url), 'utf8');
const traffic = readFileSync(new URL('./TrafficPage.tsx', import.meta.url), 'utf8');
const trafficWorkspace = readFileSync(new URL('./TrafficWorkspacePage.tsx', import.meta.url), 'utf8');
const starter = readFileSync(new URL('./starter/StarterWorkspacePage.tsx', import.meta.url), 'utf8');
const starterContext = readFileSync(new URL('./starter/StarterWorkflowContextBar.tsx', import.meta.url), 'utf8');
const canonicalPageSources = {
  strategy: readFileSync(new URL('./StrategyPage.tsx', import.meta.url), 'utf8'),
  digitalEmployees: readFileSync(new URL('./ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8'),
  conversion: readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8'),
  orders: readFileSync(new URL('./OrderManagementPage.tsx', import.meta.url), 'utf8'),
};
const sharedHeader = readFileSync(new URL('./ui/LsPageHeader.tsx', import.meta.url), 'utf8');

assert.match(layout, /h-\[100dvh\]/, 'the application shell must use the dynamic viewport height');
assert.match(layout, /<LsPageTransition page=\{page\}>\{children\}<\/LsPageTransition>/,
  'the shared transition must keep the cached page tree mounted');
assert.match(pageTransition, /data-app-content-stack[^>]+flex[^>]+min-h-0[^>]+flex-col[^>]+overflow-hidden/,
  'layout children must share a bounded vertical flex stack');
assert.match(app, /<AppPageSlot/);
assert.match(pageSlot, /data-app-page-slot[^>]+min-h-0[^>]+flex-1[^>]+overflow-hidden/,
  'context bars must leave one bounded page slot for the active page');
assert.match(traffic, /<TrafficWorkspacePage/);
assert.match(trafficWorkspace, /flex h-full min-h-0 flex-col overflow-hidden/,
  'the social workspace must hand scrolling to its active panel');
assert.match(layout, /matchMedia\('\(max-width: 767px\)'\)[\s\S]+addEventListener\('change'/,
  'the mobile navigation must react when viewport width changes');

assert.doesNotMatch(layout, /投流与发布|CONTENT_NAV_ITEMS|ContentCreationNav/,
  'the old social umbrella navigation must be removed');
assert.doesNotMatch(layout.slice(layout.indexOf('<motion.aside'), layout.indexOf('</motion.aside>')), /aria-label="创作模式"|CREATION_MODE_LABELS|\bSegmented\b/,
  'the sidebar must not duplicate the creator mode switch in the main topbar');
assert.doesNotMatch(starter, /AgentUsageCard|四个 Agent|Token|成本预算/,
  'ordinary starter users must not see internal agent usage or cost accounting');
for (const label of ['业务进度', '待处理', '结果']) assert.match(starter, new RegExp(label));
for (const internalName of ['灵小图', '灵小量', '灵小售']) {
  assert.doesNotMatch(`${starter}\n${starterContext}`, new RegExp(internalName));
}
for (const [page, source] of Object.entries(canonicalPageSources)) {
  assert.match(source, new RegExp(`<h1[^>]*>[\\s\\S]{0,100}PAGE_REGISTRY\\.${page}\\.canonicalTitle`),
    `${page} must render its canonical registry title as H1`);
}
assert.match(sharedHeader, /Typography.Title level=\{1\} className="sr-only"/,
  'shared action-only headers must retain an accessible H1 without a visible page title');
const enterprise = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');
assert.match(enterprise, /<h1 className="sr-only">企业知识库<\/h1>/,
  'the tab-led enterprise workspace must retain an accessible page title');
const scheduled = readFileSync(new URL('./ScheduledPage.tsx', import.meta.url), 'utf8');
assert.ok(scheduled.includes('<LsPageHeader title="定时任务"'), 'ScheduledPage.tsx must use its accessible shared header');

console.log('Application shell contract tests passed');
