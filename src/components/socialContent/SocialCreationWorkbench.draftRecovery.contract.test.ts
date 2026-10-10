import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SocialCreationWorkbench.tsx', import.meta.url), 'utf8');

assert.match(source, /freeCreation: freeCreationState, script: freeScriptText, duration: desiredDuration/,
  'autosave must persist the generated script with the structured free-creation draft');
assert.match(source, /initialGeneration: freeGeneration \|\| undefined/,
  'autosave must retain the verified Gemini result needed to reopen the three-step workflow');
assert.match(source, /generatedVideo: freeHookMaterial \? \{/,
  'autosave must retain the selected hook material snapshot');
assert.match(source, /setFreeHookMaterial\(kickoff\?\.generatedVideo\?\.material \|\| null\)/,
  'draft recovery must restore the hook material as well as its identifier');

console.log('free creation draft recovery contract tests passed');
