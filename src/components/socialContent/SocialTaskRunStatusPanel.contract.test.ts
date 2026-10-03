import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SocialTaskRunStatusPanel.tsx', import.meta.url), 'utf8');

for (const label of ['预计生成耗时', '当前步骤', '系统正在做什么']) {
  assert.match(source, new RegExp(`\\['${label}'`), `运行页必须显示“${label}”`);
}
assert.match(source, /animate-spin[^]*?motion-reduce:animate-none/, '制作中必须有持续转动且兼容减少动态效果的状态环');
assert.match(source, /task\.productionProgress\?\.estimatedRemainingSeconds/, '预计耗时必须优先读取实时进度');
assert.match(source, /task\.productionProgress\?\.step/, '当前步骤必须读取实时进度');
assert.doesNotMatch(source, /task\.productionProgress\?\.activity/, '系统动作不得直接暴露后端技术性消息');
assert.match(source, /if \(step === '剪辑合成'\) return '正在剪辑并合成成片'/, '系统动作必须跟随实时步骤显示用户可读文案');
assert.match(source, /进入三栏制作台/, '运行中的爆款复刻必须可以直接进入完整三栏制作台');
assert.match(source, /onOpenWorkbench/, '三栏制作台入口必须由任务页注入并保留当前任务上下文');
assert.doesNotMatch(source, /编导 Agent|内容 Agent|模型|供应商|队列编号|任务 ID|运行 ID/, '普通运行页不得暴露技术实现');

console.log('social task run status frontend contract passed');
