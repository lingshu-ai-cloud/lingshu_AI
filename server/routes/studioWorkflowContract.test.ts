import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');

assert.match(source, /useState<'unselected' \| 'none' \| 'ai' \| 'upload'>\('unselected'\)/);
assert.match(source, /scriptStageTab === 'theme'[\s\S]*setScriptStageTab\('voiceover'\)/);
assert.match(source, /scriptStageTab === 'voiceover'[\s\S]*setScriptStageTab\('audio'\)/);
assert.match(source, /storyboardSlots\.length > 0 && assignedCount === storyboardSlots\.length/);
assert.match(source, /voiceoverMode === 'unselected'[\s\S]*请先选择声音策略/);
assert.match(source, /if \(m\.id !== mode\)[\s\S]*setScriptStageTab\('theme'\)[\s\S]*setVoiceoverMode\('unselected'\)/);

console.log('studio workflow contract passed');
