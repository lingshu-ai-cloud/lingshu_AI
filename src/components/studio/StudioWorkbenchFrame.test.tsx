import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioWorkbenchFrame } from './StudioWorkbenchFrame';

const html = renderToStaticMarkup(
  <StudioWorkbenchFrame
    projectTitle="爆款复刻 · 10月15日"
    onProjectTitleChange={() => {}}
    saveStatus={{ state: 'saved', savedAt: '23:14' }}
    activeStepId="production"
    objectTitle="分镜脚本"
    showObjectHeading={false}
    objectToolbar={<button type="button">切换预览</button>}
    objectPanel={<div>分镜内容</div>}
    propertyTitle="不应显示的属性标题"
    propertyPanel={<div>保留属性内容</div>}
    showPropertyHeading={false}
    timelinePanel={<div>时间轴内容</div>}
    primaryAction={{ label: '继续制作' }}
  >
    <div>画布内容</div>
  </StudioWorkbenchFrame>,
);

assert.ok(!html.includes('不应显示的属性标题'), '可单独隐藏右侧标题');
assert.ok(!html.includes('>分镜脚本</h2>'), '可删除左栏重复标题文案');
assert.ok(html.includes('保留属性内容'), '隐藏右侧标题时仍保留属性内容');
assert.ok(html.includes('studio-workbench-object-toolbar'), '预览切换移到左栏原标题位置');
assert.ok(!html.includes('studio-workbench-canvas-toolbar'), '中央画布不再为预览切换单独占行');
assert.ok(html.includes('studio-workbench-canvas-body'), '画布内容提供稳定布局类名');
assert.ok(html.includes('aria-label="展开内容时间轨"'), '时间轴使用画布右上角的单一展开按钮');
assert.ok(html.includes('absolute right-3 top-3'), '时间轴按钮不占用画布行高');
assert.ok(html.includes('w-40') && html.includes('tabular-nums'), '保存状态预留固定宽度并使用等宽数字');
assert.equal(html.match(/>已自动保存 23:14<\/span>/g)?.length, 1, '保存状态只在页头显示，不在底部重复提示');

console.log('Studio workbench keeps a stable header, moves preview controls left, and overlays timeline access');
