import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');

assert.match(source, /shotType\?: FreeCreationShotType/,
  'free creation must persist the three supported shot classes');
assert.match(source, /manualWorkflow: mode !== 'clone'/,
  'free creation projects must be marked as manual workflows');
assert.match(source, /scriptVersion: stableScriptVersion\(script\)/,
  'the storyboard must keep the script version it derives from');
assert.match(source, /freeCanEnterPreview = freeThreeStep && \(renderReadiness\.ready \|\| freeVisualReady\)/,
  'step three must use render readiness while allowing TTS to be created there');
assert.match(source, /进入成片设置前请完成：/,
  'blocked navigation must explain the concrete missing requirements');
assert.doesNotMatch(source, /freeThreeStep && step === 'material'\) \{ setStepIdx\(activeSteps\.findIndex\(item => item\.id === 'preview'\)\)/,
  'free creation must not bypass readiness by directly switching to preview');

console.log('AiCreateStudio free workflow contract tests passed');
