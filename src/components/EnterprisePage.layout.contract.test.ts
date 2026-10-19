import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(source, /<LsPageHeader/, '企业知识库不得为保存按钮单独占用页面头部');
assert.match(source, /<Tabs[\s\S]{0,700}tabBarExtraContent=[\s\S]{0,500}>\s*\{saveError \? '重试保存' : !hasUnsavedChanges \? '已保存' : '保存资料'\}/, '保存按钮必须位于企业资料一级标签行右侧');
assert.doesNotMatch(source, /事实版本 v/, '企业资料完整度不得显示内部事实版本号');
assert.match(source, /enterpriseArea === 'facts' && <section[^>]+aria-label="企业资料完整度"/, '企业资料完整度只应出现在企业真实资料页');
assert.doesNotMatch(source, /设置客服边界|打开灵小枢快速采集/, '客服规范页不得重复显示快速采集提示条');
assert.match(source, /<Collapse[\s\S]{0,500}enterprise-advanced-collapse/, '低频高级设置应折叠收纳，避免多层卡片嵌套');

console.log('EnterprisePage layout contract tests passed');
