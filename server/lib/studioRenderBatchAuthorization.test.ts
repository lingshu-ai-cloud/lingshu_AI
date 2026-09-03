import assert from 'node:assert/strict';
import {
  parseTrilingualRenderBatchRequest,
  trilingualRenderBatchFingerprint,
} from './studioRenderBatchAuthorization.js';

const render = (language: string, query = 'first') => ({
  language,
  spec: {
    language,
    ratio: '9:16',
    duration: 15,
    voiceoverUrl: `/tts/tenants/tenant-a/${language}.wav?sig=${query}`,
    timeline: [{ clipId: `clip-${language}`, name: language, url: `https://browser.invalid/${language}.mp4?sig=${query}`, targetDuration: 15 }],
  },
});

const parsed = parseTrilingualRenderBatchRequest({
  batchKey: 'p1-render:12345678',
  sourceProjectId: 'project-1',
  renders: [render('es'), render('zh'), render('en')],
});
assert.deepEqual(parsed.renders.map(item => item.language), ['zh', 'en', 'es']);
assert.ok(parsed.renders.every(item => item.spec.sourceProjectId === 'project-1'));
const fingerprint = trilingualRenderBatchFingerprint(parsed);
const refreshedSignedUrls = parseTrilingualRenderBatchRequest({
  batchKey: parsed.batchKey,
  sourceProjectId: parsed.sourceProjectId,
  renders: [render('zh', 'second'), render('en', 'second'), render('es', 'second')],
});
assert.equal(trilingualRenderBatchFingerprint(refreshedSignedUrls), fingerprint, 'short-lived URL queries and browser timeline URLs are not semantic');
refreshedSignedUrls.renders[0]!.spec.duration = 14;
assert.notEqual(trilingualRenderBatchFingerprint(refreshedSignedUrls), fingerprint);

assert.throws(() => parseTrilingualRenderBatchRequest({
  batchKey: 'p1-render:12345678', sourceProjectId: 'project-1', renders: [render('zh'), render('en')],
}), /exactly three/);
assert.throws(() => parseTrilingualRenderBatchRequest({
  batchKey: 'p1-render:12345678', sourceProjectId: 'project-1', renders: [render('zh'), render('zh'), render('es')],
}), /duplicated/);
assert.throws(() => parseTrilingualRenderBatchRequest({
  batchKey: 'p1-render:12345678', sourceProjectId: 'project-1', renders: [render('zh'), render('en'), { ...render('es'), spec: { ...render('es').spec, sourceProjectId: 'other' } }],
}), /different source project/);

console.log('studio render batch authorization tests passed');
