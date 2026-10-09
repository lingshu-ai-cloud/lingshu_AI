import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');

test('素材选择同时提供我的生成入口和生成类型筛选', () => {
  assert.match(source, /name: '我的生成'/);
  assert.match(source, /GENERATED_MATERIAL_KIND_FILTERS\.map/);
  assert.match(source, /matchesGeneratedMaterialKind\(c, generatedAssetFilter\)/);
});

test('生成素材分类读取统一投影而不是物理 folder', () => {
  assert.match(source, /generatedMaterialKindLabel\(c\)/);
  assert.doesNotMatch(source, /folder === ['"]generated['"]/);
});
