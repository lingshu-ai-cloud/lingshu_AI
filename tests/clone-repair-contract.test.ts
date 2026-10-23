import { readStudioApplicationSources, studioRouteBlock } from './fixtures/studioApplicationSources.js';
import assert from 'node:assert/strict';

// Offline guard against paid retries silently imposing unrelated product facts.
const source = readStudioApplicationSources();
const route = studioRouteBlock(source, "studioRouter.post('/script',");
assert.match(source, /generationMode !== 'clone' && !ctaSatisfied/);
assert.match(route, /generationMode === 'clone' \? scriptCreativeModeRule\('clone'\)/);
assert.match(route, /唯一允许作为产品与商业事实的来源（服务器读取的企业中心已确认资料）/);
assert.match(route, /不得新增产品事实、人物、镜头、CTA、场景或产品名称/);
assert.doesNotMatch(source, /当前产品资料只支持“无品牌瓶器、标签和外盒样品”/);
assert.match(source, /requiresMinimumVoiceoverLines\(voiceoverMode, generationMode\) && spokenLines.length < 2/);
assert.match(route, /generationMode === 'clone' \? '不得为了口播段数新增原片没有的台词。'/);
assert.match(source, /storyboardReferenceLeakIssues\(candidate, forbiddenTerms, forbiddenIndustryTerms\)/);
console.log('clone repair prompt contract tests passed');
