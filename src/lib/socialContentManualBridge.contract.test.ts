import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const traffic = readFileSync(new URL('../components/TrafficPage.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../components/AiCreateStudio.tsx', import.meta.url), 'utf8');
const navigationHook = readFileSync(new URL('../components/socialContent/useSocialContentNavigation.ts', import.meta.url), 'utf8');
const submissionHook = readFileSync(new URL('../components/socialContent/useStudioSocialArtifactSubmission.ts', import.meta.url), 'utf8');
const boundary = readFileSync(new URL('../../server/starter198/legacyBoundary.ts', import.meta.url), 'utf8');
const socialOutputs = readFileSync(new URL('../../server/starter198/socialContentOutputs.ts', import.meta.url), 'utf8');

assert.match(
  app,
  /readSocialContentNavigationTaskId\(page, window\.history\.state\)[\s\S]*?socialContentTaskId=\{activeSocialContentTaskId\}/,
  'the active task must come from the exact page navigation handoff',
);
assert.match(
  traffic,
  /useSocialContentNavigation\(onNavigate, socialContentTaskId\)[\s\S]*?<AiCreateStudio[\s\S]*?socialContentTaskId=\{socialContentTaskId\}/,
  'social navigation must preserve and explicitly pass the task id into the studio',
);
assert.match(navigationHook, /attachSocialContentNavigationState\(taskId, nextPage\)/);
assert.match(studio, /useStudioSocialArtifactSubmission\(\{/);
assert.match(submissionHook, /submitManualSocialArtifact\(taskId, snapshot\)/);
assert.match(studio, /primarySubmitsSocialArtifact[\s\S]*?'提交确认'/);
assert.match(
  studio,
  /enabled:\s*Boolean\(socialContentTaskId[\s\S]{0,220}socialPosterArtifactReady[\s\S]{0,220}socialVideoArtifactReady/,
  'task submission must be enabled by a browser-readable image or video rather than draft metadata or a filesystem path',
);
assert.match(
  studio,
  /primaryGeneratesPoster[\s\S]{0,180}socialPosterArtifactReady/,
  'a task poster with copy but no image must retain its generation action',
);
assert.match(
  studio,
  /primaryGeneratesVideo[\s\S]{0,220}socialContentTaskId[\s\S]{0,120}!socialVideoMediaReady/,
  'a desktop-only task output must retain a path to generate a browser-readable video',
);
assert.match(studio, /renderSelectedLanguageVersion\(undefined, Boolean\(socialContentTaskId\)\)/,
  'task video recovery must request a server-readable preview without changing the legacy render path');
assert.match(studio, /outputUrl:\s*contentMode === 'poster' \? posterImageUrl : workbenchFormalPreviewUrl/,
  'video submission must use the resolved readable preview rather than a local output path');
assert.match(studio, /generationProvenance:\s*contentMode === 'poster'[\s\S]{0,500}generationRecordId:/,
  'Studio task submissions must carry their generation provenance and record identity');
assert.match(studio, /manualScriptDraft\(item, (?:cleaned|value|nextScript)\)/,
  'manual timeline/script edits must invalidate the previously verified generation record');
assert.match(submissionHook, /submitManualSocialArtifact\(taskId, snapshot\)/);
assert.match(socialOutputs, /createSocialContentArtifact[\s\S]{0,500}assertStudioSocialArtifactGeneration/,
  'the server must validate Studio generation metadata on artifact ingest');
assert.match(socialOutputs, /decision === 'approved'[\s\S]{0,200}assertStudioSocialArtifactGeneration/,
  'the server must revalidate Studio generation metadata on approval');
assert.match(socialOutputs, /artifact\.status !== 'approved'[\s\S]{0,200}assertStudioSocialArtifactGeneration/,
  'the server must revalidate Studio generation metadata while packaging delivery');
assert.doesNotMatch(studio, /new CustomEvent\('lingshu:navigate'/,
  'Studio must not bypass its task-aware navigation callback');
assert.match(studio, /onNavigate\?\.\('socialInspiration'\)/);
assert.match(studio, /onNavigate\?\.\('enterprise'\)/);
assert.doesNotMatch(
  boundary,
  /(?:\/studio|\/videos|\/enterprise|\/publishing).*allow/i,
  'the manual bridge must not broadly open legacy write families',
);

console.log('social content manual bridge contract tests passed');
