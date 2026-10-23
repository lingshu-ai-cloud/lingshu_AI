import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studioSource = readAiStudioApplicationSources();
const productionEntrySource = readFileSync(new URL('./smartBusiness/ConnectedAgentCalendar.tsx', import.meta.url), 'utf8');
const demoWorkbenchSource = readFileSync(
  new URL('./socialContent/AgentTaskDemoWorkbench.tsx', import.meta.url),
  'utf8',
);

assert.match(
  studioSource,
  /const \[agentTaskViewMode, setAgentTaskViewMode\] = useState<'demo' \| 'edit'>\(\(\) => agentTaskDemoEntry \? 'demo' : 'edit'\)/,
  '从 Agent 任务进入内容制作时必须默认使用演示模式',
);
assert.match(
  productionEntrySource,
  /page:\s*["']smartAssets["'][\s\S]{0,300}agentTaskDemo:\s*true/,
  '从 Agent 任务详情打开制作工作台时必须显式标记演示入口',
);
assert.match(productionEntrySource, /agentTaskDemo:\s*true[\s\S]{0,100}socialContentTaskId:\s*card\.productionTaskId/,
  '演示入口必须继续绑定该真实生产任务');
assert.match(
  studioSource,
  /agentTaskDemoEntry && socialContentTaskId && agentTaskViewMode === 'demo'\) return <Suspense[\s\S]{0,180}<AgentTaskDemoWorkbench/,
  'Agent 任务上下文在演示模式下必须直接展示已有生产结果',
);
assert.match(
  studioSource,
  /<AgentTaskDemoWorkbench[\s\S]{0,1200}activeStep=\{agentTaskDemoStep\}[\s\S]{0,1200}onStepChange=\{setAgentTaskDemoStep\}/,
  '演示模式的生产结果必须可以在同一任务内直接切换',
);
assert.match(demoWorkbenchSource, /editableTitle=\{Boolean\(onTitleChange\)\}/, '演示模式必须沿用统一的可编辑草稿名称头部');
assert.match(studioSource, /onTitleCommit=\{\(\) => \{ void commitProjectTitle\(\); \}\}/, '演示模式修改草稿名称后必须使用统一的安全保存动作');

assert.match(demoWorkbenchSource, /aria-label="任务查看模式"/, '模式选择器必须有稳定的无障碍名称');
assert.match(demoWorkbenchSource, /<option value="demo">演示模式<\/option>/, '必须明确提供演示模式');
assert.match(demoWorkbenchSource, /<option value="edit">编辑模式<\/option>/, '必须明确提供编辑模式');
assert.match(
  demoWorkbenchSource,
  /event\.target\.value === 'edit'\) onEdit\(\)/,
  '选择编辑模式必须进入可手动修改的工作台',
);

for (const step of [0, 1, 2]) {
  assert.match(
    demoWorkbenchSource,
    new RegExp(`visibleStep === ${step}`),
    `演示工作台必须渲染第 ${step + 1} 步`,
  );
}
for (const resultLabel of ['有效口播', '有效音频', '有效分镜', '交付版本']) {
  assert.ok(
    demoWorkbenchSource.includes(resultLabel),
    `演示模式必须让用户看到“${resultLabel}”`,
  );
}
assert.match(demoWorkbenchSource, />上一步<\/button>/, '移除步骤条后必须保留底栏上一步导航');
assert.match(demoWorkbenchSource, />下一步<\/button>/, '移除步骤条后必须保留底栏下一步导航');
assert.match(demoWorkbenchSource, /onStepChange\(visibleStep [+-] 1\)/, '底栏导航必须切换当前任务的正文阶段');
assert.match(demoWorkbenchSource, /<audio[^>]+controls/, '演示模式必须能播放已有音频');
assert.match(demoWorkbenchSource, /<video[^>]+controls/, '演示模式必须能播放已有视频或成片');
assert.doesNotMatch(demoWorkbenchSource, /aspect-video/, '演示模式不得再把竖版内容塞进横版 16:9 预览框');
assert.equal((demoWorkbenchSource.match(/<StudioPreviewStage/g) || []).length, 3, '演示模式三个阶段必须共用稳定画幅预览');
assert.match(demoWorkbenchSource, /ratio=\{aspectRatio\}/, '演示模式的每个预览必须沿用当前项目画幅');
assert.match(studioSource, /<AgentTaskDemoWorkbench[\s\S]{0,1200}aspectRatio=\{ratio\}/, 'Agent 任务演示必须接收当前项目画幅');
assert.match(
  studioSource,
  /freeThreeStep && step === 'mode'[\s\S]{0,1600}<StudioPreviewStage ratio=\{ratio\}/,
  '自由创作入口的开场预览也必须沿用项目画幅',
);
assert.match(studioSource, /studioCreateRequest\.sourceContext\?\.aspectRatio[\s\S]{0,500}setRatio\(RATIOS\.reduce/, '新内容任务必须把已有参考画幅带入制作项目');

assert.match(
  studioSource,
  />确认修改并生成新版本</,
  '编辑模式的主操作必须说明会生成新版本',
);
assert.match(
  demoWorkbenchSource,
  /保留原版本并创建新的交付成片/,
  '确认修改前必须说明原版本会保留且会创建新的交付成片',
);

console.log('AiCreateStudio Agent task demo contract tests passed');
