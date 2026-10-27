import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modal = fs.readFileSync(new URL('./ContentGenerationQueueModal.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('./CreationTaskWorkspace.tsx', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../../lib/contentGenerationQueue.ts', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../AppShellChrome.tsx', import.meta.url), 'utf8');
const configuredWorkspace = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const entrypointSources = [
  '../ContentCreationHome.tsx',
  '../ContentCreationOverviewPage.tsx',
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

assert.equal(modalMountCount, 1, '内容生成队列弹窗必须只在全局应用壳挂载一次');
assert.match(shell, /<ContentGenerationQueueModal onOpenAgentSettings=/, '应用壳必须承载唯一的全局队列弹窗');
assert.match(modal, /const show=[^\n]+setRequest\(detail\);setOpen\(true\)/, '统一事件必须携带请求并打开弹窗');
assert.match(modal, /addEventListener\(CONTENT_GENERATION_QUEUE_OPEN_EVENT,show\)/, '任意入口必须通过同一全局事件打开弹窗');
assert.match(modal, /<span>内容生成队列<\/span>[\s\S]{0,120}<Tag color="blue">周计划 \+ 临时单条<\/Tag>/, '弹窗必须明确合并周计划任务和临时单条任务');
for (const entrypoint of entrypointSources) {
  assert.match(entrypoint.source, /openContentGenerationQueue\(/, `${entrypoint.relativePath} 必须打开全局统一队列`);
  assert.doesNotMatch(entrypoint.source, /<CreationTaskWorkspace\b/, `${entrypoint.relativePath} 不得嵌入第二份内容队列`);
}

assert.match(workspace, /aria-label="内容生成队列视图"[\s\S]{0,240}label:'任务列表'[\s\S]{0,120}label:'发布日历'/, '统一弹窗必须在同一工作区切换任务列表和发布日历');
assert.match(workspace, /aria-label="任务来源筛选"[\s\S]{0,260}label:'周计划'[\s\S]{0,120}label:'临时单条'/, '统一弹窗必须提供周计划和临时单条来源筛选');

assert.match(helper, /taskId\?: string;[\s\S]{0,80}contentId\?: string;/, '统一入口请求必须支持任务和内容标识');
assert.match(helper, /detail: \{ requestId: requestSequence, view: 'tasks', metric: 'all', source: 'all', status: 'all', \.\.\.request \}/, '统一入口必须原样保留调用方传入的聚焦详情请求');
assert.match(workspace, /setTaskId\(request\.taskId\|\|null\);setContentId\(request\.contentId\|\|null\)/, '工作区必须响应新的任务或内容聚焦请求');
assert.match(workspace, /queueMode&&selected\?<CreationTaskDetailDrawer[^>]*inline/, '队列弹窗内必须以内联详情承接聚焦请求，不能再打开第二个抽屉');

assert.match(modal, />Agent 设置<\/Button>/, '统一队列弹窗必须提供明确的 Agent 设置入口');
assert.match(modal, /setOpen\(false\);onOpenAgentSettings\(\)/, '进入 Agent 设置前必须关闭队列弹窗');
assert.match(shell, /onNavigate\('digitalEmployees'\); window\.setTimeout\(openAgentSettings, 0\)/, 'Agent 设置入口必须导航到现有经营总览设置，而不是创建平行设置页');
assert.match(configuredWorkspace, /addEventListener\(AGENT_SETTINGS_OPEN_EVENT, openSettings\)/, '经营总览必须接收全局 Agent 设置入口');
assert.match(configuredWorkspace, /setWorkspaceView\('rules'\)/, 'Agent 设置入口必须切换到既有设置视图');
assert.match(configuredWorkspace, /mode="rules" initialSettingsOpen/, '既有 Agent 设置视图必须直接展开完整设置编辑器');

console.log('Unified content-generation queue modal contract passed');
