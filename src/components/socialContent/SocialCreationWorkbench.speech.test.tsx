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
    { time: '5.60–11.19s', dialogue: 'Repairing masks.', visual: '灌装' },
    { time: '5.60–11.19s', dialogue: 'Repairing masks.', visual: '封口' },
    { time: '5.60–11.19s', dialogue: 'Repairing masks.', visual: '成品' },
  ] }}
  onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => {}}
/>);
assert.equal(sharedCueHtml.match(/text-text-primary">Repairing masks\.<\/span>/g)?.length, 1, 'one voice cue must render as one editable card');
assert.ok(sharedCueHtml.includes('覆盖 6 个分镜'));
assert.ok(sharedCueHtml.includes('aria-expanded="false"'), 'the six picture cuts start collapsed');
console.log('Replication speech is edited and confirmed on the first page');

const freeHtml = renderToStaticMarkup(<SocialCreationWorkbench
  mode="material_processing"
  onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => {}}
/>);
assert.ok(freeHtml.includes('上传指定开场钩子'));
assert.ok(freeHtml.includes('Gemini 生成逐句口播与分镜'));
assert.ok(!freeHtml.includes('还在为内容拍摄和剪辑反复返工吗'));
assert.ok(!freeHtml.includes('可选的一句话要求'));
assert.ok(!freeHtml.includes('生成或沿用逐句口播'));
