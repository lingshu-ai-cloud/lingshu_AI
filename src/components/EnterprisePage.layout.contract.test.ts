import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(source, /<LsPageHeader/, '企业知识库不得为保存按钮单独占用页面头部');
assert.match(source, /<Tabs[\s\S]{0,700}tabBarExtraContent=[\s\S]{0,500}>\s*\{saveError \? '重试保存' : !hasUnsavedChanges \? '已保存' : '保存资料'\}/, '保存按钮必须位于企业资料一级标签行右侧');
assert.doesNotMatch(source, /事实版本 v/, '企业资料完整度不得显示内部事实版本号');

console.log('EnterprisePage layout contract tests passed');
