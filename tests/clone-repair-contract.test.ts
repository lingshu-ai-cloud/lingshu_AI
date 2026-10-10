import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Offline guard against paid retries silently imposing unrelated product facts.
const source = readFileSync(new URL('../server/routes/studio.ts', import.meta.url), 'utf8');
assert.match(source, /generationMode !== 'clone' && !ctaSatisfied/);
assert.match(source, /generationMode === 'clone' \? '保留草稿的参考镜头结构/);
assert.match(source, /isPackagingOnlyProductInfo\(productInfo\) \? '- 当前资料只支持包装样品/);
assert.doesNotMatch(source, /当前产品资料只支持“无品牌瓶器、标签和外盒样品”/);
assert.match(source, /requiresMinimumVoiceoverLines\(voiceoverMode, generationMode\) \? '- 已选择 AI 口播/);
assert.match(source, /matchedIndustryLeaks\.join/);
console.log('clone repair prompt contract tests passed');
