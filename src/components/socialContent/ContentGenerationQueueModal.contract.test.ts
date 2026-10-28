import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modal = fs.readFileSync(new URL('./ContentGenerationQueueModal.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('./CreationTaskWorkspace.tsx', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../../lib/contentGenerationQueue.ts', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../AppShellChrome.tsx', import.meta.url), 'utf8');
const configuredWorkspace = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const assistantWorkBookmark = fs.readFileSync(new URL('../assistant/AssistantWorkBookmark.tsx', import.meta.url), 'utf8');
const entrypointSources = [
  '../ContentCreationHome.tsx',
  '../DigitalEmployeeHomeWork.tsx',
  '../ConfiguredDigitalEmployeeWorkspace.tsx',
  '../assistant/AssistantWorkBookmark.tsx',
  '../assistant/AssistantProductionPortal.tsx',
  '../assistant/AssistantCreationPortalCard.tsx',
  '../assistant/AssistantScenarioPlanner.tsx',
  '../smartBusiness/BusinessOverviewTabs.tsx',
  './SocialProductionProgressPanel.tsx',
].map(relativePath => ({
  relativePath,
  source: fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
}));

const componentsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readTsxFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  if (entry.isDirectory()) return readTsxFiles(target);
  return entry.isFile() && entry.name.endsWith('.tsx') ? [fs.readFileSync(target, 'utf8')] : [];
});
const modalMountCount = readTsxFiles(componentsRoot)
  .reduce((count, source) => count + (source.match(/<ContentGenerationQueueModal\b/g)?.length || 0), 0);

assert.equal(modalMountCount, 2, '全局弹窗与侧栏内嵌视图应复用同一任务包组件');
assert.match(shell, /<ContentGenerationQueueModal\s*\/>/, '应用壳必须承载唯一的全局队列弹窗');
assert.match(modal, /const show=[^\n]+setRequest\(detail\);setSettingsOpen\(false\);setOpen\(true\)/, '统一事件必须携带请求并打开弹窗');
assert.match(modal, /addEventListener\(CONTENT_GENERATION_QUEUE_OPEN_EVENT,show\)/, '任意入口必须通过同一全局事件打开弹窗');
assert.match(modal, /request\.source==='weekly'\?'周任务包':'内容生成队列'/, '弹窗标题必须反映周任务包或统一队列范围');
assert.match(modal, /request\.source==='weekly'\?'本周全部计划任务':'周计划 \+ 临时单条'/, '弹窗必须明确当前任务来源范围');
assert.match(modal, /request\.source==='weekly'\?<WeeklyTaskPackageView data=\{overview\}\/>:<CreationTaskWorkspace/, '周任务包入口必须展示全部真实周计划任务，不能继续复用内容生成队列');
assert.match(modal, /本周经营目标、全部计划阶段、任务依赖、负责 Agent 和真实运行状态/, '周任务包说明必须覆盖完整计划范围');
assert.match(assistantWorkBookmark, /aria-label="打开周任务包"[\s\S]{0,240}<span>周任务包<\/span>/, '助手侧边入口必须使用周任务包名称并保留可访问名称');
assert.match(assistantWorkBookmark, /onClick=\{onOpen\}/, '周任务包书签必须展开助手面板');
assert.match(modal, /embedded \? \{ source: 'weekly' as const \}/, '侧栏展开必须展示真实周计划任务');
assert.doesNotMatch(assistantWorkBookmark, /打开内容生成队列|<span>内容生成队列<\/span>/, '助手侧边入口不得继续暴露旧的内容生成队列名称');
for (const entrypoint of entrypointSources) {
  assert.match(entrypoint.source, /openContentGenerationQueue\(/, `${entrypoint.relativePath} 必须打开全局统一队列`);
  assert.doesNotMatch(entrypoint.source, /<CreationTaskWorkspace\b/, `${entrypoint.relativePath} 不得嵌入第二份内容队列`);
}
const contentCreationOverview = fs.readFileSync(new URL('../ContentCreationOverviewPage.tsx', import.meta.url), 'utf8');
assert.match(contentCreationOverview, /<CreationTaskWorkspace data=\{overview\} request=\{queueRequest\}/, '内容创作页必须复用统一工作区并常驻展开');
assert.doesNotMatch(contentCreationOverview, /openContentGenerationQueue\(/, '内容创作页不得再通过按钮打开任务弹窗');

assert.match(workspace, /aria-label="内容生成队列视图"[\s\S]{0,240}label:'任务列表'[\s\S]{0,120}label:'发布日历'/, '统一弹窗必须在同一工作区切换任务列表和发布日历');
assert.match(workspace, /aria-label="任务来源筛选"[\s\S]{0,260}label:'周计划'[\s\S]{0,120}label:'临时单条'/, '统一弹窗必须提供周计划和临时单条来源筛选');

assert.match(helper, /taskId\?: string;[\s\S]{0,80}contentId\?: string;/, '统一入口请求必须支持任务和内容标识');
assert.match(helper, /detail: \{ requestId: requestSequence, view: 'tasks', metric: 'all', source: 'all', status: 'all', \.\.\.request \}/, '统一入口必须原样保留调用方传入的聚焦详情请求');
assert.match(workspace, /setTaskId\(request\.taskId\|\|null\);setContentId\(request\.contentId\|\|null\)/, '工作区必须响应新的任务或内容聚焦请求');
assert.match(workspace, /queueMode&&selected\?<CreationTaskDetailDrawer[^>]*inline/, '队列弹窗内必须以内联详情承接聚焦请求，不能再打开第二个抽屉');

assert.match(modal, /setSettingsOpen\(value=>!value\)/, 'Agent 设置应在当前周任务包弹窗内切换');
assert.match(modal, /<OnboardingPanel key=\{revision\} initial=\{overview\.config\}/, 'Agent 设置应复用现有规则表单');
assert.doesNotMatch(shell, /onNavigate\('digitalEmployees'\); window\.setTimeout\(openAgentSettings, 0\)/, 'Agent 设置不得跳转经营总览');
assert.match(configuredWorkspace, /addEventListener\(AGENT_SETTINGS_OPEN_EVENT, openSettings\)/, '经营总览必须接收全局 Agent 设置入口');
assert.match(configuredWorkspace, /setWorkspaceView\('rules'\)/, 'Agent 设置入口必须切换到既有设置视图');
assert.match(configuredWorkspace, /mode="rules" initialSettingsOpen/, '既有 Agent 设置视图必须直接展开完整设置编辑器');

console.log('Unified content-generation queue modal contract passed');
