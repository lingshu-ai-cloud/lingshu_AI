import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');

assert.match(source, /useState<'unselected' \| 'none' \| 'ai' \| 'upload'>\('unselected'\)/);
assert.match(source, /scriptStageTab === 'theme'[\s\S]*setScriptStageTab\('voiceover'\)/);
assert.match(source, /scriptStageTab === 'voiceover'[\s\S]*setScriptStageTab\('audio'\)/);
assert.match(source, /storyboardSlots\.length > 0 && assignedCount === storyboardSlots\.length/);
assert.match(source, /voiceoverMode === 'unselected'[\s\S]*请先选择声音策略/);
assert.match(source, /if \(m\.id !== mode\)[\s\S]*setScriptStageTab\('theme'\)[\s\S]*setVoiceoverMode\('unselected'\)/);

const apiSource = readFileSync(new URL('../../src/lib/studioApi.ts', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const scriptRoute = routeSource.slice(routeSource.indexOf("studioRouter.post('/script'"), routeSource.indexOf("studioRouter.post('/covers'"));
assert.match(apiSource, /\('script', \{ \.\.\.b, provider: 'qwen' \}/, 'script requests must override legacy Gemini preferences');
assert.match(scriptRoute, /const providerOpt = 'qwen' as const;/, 'server script generation must stay on Qwen');
assert.doesNotMatch(scriptRoute, /provider === 'gemini'|backend: 'gemini'/, 'script generation must not switch to Gemini');
assert.match(source, /分镜生成模型：千问（固定）/, 'UI must identify the actual fixed script backend');

console.log('studio workflow contract passed');
