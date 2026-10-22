import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const library = readFileSync(new URL('./studio/ShotMaterialLibraryDialog.tsx', import.meta.url), 'utf8');

test('素材选择同时提供我的生成入口和生成类型筛选', () => {
  assert.match(source, /<ShotMaterialLibraryDialog[\s\S]*?metadataSource: clip/, '实际分镜素材库必须收到完整生成元数据');
  assert.match(library, /我的生成/);
  assert.match(library, /GENERATED_MATERIAL_KIND_FILTERS\.map/);
  assert.match(library, /matchesGeneratedMaterialKind\(item\.metadataSource, generatedAssetFilter\)/);
});

test('生成素材分类读取统一投影而不是物理 folder', () => {
  assert.match(library, /generatedMaterialKindLabel\(item\.metadataSource\)/);
  assert.doesNotMatch(library, /folder === ['"]generated['"]/);
});
