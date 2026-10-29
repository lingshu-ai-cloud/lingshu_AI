import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCommercialClaims, unsupportedNumericClaims } from './studioGenerationTruthfulness.js';
import { productInfoSupportsNumericClaim } from './studioScriptQualityV2.js';

test('a product version followed by GUIANFA is not a claim about grams', () => {
  const copy = 'PERILLA MUD MASK 2.0\nGUIANFA\nSKU: GUIANFA-RS-002\n100 ml';
  assert.deepEqual(unsupportedNumericClaims(copy,'产品版本：2.0；净含量：100ml'),[]);
  assert.deepEqual(auditCommercialClaims(copy,'产品：紫苏泥膜2.0；品牌：GUIANFA；SKU: GUIANFA-RS-002；净含量：100ml').issues,[]);
  assert.equal(productInfoSupportsNumericClaim('2.0 g','产品版本：2.0\nGUIANFA'),false);
  assert.deepEqual(unsupportedNumericClaims('2.0GUIANFA\n2.0 GEL',''),[]);
});

test('real numeric specifications and absolute percentage promises remain checked', () => {
  assert.deepEqual(unsupportedNumericClaims('2.0 g','产品版本：2.0\nGUIANFA'),['2.0 g']);
  assert.deepEqual(unsupportedNumericClaims('100ml',''),['100ml']);
  assert.deepEqual(unsupportedNumericClaims('100\nml','净含量：100 ml'),[]);
  assert.deepEqual(unsupportedNumericClaims('100%pure',''),['100%']);
  assert.ok(auditCommercialClaims('100%pure','').issues.length > 0);
});
