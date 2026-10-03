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
  /readSocialContentNavigationTaskId\(initialPage, window\.history\.state\)[\s\S]*?socialContentNavigation\?\.page === page[\s\S]*?socialContentTaskId=\{activeSocialContentTaskId\}/,
  'the active task must be initialized from the exact page handoff and remain page-scoped',
);
assert.match(
  app,
  /showSocialContentPlanning = page === 'smartAssets'[\s\S]{0,260}!smartAssetsCreateRequest[\s\S]*?<SocialContentPlanningPage[\s\S]*?: \([\s\S]*?<TrafficPage/,
  'a creation request must open Studio directly, while the generic entry may show the landing page',
);
assert.match(traffic, /kickoff\.source === 'inspiration_analysis'[\s\S]*?contentCreationRequest:[\s\S]*?creationPath: 'viral_replication'/,
  'an inspiration video must open the viral-replication task instead of dropping users on the generic content homepage');
assert.match(traffic, /kickoff\.source === 'inspiration_analysis'[\s\S]*?resumeOrCreateInspirationTask\([\s\S]*?directStudio: true,[\s\S]*?socialContentTaskId: taskId/,
  'an analyzed inspiration must create or resume its authoritative task before opening Studio');
assert.match(traffic, /referenceLinks: referenceUrl \? \[referenceUrl\] : \[\]/,
  'the inspiration handoff must preserve the selected reference URL');
assert.match(app, /setSmartAssetsCreateRequest\(detail\.contentCreationRequest \|\| null\)/);
assert.match(app, /studioCreateRequest=\{smartAssetsCreateRequest\}/);
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
assert.match(
  studio,
  /任务资料已带入统一制作工作台[\s\S]{0,300}不再选择旧制作路线/,
  'a bound social-content task must explain that it continues one unified workflow',
);
assert.match(studio, /socialContentTaskId \? \([\s\S]{0,500}已从任务带入[\s\S]{0,500}\) : \([\s\S]{0,500}视频模式/,
  'a bound task must keep the confirmed content type instead of asking the user to choose it again');
assert.match(studio, /socialContentTaskId \? \([\s\S]{0,500}任务产品[\s\S]{0,500}我的素材/,
  'a bound task must show its product binding instead of a second product selector');
assert.match(studio, /socialTaskProjectLookupDone[\s\S]*?studioApi\.listProjects\(\)[\s\S]*?list\.find\(item => item\.status !== 'template' && item\.spec\?\.socialContentTaskId === taskId\)[\s\S]*?loadProject\(project\)/,
  'refreshing a bound task must restore its latest saved production project before hydrating a fresh seed');
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
