import assert from 'node:assert/strict';
import {
  draftFactualRiskSignals,
  hasInternalPromptLeak,
  requiresFactualVerification,
  unsupportedDraftNumbers,
  unsupportedHighRiskClaims,
} from './draftSafety.js';

const evidence = JSON.stringify({ buyerMessage: 'We need 500 pieces of model A12.' });

assert.deepEqual(unsupportedDraftNumbers('Got it — 500 pieces of A12.', evidence), []);
assert.deepEqual(unsupportedDraftNumbers('The MOQ is 1000 pieces.', evidence), ['1000']);
assert.deepEqual(unsupportedDraftNumbers('Got it — 50 pieces.', evidence), ['50']);
assert.equal(draftFactualRiskSignals('Great to hear from you again! How is the project going?', evidence).length, 0);
assert.equal(draftFactualRiskSignals("Don't worry—we can figure this out together.", evidence).length, 0);
assert.ok(draftFactualRiskSignals('This model is in stock and we can ship it tomorrow.', evidence).length >= 1);
assert.ok(draftFactualRiskSignals('We can customize the packaging for you.', evidence).includes('company capability commitment'));
assert.ok(draftFactualRiskSignals('Made from ABS, and the size is 20 cm.', evidence).includes('product attribute claim'));
assert.ok(draftFactualRiskSignals('Your order is on the way.', evidence).includes('order or logistics status claim'));
assert.ok(draftFactualRiskSignals('You mentioned that you preferred the black version.', evidence).includes('claimed conversation memory'));
assert.ok(draftFactualRiskSignals('Podemos entregar el pedido esta semana.', evidence).length >= 1);
assert.ok(draftFactualRiskSignals('هذا المنتج متوفر ويمكننا الشحن غدًا.', evidence).length >= 1);
assert.equal(requiresFactualVerification([], false), false);
assert.equal(requiresFactualVerification([], true), true);
assert.equal(requiresFactualVerification(['product attribute claim'], false), true);
const riskySessionDraft = 'We can send full lab reports and COA, and arrange third-party inspection at no extra charge.';
assert.ok(unsupportedHighRiskClaims(riskySessionDraft, '{}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims(riskySessionDraft, '{}').includes('free inspection promise is not grounded'));
assert.deepEqual(unsupportedHighRiskClaims('Tell me if you need GMP, ISO or COA and I will ask our team to verify.', '{}'), []);
assert.ok(unsupportedHighRiskClaims('I’ll get back to you by end of day today.', '{}').includes('deadline promise is not grounded'));
const roundTwoDraft = 'We’re a factory + trading company. We can send full lab reports and COA, and arrange a third-party inspection before shipment at no extra charge.';
assert.ok(unsupportedHighRiskClaims(roundTwoDraft, '{}').includes('company identity claim is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundTwoDraft, '{}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundTwoDraft, '{}').includes('free inspection promise is not grounded'));
const roundFiveDraft = 'We support Arabic + English packaging and we can provide GMP and ISO documents from accredited bodies.';
assert.ok(unsupportedHighRiskClaims(roundFiveDraft, '{}').includes('bilingual or Arabic packaging capability is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundFiveDraft, '{}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundFiveDraft, '{}').includes('certification validity claim is not grounded'));
assert.equal(hasInternalPromptLeak('Intent instruction: return one directly-sendable reply only.'), true);
assert.equal(hasInternalPromptLeak('Tell me the quantity you need and I’ll check it.'), false);

console.log('draft factual safety policy passed');

assert.ok(unsupportedHighRiskClaims('CE certification is available for IMH-ABS-01.', '{"products":[{"sku":"IMH-ABS-01"}]}').includes('CE certification availability is not grounded'));
assert.deepEqual(unsupportedHighRiskClaims('I will check whether CE certification is available.', '{}'), []);
assert.deepEqual(unsupportedHighRiskClaims('CE certification is not confirmed yet.', '{}'), []);
assert.deepEqual(unsupportedHighRiskClaims('CE certification is available.', '{"certifications":"CE"}'), []);

for (const name of ['CE', 'FCC', 'RoHS', 'ISO 9001', 'UL', 'REACH', 'GMP']) {
  assert.ok(unsupportedHighRiskClaims(`${name} certification is available.`, '{}').length > 0);
  assert.deepEqual(unsupportedHighRiskClaims(`Is ${name} certification available?`, '{}'), []);
  assert.deepEqual(unsupportedHighRiskClaims(`We will verify whether ${name} certification is available.`, '{}'), []);
  assert.deepEqual(unsupportedHighRiskClaims(`${name} certification is pending confirmation.`, '{}'), []);
  assert.deepEqual(unsupportedHighRiskClaims(`${name} certification is not available.`, '{}'), []);
  for (const evidence of [`${name} certification is not available`, `${name} pending verification`, `没有${name}认证`]) {
    assert.ok(unsupportedHighRiskClaims(`${name} certification is available.`, JSON.stringify({ company: evidence })).length > 0);
  }
  assert.deepEqual(unsupportedHighRiskClaims(`${name} certification is available.`, JSON.stringify({ certifications: name })), []);
  assert.deepEqual(unsupportedHighRiskClaims(`${name} certification is available.`, JSON.stringify({ company: `${name} certification is valid.` })), []);
}
assert.ok(unsupportedHighRiskClaims('Our product is FCC certified.', '{}').length > 0);
assert.ok(unsupportedHighRiskClaims('产品已获RoHS认证。', '{}').length > 0);
assert.deepEqual(unsupportedHighRiskClaims('产品尚未获得RoHS认证，需要核实。', '{}'), []);
assert.ok(unsupportedHighRiskClaims('ISO 14001 certification is available.', '{"certifications":"ISO 9001"}').length > 0);
assert.ok(unsupportedHighRiskClaims('CE certification is available.', '{"certifications":"CE","company":"CE certification is expired"}').length > 0);
assert.ok(unsupportedHighRiskClaims('CE certification is not confirmed; FCC certification is available.', '{}').some(value => value.startsWith('FCC')));

const differentSkuEvidence = JSON.stringify({ products: [{ sku: 'A-01', certifications: 'CE' }, { sku: 'B-02', material: 'ABS' }] });
assert.ok(unsupportedHighRiskClaims('CE certification is available for B-02.', differentSkuEvidence).length > 0);
assert.deepEqual(unsupportedHighRiskClaims('CE certification is available for A-01.', differentSkuEvidence), []);

assert.ok(unsupportedHighRiskClaims('Our product is CE certified.', differentSkuEvidence).length > 0);

assert.ok(unsupportedHighRiskClaims('We have CE certification, please confirm quantity.', '{}').length > 0);
assert.ok(unsupportedHighRiskClaims('CE certification is available and no samples are needed.', '{}').length > 0);
assert.ok(unsupportedHighRiskClaims('CE certification is available for SKUUNKNOWN.', '{"products":[{"sku":"A-01","certifications":"CE"}]}').length > 0);
assert.ok(unsupportedHighRiskClaims('CE certification is available for UNKNOWN-02.', '{"products":[{"sku":"A-01","certifications":"CE"}]}').length > 0);

assert.ok(unsupportedHighRiskClaims('CE认证可用。', '{}').length > 0);

const certificatePromise = 'CE certification for IMH-ABS-01 isn’t confirmed in our files yet — I’ll pull the exact certificate and match it to this ABS housing right away.';
assert.ok(unsupportedHighRiskClaims(certificatePromise, '{}').includes('quality document promise is not grounded'));
for (const verb of ['pull', 'get', 'retrieve', 'provide']) {
  assert.ok(unsupportedHighRiskClaims(`I’ll ${verb} the exact certificate.`, '{}').includes('quality document promise is not grounded'));
  assert.ok(unsupportedHighRiskClaims(`I’ll ${verb} the exact certificate.`, '{"certifications":"CE"}').includes('quality document promise is not grounded'));
}
assert.deepEqual(unsupportedHighRiskClaims('I’ll check whether the certificate exists.', '{}'), []);
assert.deepEqual(unsupportedHighRiskClaims('I’ll check our files for a certificate.', '{}'), []);
assert.ok(unsupportedHighRiskClaims('I’ll retrieve the certificate.', '{"company":"Certificate is not available"}').includes('quality document promise is not grounded'));
assert.deepEqual(unsupportedHighRiskClaims('I’ll retrieve the certificate.', '{"company":"We have the certificate on file."}'), []);
assert.deepEqual(unsupportedHighRiskClaims('I’ll retrieve the certificate.', '{"certificateDocument":"https://example.test/files/certificate.pdf"}'), []);

assert.ok(unsupportedHighRiskClaims('I’ll pull the exact certificate and verify it.', '{}').includes('quality document promise is not grounded'));

assert.ok(unsupportedHighRiskClaims('I’ll retrieve the CE certificate.', '{"company":"We have FCC certificate on file."}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims('I’ll retrieve the certificate for B-02.', '{"products":[{"sku":"A-01","certificate":"Certificate is on file"}]}').includes('quality document promise is not grounded'));

assert.ok(unsupportedHighRiskClaims('I’ll pull the CE certificate.', '{"company":"CE lab report is on file."}').includes('quality document promise is not grounded'));
for (const verb of ['pull', 'get', 'retrieve', 'send']) {
  assert.ok(unsupportedHighRiskClaims(`Let me ${verb} the exact certificate.`, '{}').includes('quality document promise is not grounded'));
}
assert.deepEqual(unsupportedHighRiskClaims('Let me check whether the certificate exists.', '{}'), []);

assert.deepEqual(unsupportedHighRiskClaims('CE certification isn’t available.', '{}'), []);
assert.ok(unsupportedHighRiskClaims('CE certification is available.', '{"company":"CE certification isn’t available."}').length > 0);
