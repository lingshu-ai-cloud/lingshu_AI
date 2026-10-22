import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');

assert.match(source, /useState<'unselected' \| 'none' \| 'ai' \| 'upload'>\('unselected'\)/);
assert.match(source, /scriptStageTab === 'theme'[\s\S]*setScriptStageTab\('voiceover'\)/);
assert.match(source, /scriptStageTab === 'voiceover'[\s\S]*setScriptStageTab\('audio'\)/);
assert.match(source, /storyboardSlots\.length > 0 && assignedCount === storyboardSlots\.length/);
assert.match(source, /voiceoverMode === 'unselected'[\s\S]*请先选择声音策略/);
assert.match(source, /appliedCreateRequestRef\.current = studioCreateRequest\.requestId;[\s\S]{0,250}setScriptStageTab\('theme'\);[\s\S]{0,120}setVoiceoverMode\('unselected'\);/, 'a fresh creation request must clear the previous script and voice strategy');

const apiSource = readFileSync(new URL('../../src/lib/studioApi.ts', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const scriptRoute = routeSource.slice(routeSource.indexOf("studioRouter.post('/script'"), routeSource.indexOf("studioRouter.post('/covers'"));
const materialsReadRoute = routeSource.slice(routeSource.indexOf("studioRouter.get('/materials'"), routeSource.indexOf("studioRouter.get('/materials/pb/"));
assert.match(apiSource, /post<StudioScriptResult>\('script', b,/, 'script requests must preserve the selected backend');
assert.match(scriptRoute, /generationMode !== 'clone' && provider === 'gemini' \? 'gemini' : 'qwen'/, 'free creation must use the requested Gemini backend while clone remains on Qwen');
assert.match(source, /provider: 'gemini'/, 'free creation must request Gemini');
assert.match(source, /口播由 Gemini 依据企业产品与钩子画面生成/, 'the live creation workbench must identify the script backend');
assert.doesNotMatch(materialsReadRoute, /startPendingLocalMaterialAnalyses|requestMaterialAnalysis|analyzeProductionMaterial/, 'opening the material library must remain read-only and never start full-library provider work');

console.log('studio workflow contract passed');
