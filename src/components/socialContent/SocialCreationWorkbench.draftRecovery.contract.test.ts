import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useSocialCreationWorkbenchController.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('./SocialCreationWorkbench.tsx', import.meta.url), 'utf8');
assert.match(view, /useSocialCreationWorkbenchController\(\{ mode, seed, stageProfile, onGenerate \}\)/,
  'the view must use the controller whose draft and task recovery are checked below');

assert.match(source, /freeCreation: freeCreationState, script: freeScriptText, duration: desiredDuration/,
  'autosave must persist the generated script with the structured free-creation draft');
assert.match(source, /initialGeneration: freeGeneration \|\| undefined/,
  'autosave must retain the verified Gemini result needed to reopen the three-step workflow');
assert.match(source, /generatedVideo: freeHookMaterial \? \{/,
  'autosave must retain the selected hook material snapshot');
assert.match(source, /setFreeHookMaterial\(kickoff\?\.generatedVideo\?\.material \|\| null\)/,
  'draft recovery must restore the hook material as well as its identifier');
assert.match(source, /presenterAssetId = isReplication \? seed\?\.presenterAssetId \|\| taskPresenterAssetId : ''/,
  'replication must preserve the presenter selected by the product workflow');
assert.match(source, /draftProjectId: isReplication \? seed\?\.continueProjectId : resolvedDraftProjectId/,
  'replication must continue the task-bound Studio project');
assert.match(source, /!refreshed && initial\.referenceVideoAnalysis\?\.status !== 'ready'/,
  'opening a task whose canonical reference is already ready must not issue a mutating refresh');

console.log('free creation draft recovery contract tests passed');
