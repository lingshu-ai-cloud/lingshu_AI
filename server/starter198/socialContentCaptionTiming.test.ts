import test from 'node:test';import assert from 'node:assert/strict';import {assertMeasuredCaptionTiming} from './socialContentCaptionTiming.js';
test('actual cue boundaries retain pauses and the final spoken word in a 38 second film',()=>{
 const measured=[{start:.12,end:2.7,text:'First line.'},{start:5.4,end:8.2,text:'A pause stays silent.'},{start:36.1,end:37.96,text:'Contact us.'}];
 const result=assertMeasuredCaptionTiming({measured,captions:structuredClone(measured),duration:38});assert.equal(result.maxBoundaryErrorSeconds,0);assert.equal(result.lastCueEnd,37.96);
 assert.throws(()=>assertMeasuredCaptionTiming({measured,captions:measured.map((c,i)=>i===1?{...c,start:2.7}:c),duration:38}),/drift/);
 assert.throws(()=>assertMeasuredCaptionTiming({measured,captions:measured.map((c,i)=>i===2?{...c,end:38.4}:c),duration:38}),/changed/);
 assert.throws(()=>assertMeasuredCaptionTiming({measured,captions:measured.map(c=>({...c,start:c.start+.25,end:c.end+.25})),duration:39}),/drift/);
});
