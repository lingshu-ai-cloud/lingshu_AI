import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import SocialCreationWorkbench, { parseFreeCreationScript, serializeFreeCreationLines } from './SocialCreationWorkbench';

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
assert.ok(freeHtml.includes('创意与口播确认'));
assert.ok(freeHtml.includes('主推产品 · 多选'));
assert.ok(freeHtml.includes('暂不指定'));
assert.ok(freeHtml.includes('上传素材'));
assert.ok(freeHtml.includes('素材库'));
assert.ok(freeHtml.includes('AI 生成'));
const workbenchSource = fs.readFileSync(new URL('./SocialCreationWorkbench.tsx', import.meta.url), 'utf8');
assert.match(workbenchSource, /在第一页生成 AI 钩子/);
assert.match(workbenchSource, /确认费用并生成/);
assert.match(workbenchSource, /Seedream 首帧/);
assert.match(workbenchSource, /Seedance 4 秒 480p/);
assert.doesNotMatch(workbenchSource, /AI 钩子将在第二页生成/);
assert.match(workbenchSource, /draggable onDragStart=/, 'free creation shot cards must support direct drag sorting');
assert.match(workbenchSource, /事实来源：/, 'each free creation shot card must expose its enterprise fact source');
assert.ok(freeHtml.includes('Gemini 生成逐句口播与分镜'));
assert.ok(!freeHtml.includes('还在为内容拍摄和剪辑反复返工吗'));
assert.ok(!freeHtml.includes('可选的一句话要求'));
assert.ok(!freeHtml.includes('生成或沿用逐句口播'));

const parsed = parseFreeCreationScript('[0–4s]\n画面：产品特写\n台词：看看这款面膜\n\n[4–8s]\n画面：工厂生产线\n台词：（无口播）');
assert.equal(parsed.length, 2);
assert.equal(parsed[0]?.hook, true);
assert.equal(parsed[1]?.shotType, '工厂');
assert.equal(parsed[1]?.silent, true);
assert.match(serializeFreeCreationLines(parsed), /镜头类型：工厂/);

const d2cParsed = parseFreeCreationScript('[0–4s]\n画面：消费者上脸涂抹面霜并展示使用效果\n台词：（无口播）');
assert.equal(d2cParsed[0]?.shotType, 'D to C');
