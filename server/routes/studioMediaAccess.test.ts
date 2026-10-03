import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.ASSET_ACCESS_SECRET = 'studio-media-access-test-secret';

const { refreshStudioProjectAssetUrls, studioProjectSpecForStorage } = await import('./studio.js');
const { verifyAssetToken } = await import('../lib/assetAccess.js');

const staleUrl = '/api/overseas/studio/private-assets/tts/example.wav?assetToken=stale.signature';
const source = {
  voiceoverUrl: staleUrl,
  voiceoverAudios: {
    zh: { url: staleUrl, duration: 6.8 },
    en: { url: '/api/overseas/studio/private-assets/tts/english.wav', duration: 8.2 },
  },
  unrelated: 'https://cdn.example.com/public.mp3?token=keep-me',
};

const stored = studioProjectSpecForStorage(source);
assert.equal(stored.voiceoverUrl, '/api/overseas/studio/private-assets/tts/example.wav');
assert.equal((stored.voiceoverAudios as any).zh.url, '/api/overseas/studio/private-assets/tts/example.wav');
assert.equal(stored.unrelated, source.unrelated);
assert.equal(source.voiceoverUrl, staleUrl, 'normalization must not mutate the caller spec');

const tenantId = 'tenant_media_test';
const refreshed = refreshStudioProjectAssetUrls(stored, tenantId);
for (const url of [refreshed.voiceoverUrl, (refreshed.voiceoverAudios as any).zh.url, (refreshed.voiceoverAudios as any).en.url]) {
  const parsed = new URL(String(url), 'http://local');
  const token = parsed.searchParams.get('assetToken');
  assert.ok(token, 'project reads must issue a fresh signed URL');
  assert.deepEqual(verifyAssetToken(token, parsed.pathname), { tenantId });
}
assert.equal(refreshed.unrelated, source.unrelated, 'public URLs must remain unchanged');

const studioUi = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');
const studioMediaPreviews = readFileSync(new URL('../../src/components/StudioMediaPreviews.tsx', import.meta.url), 'utf8');
const previewBlock = studioUi.slice(studioUi.indexOf('const startPreview = async'), studioUi.indexOf('// 离开预览步时停止播放'));
assert.match(previewBlock, /authenticatedAudioBlobUrl\(requestedVoiceUrl\)/, 'preview must authenticate and validate voiceover media before playback');
assert.match(previewBlock, /waitForStudioMediaReady\(voiceEl/, 'preview must wait for the voice track to become playable');
assert.match(previewBlock, /if \(!previewVideoReady\) return;/, 'the storyboard clock must wait for video readiness');
assert.doesNotMatch(previewBlock, /\.play\(\)\.catch\(\(\) => \{\}\)/, 'preview playback errors must not be swallowed');

const cloudMedia = readFileSync(new URL('../lib/cloudMaterials.ts', import.meta.url), 'utf8');
assert.match(cloudMedia, /playbackUrlCache/, 'cloud media playback URLs must be cached across range requests');
assert.match(cloudMedia, /playbackUrlRequests/, 'concurrent range requests must share one PocketBase token lookup');
assert.match(cloudMedia, /upstream\.status === 401 \|\| upstream\.status === 403/, 'expired PocketBase file tokens must refresh once');

console.log('studio media access checks passed');

const oldRenderUrl = '/api/overseas/publishing/local-videos/studio-example.mp4?assetToken=expired';
const savedOutput = studioProjectSpecForStorage({ languageRenderOutputs: { zh: { previewUrl: oldRenderUrl } } });
const stableRender = (savedOutput.languageRenderOutputs as any).zh.previewUrl;
assert.equal(stableRender, '/api/overseas/studio/local-renders/studio-example.mp4');
const freshOutput = refreshStudioProjectAssetUrls(savedOutput, tenantId);
const freshRender = new URL((freshOutput.languageRenderOutputs as any).zh.previewUrl, 'http://local');
assert.deepEqual(verifyAssetToken(freshRender.searchParams.get('assetToken'), freshRender.pathname), { tenantId });
const previewUi = studioUi.slice(studioUi.indexOf('/* ⑥ 成片预览 */'));
assert.match(previewUi, /RenderedVideoPlayer key=\{formalPreviewUrl\}/);
assert.match(previewUi, /onActivate=\{stopPreview\}/, 'rendered playback stops simulated narration and BGM');
assert.match(previewUi, /!formalPreviewUrl && previewIdx !== null && activePreviewCue/);
assert.match(studioMediaPreviews, /failedCover !== coverUrl/, 'broken uploaded covers must fall back to source media');
assert.match(studioUi, /assigned\.length \? assigned : selectedClips/, 'cover selection must prefer actual shot assignments over stale selected references');
assert.match(previewUi, /setRenderOutputPath\(generation\.status === 'done' \? generation\.path \|\| null : null\)/, 'failed output selection must clear the previous file path');
assert.match(previewUi, /downloadMp4\(activeOutputVersion\?\.output\?\.status === 'done'/, 'reopened drafts must reuse the selected export instead of rendering again');

const studioBackend = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const avatarImport = readFileSync(new URL('../lib/studioAvatarProduction.ts', import.meta.url), 'utf8');
assert.match(studioBackend, /studioRouter\.use\('\/production', createStudioAvatarProductionRouter\(store\)\)/, 'studio route must mount the validated avatar production service');
assert.ok(avatarImport.indexOf('await checkAvatarMedia(') < avatarImport.indexOf('await objectStorageUpload('), 'validate bytes before publishing them into the material store');
assert.match(avatarImport, /width: checked.width, height: checked.height/);
assert.doesNotMatch(avatarImport, /width: Math.round\(720/);

const refreshJobs = studioUi.slice(studioUi.indexOf('const refreshProductionJob = async'), studioUi.indexOf('const generateProductionAvatar = async'));
assert.match(refreshJobs, /productionRefreshInFlight\.current\.has\(id\)/, 'repeated refreshes must share one in-flight request');
assert.match(refreshJobs, /automaticAvatarRefreshes\(productionJobs, projectId/);
assert.match(refreshJobs, /finally[\s\S]*productionRefreshInFlight\.current\.delete\(id\)/, 'failed refreshes must release the UI request guard');
const adoptBlock = studioUi.slice(studioUi.indexOf('const adoptProductionCandidate ='), studioUi.indexOf('const createBoundShootingTask ='));
assert.match(adoptBlock, /avatarCandidateReady\(candidate, productionJobs\.filter/);
