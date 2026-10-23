import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import { readStudioApplicationSources } from '../../tests/fixtures/studioApplicationSources.js';
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

const studioUi = readAiStudioApplicationSources();
const studioMediaPreviews = readFileSync(new URL('../../src/components/StudioMediaPreviews.tsx', import.meta.url), 'utf8');
assert.match(studioUi, /const workbenchFormalPreviewUrl =/, 'formal preview must have an explicit current output source');
assert.match(studioUi, /<video[\s\S]{0,200}key=\{workbenchFormalPreviewUrl\}[\s\S]{0,100}src=\{workbenchFormalPreviewUrl\}/, 'the mounted player must use that output source');
assert.match(studioUi, /onLoadedMetadata=\{event => \{[\s\S]{0,350}video\.currentTime =/, 'formal playback must restore a bounded timeline position');

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
const unicodeOutput = studioProjectSpecForStorage({ renderOutputPreviewUrl: '/api/overseas/publishing/local-videos/微信成片.mp4' });
assert.equal(unicodeOutput.renderOutputPreviewUrl, '/api/overseas/studio/local-renders/微信成片.mp4');
const freshUnicodeRender = new URL(String(refreshStudioProjectAssetUrls(unicodeOutput, tenantId).renderOutputPreviewUrl), 'http://local');
assert.equal(decodeURIComponent(freshUnicodeRender.pathname), '/api/overseas/studio/local-renders/微信成片.mp4');
assert.deepEqual(verifyAssetToken(freshUnicodeRender.searchParams.get('assetToken'), freshUnicodeRender.pathname), { tenantId });
const previewUi = studioUi.slice(studioUi.indexOf('const workbenchFormalPreviewUrl ='));
assert.match(previewUi, /<video[\s\S]{0,200}key=\{workbenchFormalPreviewUrl\}[\s\S]{0,100}src=\{workbenchFormalPreviewUrl\}/, 'the live workbench must play the formal output URL');
assert.match(studioMediaPreviews, /failedCover !== coverUrl/, 'broken uploaded covers must fall back to source media');
assert.match(studioUi, /assigned\.length \? assigned : selectedClips/, 'cover selection must prefer actual shot assignments over stale selected references');
assert.match(studioUi, /if \(!response\.ok\) throw Error\('文件不可下载，请检查文件是否存在或已同步到服务器'\)/, 'failed downloads must not report success');
assert.match(studioUi, /catch \(error\) \{ setRenderDownloadMessage\(\(error as Error\)\.message\); \}/, 'failed downloads must surface the actual error');
assert.match(studioUi, /threeStepWorkflow && step === 'preview'\) \{ void downloadMp4\(\); return; \}/, 'the live export action must use the current download path');

const studioBackend = readStudioApplicationSources();
const bgmRoute = readFileSync(new URL('./studioBgmRoutes.ts', import.meta.url), 'utf8');
const localRenderRoute = studioBackend.slice(studioBackend.indexOf("studioRouter.post('/render/local'"), studioBackend.indexOf("// POST /studio/render/open-output"));
assert.match(localRenderRoute, /verifyRenderToken\(req\.body\?\.token\)/, 'local export must verify a server-issued token');
assert.match(localRenderRoute, /studioRenderManifestHash\(manifest\)/, 'local export must bind token to the exact manifest');
assert.match(localRenderRoute, /secureStudioRenderManifest\(manifest, tenantId/, 'local export must normalize and scope media before rendering');
assert.match(localRenderRoute, /requireVisualAssets: true/, 'local export must require every declared visual');
assert.match(studioBackend, /track && tenantId \? studioBgmMediaPath\(track, tenantId\) : null/, 'render route must select a tenant-scoped BGM stream URL');
assert.match(readFileSync(new URL('./studioRenderManifestProjection.ts', import.meta.url), 'utf8'),
  /bgm: \{ id: spec\.bgm \?\? null, url: absoluteAssetUrl\(base, bgmUrl\) \}/,
  'render manifest must resolve the selected tenant-scoped BGM stream URL');
assert.ok(studioBackend.indexOf('studioRouter.use(requireAuth)') < studioBackend.indexOf("studioRouter.use('/bgm', createStudioBgmRouter())"), 'BGM routes must mount under Studio authentication');
assert.ok(studioBackend.indexOf('studioTenantContext.run((res.locals as AuthLocals).tenantId, next)') < studioBackend.indexOf("studioRouter.use('/bgm', createStudioBgmRouter())"), 'BGM routes must inherit Studio tenant context');
assert.match(bgmRoute, /router\.get\('\/media\/:id'[\s\S]*?objectStorageGetObject\(key, req\.headers\.range\)/, 'cloud BGM must stream from storage through the authenticated route');
const openOutputRoute = studioBackend.slice(studioBackend.indexOf("studioRouter.post('/render/open-output'"), studioBackend.indexOf('/* ── 素材库', studioBackend.indexOf("studioRouter.post('/render/open-output'")));
assert.match(openOutputRoute, /safeStudioRenderOutputPath\(/, 'opening a render folder must enforce the tenant output boundary');
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
