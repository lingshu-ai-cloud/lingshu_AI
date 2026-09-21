import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../lib/contentFormulas.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('./ContentFormulaAdminPage.tsx', import.meta.url), 'utf8');
const customerProgress = fs.readFileSync(new URL('./socialContent/SocialProductionProgressPanel.tsx', import.meta.url), 'utf8');
const customerEditor = fs.readFileSync(new URL('./socialContent/SocialTaskEditorDialog.tsx', import.meta.url), 'utf8');

for (const field of [
  'direction', 'visualStyle', 'strategy', 'sourceType', 'licenseVerified', 'licenseReference',
  'styleIntent', 'cover', 'headlineTemplate', 'materialFallback', 'risks', 'acceptanceGates',
  'shotType', 'shotSize', 'cameraMovement', 'composition', 'transition',
  'scriptTemplate', 'voiceoverTemplate', 'captionTemplate',
]) {
  assert.match(api, new RegExp(field));
}
for (const control of [
  '视频节奏', '视觉风格', '音乐情绪', '音乐音量', '音乐策略', '音乐来源', '音乐授权依据',
  '配音音色', '配音风格', '配音语速', '口播停顿', '字幕字号', '字幕底部位置', '字幕风格意图',
  '封面目标', '封面主体', '封面构图', '封面标题中文', '封面标题英文',
  '最少可用素材数', '允许静帧', '允许重复素材', '禁用表述', '禁用画面', '必须披露', '验收门槛',
  '拍摄环境', '画面方向', '最短秒数', '最长秒数', '镜头类型', '景别', '运镜', '转场', '构图说明',
]) {
  assert.match(page, new RegExp(control));
}
for (const template of ['脚本模板', '口播模板', '字幕模板']) {
  assert.match(page, new RegExp(template));
}
assert.match(page, /createContentFormula\(\{[^]*?direction:\s*\{[^]*?scriptTemplate:[^]*?voiceoverTemplate:[^]*?captionTemplate:/);
assert.match(page, /高级导演配置/);
assert.match(page, /镜头执行参数/);
assert.match(page, /directionSummary\(formula\.direction\)/);
assert.match(page, /查看导演配置/);
assert.match(page, /暂未配置爆款公式/);
assert.doesNotMatch(customerEditor + customerProgress, /视频节奏|音乐音量（0–100）|配音音色|字幕底部位置（8%–35%）/,
  'director formula controls must remain platform-admin-only');

console.log('content formula admin page contract tests passed');
