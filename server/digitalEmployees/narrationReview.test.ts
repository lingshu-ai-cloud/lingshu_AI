import assert from 'node:assert/strict';
import { parseFinalNarrationReview } from './narration.js';
const spoken='Read the label. This product is clinically certified.';
assert.deepEqual(parseFinalNarrationReview(JSON.stringify({issues:[],advisories:['CTA can be stronger']}),spoken),[]);
assert.equal(parseFinalNarrationReview(JSON.stringify({issues:[{kind:'unsupported_claim',quote:'clinically certified',reason:'No certification is provided'}]}),spoken).length,1);
assert.throws(()=>parseFinalNarrationReview(JSON.stringify({issues:[{kind:'unsupported_claim',quote:'Free samples',reason:'Unconfirmed service'}]}),spoken),/可核验原句/);
assert.throws(()=>parseFinalNarrationReview(JSON.stringify({issues:[{kind:'platform',quote:'Read the label.',reason:'Improve pacing'}]}),spoken),/事实类别/);
assert.throws(()=>parseFinalNarrationReview(JSON.stringify({issues:['No factual issue, but improve CTA']}),spoken),/可核验原句/);
console.log('Narration review quoted evidence, advisory separation and malformed-result rejection passed');
