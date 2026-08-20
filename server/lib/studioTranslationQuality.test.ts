import assert from 'node:assert/strict';
import { normalizeStudioTranslationCandidate } from './studioTranslationQuality.js';

const source = `[0-3s] Buyers, how do you judge this risk?
[3-7s] Review the visible product before bulk order.
[7-10s] Send the quantity and packaging needs for a quote.`;

const spanish = normalizeStudioTranslationCandidate({
  source,
  sourceCode: 'en',
  target: 'es',
  candidate: `[0-3s] Compradores, ¿cómo evalúan este riesgo?
[3-7s] Revisen el producto visible antes de hacer un pedido grande.
[7-10s] Envíen la cantidad y las necesidades de embalaje para recibir una cotización.`,
});
assert.equal(spanish.ok, true);
assert.match(spanish.text, /^\[0-3s\] Compradores/m);

const arabic = normalizeStudioTranslationCandidate({
  source,
  sourceCode: 'en',
  target: 'ar',
  candidate: `[0-3s] أيها المشترون، كيف تقيّمون هذه المخاطر؟
[3-7s] راجعوا المنتج الظاهر قبل الطلب بالجملة.
[7-10s] أرسلوا الكمية ومتطلبات التغليف للحصول على عرض سعر.`,
});
assert.equal(arabic.ok, true);

const chinese = normalizeStudioTranslationCandidate({
  source,
  sourceCode: 'en',
  target: 'zh',
  candidate: `[0-3s] 买家们，你们会如何判断这个风险？
[3-7s] 大货下单前，请先核对眼前真实可见的产品。
[7-10s] 发来数量和包装需求，我们为你报价。`,
});
assert.equal(chinese.ok, true);

assert.equal(normalizeStudioTranslationCandidate({
  source,
  sourceCode: 'en',
  target: 'ar',
  candidate: source,
}).ok, false, 'Arabic output must contain Arabic instead of silently returning English');

assert.equal(normalizeStudioTranslationCandidate({
  source,
  sourceCode: 'en',
  target: 'es',
  candidate: `[0-3s] Revisa este producto.
[3-7s] Revisa este producto.
[7-10s] Revisa este producto.`,
}).ok, false, 'different source cues must not collapse into one repeated translation');

assert.equal(normalizeStudioTranslationCandidate({
  source,
  sourceCode: 'en',
  target: 'zh',
  candidate: `[0-3s] 买家们，你们会如何判断这个风险？
[3-7s] 大货下单前，请先核对产品。`,
}).ok, false, 'partial translations must not be reported as a complete language version');

console.log('studio translation quality tests passed');
