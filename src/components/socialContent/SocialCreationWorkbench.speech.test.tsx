import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SocialCreationWorkbench from './SocialCreationWorkbench';

const html = renderToStaticMarkup(<SocialCreationWorkbench
  mode="viral_replication"
  seed={{ referenceTitle: '参考视频', referenceShots: [{ time: '0–1s', dialogue: 'Hello, boss!', visual: '产品展示' }] }}
  onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => {}}
/>);
assert.ok(html.includes('1 口播替换与确认'));
assert.ok(html.includes('2 分镜匹配与制作'));
assert.ok(html.includes('3 成片渲染和导出'));
assert.ok(html.includes('生成口播'));
assert.ok(!html.includes('第 1 句新口播'), '生成前不应提前展示可编辑的替换结果');
assert.ok(!html.includes('试听新口播'));
assert.ok(!html.includes('确认新口播'));

const sharedCueHtml = renderToStaticMarkup(<SocialCreationWorkbench
  mode="viral_replication"
  seed={{ referenceTitle: '参考视频', referenceShots: [
    { time: '5.60–11.19s', dialogue: 'Repairing masks.', visual: '包装' },
    { time: '5.60–11.19s', dialogue: 'Repairing masks.', visual: '粉体' },
    { time: '5.60–11.19s', dialogue: 'Repairing masks.', visual: '瓶身' },
  ] }}
  onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => {}}
/>);
assert.equal(sharedCueHtml.match(/text-text-primary">Repairing masks\.<\/span>/g)?.length, 1, 'one voice cue must render as one editable card');
assert.ok(sharedCueHtml.includes('覆盖 3 个分镜'));
console.log('Replication speech is edited and confirmed on the first page');
