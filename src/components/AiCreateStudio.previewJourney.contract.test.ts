import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const studioSource = readAiStudioApplicationSources();
assert.match(
  studioSource,
  /index === 2 && !canEnterStoryboardRenderStep\(storyboardSlots\)/,
  '顶部步骤导航必须复用统一门禁，阻止无分镜时进入第三步',
);
assert.match(
  studioSource,
  /threeStepWorkflow && step === 'material' \? !storyboardSlots\.length/,
  '第二步底部入口必须在无分镜时禁用',
);

const panel = readFileSync(new URL('./studio/StudioPropertyPanelView.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('StudioPropertyPanelView.tsx', panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let previewPanelSource = '';
function visit(node: ts.Node) {
  if (ts.isConditionalExpression(node)
    && node.condition.getText(parsed) === "threeStepWorkflow && step === 'preview'"
    && node.whenTrue.getText(parsed).includes('aria-label="成片操作"')) previewPanelSource = node.whenTrue.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(previewPanelSource, '必须能定位第三步右栏的独立渲染分支');
assert.match(previewPanelSource, /aria-label="成片操作"/, '第三步右栏必须是单一成片操作区');
assert.match(previewPanelSource, />生成成片</, '第三步必须直接提供生成成片入口');
assert.match(previewPanelSource, /<details[^>]+aria-label="调整效果"[^>]*>[\s\S]*?<summary[^>]*>调整效果<\/summary>/,
  '第三步只能用一个折叠入口承载效果调整');
assert.equal((previewPanelSource.match(/<details\b/g) || []).length, 1,
  '第三步首层不能重新平铺多个设置卡片');
for (const removedTopLevelPanel of ['成片制作检查清单', '口播段落与镜头编排', '成片配音口播']) {
  assert.ok(!previewPanelSource.includes(removedTopLevelPanel),
    `第三步右栏不应继续展示“${removedTopLevelPanel}”顶级信息块`);
}

console.log('AiCreateStudio preview journey contract tests passed');
