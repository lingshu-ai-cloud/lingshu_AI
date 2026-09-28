import assert from 'node:assert/strict';
import { parseProofreadNarration } from './referenceNarration.js';
const result = parseProofreadNarration(JSON.stringify({sentences:[{text:'Whitening cream and liquid foundation.'}],products:['Whitening cream','liquid foundation','invented serum'],brands:['FakeCo'],uncertainties:[],removedFragments:[]}));
assert.deepEqual(result.products,['Whitening cream','liquid foundation']);
assert.deepEqual(result.brands,[]);
assert.throws(()=>parseProofreadNarration('{"sentences":[]}'));
console.log('reference narration correction regression passed');
const { alignNarrationSentences } = await import('./referenceNarration.js');
const aligned = alignNarrationSentences([{text:'Cream and oil.'},{text:'Contact us.'}], [
  {start:1,end:1.4,text:'Cream'}, {start:1.5,end:1.6,text:'and'}, {start:1.7,end:2,text:'oil.'},
  {start:3,end:3.5,text:'Contact'}, {start:3.6,end:4,text:'us.'},
]);
assert.equal(aligned[0].start,1);
assert.equal(aligned[0].end,2);
assert.equal(aligned[1].start,3);
assert.equal(aligned[0].words.length,3);
assert.throws(()=>alignNarrationSentences([{text:'invented words'}], [{start:1,end:2,text:'actual words'}]));
