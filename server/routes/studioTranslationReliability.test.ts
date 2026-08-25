import assert from 'node:assert/strict';
import {
  normalizeCompleteTimestampTranslation,
  normalizeTranslationTargetCodes,
} from './studio.js';

const manyTargets = ['en', 'es', 'ar', 'zh', 'ru', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'tr', 'ru', 'xx'];
assert.deepEqual(
  normalizeTranslationTargetCodes(manyTargets, 'en'),
  ['es', 'ar', 'zh', 'ru', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'tr'],
  '翻译目标不应再被限制为 8 个；同时应去重、排除源语言和未知语言',
);

const source = '[0-5s] Buyers, how do you judge this risk?\n[5-7s] Review the visible product.';
assert.equal(
  normalizeCompleteTimestampTranslation(source, '[0-5s] Покупатели, как вы оцениваете этот риск?\n[5-7s] Осмотрите представленный продукт.', 'ru'),
  '[0-5s] Покупатели, как вы оцениваете этот риск?\n[5-7s] Осмотрите представленный продукт.',
  '俄语逐行翻译必须通过完整性校验',
);
assert.equal(
  normalizeCompleteTimestampTranslation(source, '[0-5s] المشترون، كيف تقيّمون هذا الخطر؟\n[5-7s] راجعوا المنتج الظاهر.', 'ar'),
  '[0-5s] المشترون، كيف تقيّمون هذا الخطر؟\n[5-7s] راجعوا المنتج الظاهر.',
  '阿拉伯语逐行翻译必须通过完整性校验',
);

console.log('studio translation reliability tests passed');
