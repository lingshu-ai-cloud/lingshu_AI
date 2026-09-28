import assert from 'node:assert/strict';
import { referenceBrandTerm, referenceProductMentions, referenceProductTerms, replaceReferenceIdentities } from './referenceIdentityMapping.js';

const slots = referenceProductTerms([
  { text: 'Try foundation and serum from OldBrand.', time: '0–3s' },
  { text: 'The foundation is light, and the serum absorbs quickly.', time: '3–6s' },
]);
assert.deepEqual(slots.map(slot => slot.sourceLabel), ['foundation', 'serum'], 'repeated mentions of one product need one mapping');
assert.equal(replaceReferenceIdentities('OldBrand foundation and serum; foundation again.', [
  { sourceTerm: 'foundation', productLabel: '新粉底' },
  { sourceTerm: 'serum', productLabel: '新精华' },
], { sourceTerm: 'OldBrand', brandLabel: '企业品牌' }), '企业品牌 新粉底 and 新精华; 新粉底 again.');
assert.deepEqual(referenceProductTerms([{ text: 'Try face cream and facial oil.' }]).map(slot => slot.sourceLabel),
  ['face cream', 'facial oil'], 'longest product names must not create extra slots');
assert.equal(referenceBrandTerm(['Try OldBrand foundation today.']), '', 'capitalization alone is not brand evidence');
assert.equal(referenceBrandTerm(['Whitening cream, liquid foundation.']), '', 'Whitening must not be treated as a brand');
assert.equal(referenceProductTerms([{ text: 'repairing mask, whitening cream, liquid foundation, anti-wrinkle essence, massage oil and shampoo' }]).length, 6);
assert.equal(referenceBrandTerm(['We are a foundation factory from China.']), '', 'country must not be mistaken for a brand');

// Full source-video ASR regression: repeated foundation mentions are not six SKUs.
const sourceSpeech = [
  { time: '0–3s', text: 'Are you too stuck with slow selling foundation?' },
  { time: '9–12s', text: "We're a 15-year foundation factory from China." },
  { time: '21–24s', text: 'Six thousand ready-made formulas. Whether you want.' },
  { time: '42–45s', text: 'Build your own foundation brand, full certificate.' },
  { time: '57–60s', text: 'Want to make a bestseller foundation? Reply foundation.' },
];
assert.equal(referenceProductTerms(sourceSpeech).length, 1);
assert.equal(referenceProductMentions(sourceSpeech).length, 5);
assert.equal(referenceProductMentions([...sourceSpeech, sourceSpeech[0]]).length, 5, 'visual shot duplicates must not inflate audio mention count');
assert.equal(referenceProductTerms([{ text: 'foundation, concealer, lipstick, serum, sunscreen and mascara' }]).length, 6, 'six genuinely different products must produce six mappings');
assert.equal(referenceProductMentions([{ text: 'face cream and facial oil' }]).length, 2);
console.log('Product identity regression checks passed');
