import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WeeklyMissingInputAction, { firstMissingEnterpriseField, weeklyMissingInputKind } from './WeeklyMissingInputAction';
import { displayWeeklyReadinessText } from '../../lib/weeklyReadinessGuidance';

test('enterprise supplement asks only for the first genuinely missing field', () => {
  assert.equal(firstMissingEnterpriseField({ company: { name: '', industry: '美妆', description: '护肤' }, brand: { name: 'A', tone: '专业' } })?.label, '企业名称');
  assert.equal(firstMissingEnterpriseField({ company: { name: 'A', industry: '美妆', description: '护肤' }, brand: { name: 'B' } })?.label, '品牌表达风格');
  assert.equal(firstMissingEnterpriseField({ company: { name: 'A', industry: '美妆', description: '护肤' }, brand: { name: 'B', tone: '专业' } }), null);
});

test('missing-input reply selects the actual first gap instead of a generic navigation', () => {
  const text = '本周计划还没有开始。当前需要处理：企业名称与主营资料。\n\n先补齐企业与品牌资料。点击下方入口即可在这里处理。';
  assert.equal(weeklyMissingInputKind(text), 'company');
  assert.equal(weeklyMissingInputKind('本周计划还没有开始。你更新了企业资料，这份计划还没同步到最新内容。点击“同步周计划”，我会更新这份计划。'), 'facts');
  assert.equal(weeklyMissingInputKind('本周计划还没有开始。制作资料已齐。'), null);
  assert.equal(weeklyMissingInputKind(displayWeeklyReadinessText('本周计划还没有开始。当前不是缺少某个企业资料输入框，而是计划引用的资料版本与已确认的企业资料版本不一致。先核对企业与品牌资料。')), 'facts');
  const html = renderToStaticMarkup(createElement(WeeklyMissingInputAction, { kind: 'company' }));
  assert.match(html, /补齐企业与品牌资料/);
  assert.doesNotMatch(html, /立即补齐第一项资料|跳转/);
  assert.match(renderToStaticMarkup(createElement(WeeklyMissingInputAction, { kind: 'facts' })), /同步周计划/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(WeeklyMissingInputAction, { kind: 'facts' })), /核对企业与品牌资料|新建周目标/);
});

test('other gaps have specific actions and material upload stays in the conversation', () => {
  assert.equal(weeklyMissingInputKind('本周计划还没有开始，因为制作资料还缺：主推产品资料和图片。先补齐主推产品资料和图片。'), 'products');
  assert.equal(weeklyMissingInputKind('本周计划还没有开始，因为制作资料还缺：可用的数字人物与声音。先录入数字人物与声音。'), 'presenter');
  assert.match(renderToStaticMarkup(createElement(WeeklyMissingInputAction, { kind: 'presenter' })), /录入数字人/);
  assert.equal(weeklyMissingInputKind('本周计划还没有开始，因为制作资料还缺：对应镜头可用的视频素材。先上传对应镜头的视频素材。'), 'materials');
  assert.equal(weeklyMissingInputKind('本周计划还没有开始。以下视频镜头还缺可用实拍。先补充视频素材。'), 'materials');
  const materialHtml = renderToStaticMarkup(createElement(WeeklyMissingInputAction, { kind: 'materials' }));
  assert.doesNotMatch(materialHtml, /<button[^>]*>补充视频素材<\/button>/);
  assert.doesNotMatch(materialHtml, /打开素材库|跳转/);
});
