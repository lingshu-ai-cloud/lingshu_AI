import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studioSource = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const digitalEmployeeSource = readFileSync(new URL('./DigitalEmployeePage.tsx', import.meta.url), 'utf8');
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
  digitalEmployeeSource,
  /page:\s*["']smartAssets["'][\s\S]{0,300}agentTaskDemo:\s*true/,
  '从 Agent 任务详情打开制作工作台时必须显式标记演示入口',
);
assert.match(
  studioSource,
  /agentTaskDemoEntry && socialContentTaskId && agentTaskViewMode === 'demo'\) return <AgentTaskDemoWorkbench/,
  'Agent 任务上下文在演示模式下必须直接展示已有生产结果',
);
assert.match(
  studioSource,
  /<AgentTaskDemoWorkbench[\s\S]{0,1200}activeStep=\{agentTaskDemoStep\}[\s\S]{0,1200}onStepChange=\{setAgentTaskDemoStep\}/,
  '演示模式的三个步骤必须可以在同一任务结果内直接切换',
);

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
assert.match(demoWorkbenchSource, /<audio[^>]+controls/, '演示模式必须能播放已有音频');
assert.match(demoWorkbenchSource, /<video[^>]+controls/, '演示模式必须能播放已有视频或成片');

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
