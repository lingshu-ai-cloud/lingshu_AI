import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { IMAGE_LANGUAGES, imageLanguageSchema, normalizeImageLanguage, type ImageLanguage } from '../../shared/contracts/imageLanguages';
import { assistantCreationPortalSchema } from '../../shared/contracts/assistantCreationPortal';
import { assistantImageReplicationPortal } from '../../src/components/assistant/assistantImageReplicationIntent';
import { createImageReplicationDraft } from '../../src/lib/imageReplicationDraft';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import type { SocialImageLayer } from '../../shared/contracts/socialImageLayerGraph';
import { defaultSocialImageTask } from './socialImageTask';
import { neutralSocialImageCopy } from './socialImageLanguageCopy';
import { textLayerSvg } from './layerRenderer';
import { buildStudioSocialImagePaidPrompt } from './socialImagePaidRenderAdmission';

test('all product languages survive intake, task creation, image run and fallback copy', async () => {
  assert.equal(Object.keys(IMAGE_LANGUAGES).length, 13);
  for (const code of Object.keys(IMAGE_LANGUAGES) as ImageLanguage[]) {
    const copy = neutralSocialImageCopy(code);
    for (const text of Object.values(copy)) assert.ok(text.trim());
    if (code !== 'en') assert.notEqual(copy.caption, neutralSocialImageCopy('en').caption, code);
    const intake = { step: 2, productId: 'p', objective: '独立包装', audience: '品牌采购', callToAction: '咨询',
      platform: 'instagram', aspectRatio: '4:5', language: code, submitted: false };
    const portal = assistantImageReplicationPortal('复刻一张图文海报')!;
    assert.ok(assistantCreationPortalSchema.safeParse({ ...portal, imageReplication: { intake } }).success, code);
    let writes = 0;
    const result = await createImageReplicationDraft({
      draft: { reference: { url: '/reference.png', title: '参考' }, product: { id: 'p', name: '产品' },
        objective: '独立包装', audience: '品牌采购', platform: 'instagram', aspectRatio: '4:5', language: code, callToAction: '咨询' },
      operationKey: `language-${code}`, entrySource: 'assistant', isCurrent: () => true,
      ports: {
        createTask: async value => { writes++; assert.deepEqual(value.languages, [code]); return { taskId: 'content', version: 'v1' } as SocialContentTaskDetail; },
        createOrResumeRun: async () => { const task = defaultSocialImageTask({ creationPath: 'viral_replication' }); task.deliverySpec.language = code; return { task }; },
        updateTask: async (task, patch) => ({ task: { ...task, ...patch } }),
      },
    });
    assert.equal(writes, 1); assert.equal(result.deliverySpec.language, code);
    const prompt = buildStudioSocialImagePaidPrompt({ sceneIntent: 'Neutral product presentation', ratio: '4:5',
      poster: copy, language: code, deliverableType: 'social_poster', productionStrategy: 'reference_generate',
      referenceRoleText: '', benchmarkCount: 1, ownedReferenceCount: 1 });
    assert.ok(prompt.includes(`Output language: ${code}`));
    assert.ok(prompt.includes(copy.headline));
  }
});

test('regional aliases normalize but unsupported languages are rejected', () => {
  assert.equal(normalizeImageLanguage('es-MX'), 'es');
  assert.equal(normalizeImageLanguage('阿拉伯语'), 'ar');
  assert.equal(imageLanguageSchema.safeParse(normalizeImageLanguage('unknown-language')).success, false);
});

test('Arabic layers use RTL, Japanese/Korean wrap without English word-spacing assumptions', async () => {
  const layer: SocialImageLayer = { id: 'headline', kind: 'text', zIndex: 1,
    rect: { x: 0, y: 0, width: 1, height: 1 }, styleToken: 'reference-adaptive-headline' };
  const arabic = textLayerSvg({ ...layer, content: neutralSocialImageCopy('ar').headline }, 720, 240, '#ffffff');
  assert.match(arabic.toString(), /direction="rtl"/); assert.match(arabic.toString(), /x="716"/);
  for (const content of ['製品とパッケージをご紹介します', '제품과포장을확인해보세요']) {
    const svg = textLayerSvg({ ...layer, content }, 240, 400, '#ffffff');
    assert.ok((svg.toString().match(/<tspan/g) || []).length > 1);
    const meta = await sharp(await sharp(svg).png().toBuffer()).metadata();
    assert.equal(meta.width, 240); assert.equal(meta.height, 400);
  }
  const metadata = await sharp(await sharp(arabic).png().toBuffer()).metadata();
  assert.equal(metadata.width, 720);
});
