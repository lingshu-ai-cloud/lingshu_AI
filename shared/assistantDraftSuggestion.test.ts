import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantDraftSuggestion } from './assistantDraftSuggestion';

test('material follow-up becomes an editable intake draft without internal product codes', () => {
  const result = assistantDraftSuggestion('确认是否立即上传P4/P33/P20的实拍素材？');
  assert.equal(result.label, '补充产品实拍素材');
  assert.match(result.draft, /产品名称：/);
  assert.match(result.draft, /添加产品实拍视频或高清图片/);
  assert.doesNotMatch(result.label + result.draft, /P4|P33|P20|确认是否|是否需要/);
});

test('information follow-up provides a fillable product template using a real product name from context', () => {
  const result = assistantDraftSuggestion('是否需要我协助起草唇釉SKU的信息补录模板？', '“丝绒持色唇釉 04 枫糖棕”资料缺失。');
  assert.equal(result.label, '补录丝绒持色唇釉 04 枫糖棕信息');
  assert.match(result.draft, /产品名称：丝绒持色唇釉 04 枫糖棕/);
  assert.match(result.draft, /空白项保持待确认，不要自行补编/);
  assert.doesNotMatch(result.draft, /角鲨烷|FDA|18–2689/);
});

test('translation and lookup follow-ups remain direct drafts instead of yes-no prompts', () => {
  const english = assistantDraftSuggestion('生成英文版SKU补录模板？');
  assert.equal(english.label, '生成英文版产品补录模板');
  assert.match(english.draft, /未确认项保持空白/);
  const lookup = assistantDraftSuggestion('检查现有产品中是否存在近似唇釉替代SKU？');
  assert.equal(lookup.label, '检查现有产品中有无近似唇釉替代SKU');
  assert.doesNotMatch(lookup.label, /是否/);
});
