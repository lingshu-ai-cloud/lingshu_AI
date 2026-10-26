import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeCaptionsAwayFromSourceText, socialSourceTextReview } from './socialSourceTextReview.js';
const evidence={text:'Visible text',source:'analysis_on_screen_text',spatialStatus:'unmeasured'};
const base={assets:[{id:'asset',segments:[{start:4,end:7,sourceTextEvidence:evidence}]}],
  scenes:[{sceneId:'scene',source:{assetId:'asset',sourceStart:3,sourceEnd:9}}],
  timeline:[{sceneId:'scene',targetStart:10,targetEnd:14,trimStart:5,trimEnd:7}],
  captionCues:[{start:11,end:12,text:'new caption'}]};
test('source text risk is clipped to actual source trim and mapped through speed into the scene',()=>{
 const result=socialSourceTextReview(base);assert.equal(result.length,1);
 assert.deepEqual(result[0],{sceneId:'scene',assetId:'asset',sourceStart:5,sourceEnd:7,targetStart:10,targetEnd:14,
  text:'Visible text',source:'analysis_on_screen_text',spatialStatus:'unmeasured',status:'review_required'});
 assert.equal('overlapConfirmed' in result[0]!,false);
 assert.deepEqual(placeCaptionsAwayFromSourceText([{start:11,end:12,text:'new caption'},{start:14,end:15,text:'later'}],result),
  [{start:11,end:12,text:'new caption',placement:'upper'},{start:14,end:15,text:'later'}]);
});
test('non-overlapping source or caption windows produce no conflict hint',()=>{
 assert.deepEqual(socialSourceTextReview({...base,assets:[{id:'asset',segments:[{start:0,end:5,sourceTextEvidence:evidence}]}]}),[]);
 assert.deepEqual(socialSourceTextReview({...base,captionCues:[{start:14,end:15,text:'after'}]}),[]);
 assert.deepEqual(socialSourceTextReview({...base,captionCues:[]}),[]);
});
test('legacy OCR, ambiguous subtitle/audio and absent ranges cannot become measured subtitle evidence',()=>{
 for(const segment of [{start:5,end:7,ocrText:'brand',subtitle:'heard speech'},
  {sourceTextEvidence:evidence},{start:5,end:7,sourceTextEvidence:{...evidence,source:'legacy_subtitle'}},
  {start:NaN,end:7,sourceTextEvidence:evidence}]){
  assert.deepEqual(socialSourceTextReview({...base,assets:[{id:'asset',segments:[segment]}]}),[]);
 }
});
test('measured evidence keeps a clear default band and uses the stable upper band when needed',()=>{
 const cue={start:11,end:12,text:'new caption'};
 const measured={...socialSourceTextReview(base)[0]!,source:'measured_caption_occupancy' as const,
  spatialStatus:'measured' as const,status:'avoided' as const};
 assert.deepEqual(placeCaptionsAwayFromSourceText([cue],[{...measured,placementDecision:'default'}]),[cue]);
 assert.deepEqual(placeCaptionsAwayFromSourceText([cue],[{...measured,placementDecision:'upper'}]),
  [{...cue,placement:'upper'}]);
 assert.deepEqual(placeCaptionsAwayFromSourceText([cue],[{...measured,status:'review_required',placementDecision:'unresolved'}]),
  [{...cue,placement:'upper'}]);
});
