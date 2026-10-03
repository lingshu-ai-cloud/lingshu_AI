import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviseContent } from './contentRevision.js';
import { contentAcceptanceHash } from './contentAcceptance.js';
import { parseDirection, selectedSegments } from './contentDirection.js';
import { verifiedAudioCues } from '../integrations/qwenAlignment.js';
import { safeContentFile, projectOutputs } from '../routes/contentLibrary.js';
const spec:any={script:'approved script',lang:'en',duration:10,contentOrder:{videoPlan:{presenter:'heygen',voice:'v2'}},renderOutputPath:'/video.mp4',alignedCuesByLang:{en:[{start:0,end:4,text:'Hello world.'}]},sceneSourcePlan:[{assetId:'a'},{assetId:'b'},{assetId:'a'}],automation:{contentVersion:1,routePlan:{assetIds:['a','b']},renderOutputPath:'/video.mp4'},contentAcceptance:{approvedBy:'human'}};
assert.equal(reviseContent(spec,'music',{bgm:'music',volume:24}).automation.stage,'heygen');
const voice=reviseContent(spec,'voice',{voice:'v2',speed:1.1});assert.equal(voice.automation.stage,'voice_subtitles');assert.equal(voice.automation.heygenJobId,'');assert.equal(voice.contentAcceptance,null);
assert.equal(reviseContent(spec,'cover',{title:'Hello',frameTime:2}).renderOutputPath,'/video.mp4');
assert.equal(reviseContent(spec,'export',{ratio:'16:9',resolution:'720p'}).ratio,'16:9');
assert.throws(()=>reviseContent(spec,'music',{bgm:'x',volume:NaN}));
assert.throws(()=>reviseContent(spec,'subtitles',{cues:[{start:0,end:3,text:'Invented fact'}]}));
assert.throws(()=>reviseContent(spec,'subtitles',{cues:[{start:4,end:3,text:'Hello world.'}]}));
assert.equal(reviseContent(spec,'subtitles',{cues:[{start:1,end:4,text:'Hello world.'}],fontScale:1.2}).subtitleAlignmentSource,'human_reviewed');
assert.throws(()=>reviseContent(spec,'shots',{scenes:Array.from({length:3},()=>({source:'material',materialId:'foreign',trimStart:0}))}));
assert.notEqual(contentAcceptanceHash(spec),contentAcceptanceHash({...spec,subtitleStyle:{fontScale:1.2}}));
assert.throws(()=>parseDirection(JSON.stringify({voice:'v1',speed:1,scenes:[{source:'material',materialId:'a',trimStart:0,confidence:.2,reason:'unknown'}]}),1,['a'],'material'));
assert.throws(()=>selectedSegments([{id:'a',type:'video',duration:5}],[4],[{trimStart:2}]));
assert.equal(selectedSegments([{id:'a',type:'video',duration:8}],[4],[{trimStart:2}])[0].trimEnd,6);
const raw={transcripts:[{sentences:[{words:[{begin_time:100,end_time:500,text:'Hello'},{begin_time:600,end_time:1100,text:'world',punctuation:'.'}]}]}]};
assert.equal(verifiedAudioCues(raw,'Hello world.',2)[1].start,.6);
assert.throws(()=>verifiedAudioCues(raw,'Different content.',2));
const qwenSentenceTiming={transcripts:[{text:'Need a cloud foam cleansing honey? We support packaging, formula and design in one place. Choose your bottle, match your formula, add your brand design. Nolik starts from ten thousand pieces. Send us your project today.',sentences:[
  {begin_time:80,end_time:1440,text:'Need a cloud foam cleansing honey?',words:[{begin_time:80,end_time:400,text:'Need '},{begin_time:400,end_time:400,text:'a '},{begin_time:400,end_time:1440,text:'cloud foam cleansing honey',punctuation:'?'}]},
  {begin_time:1760,end_time:4160,text:'We support packaging, formula and design in one place.'},
  {begin_time:4640,end_time:7440,text:'Choose your bottle, match your formula, add your brand design.'},
  {begin_time:7760,end_time:9200,text:'Nolik starts from ten thousand pieces.'},
  {begin_time:9520,end_time:10400,text:'Send us your project today.'},
]}]};
const expectedVoice='Need a Cloud Foam Cleansing Honey? We support packaging, formula, and design in one place. Choose your bottle, match your formula, add your brand design. NOQ starts from 10,000 pieces. Send us your project today.';
const recoveredCues=verifiedAudioCues(qwenSentenceTiming,expectedVoice,13.52);
assert.equal(recoveredCues.length,5);
assert.deepEqual(recoveredCues[3],{start:7.76,end:9.2,text:'NOQ starts from 10,000 pieces.'});
assert.throws(()=>verifiedAudioCues(qwenSentenceTiming,'This is unrelated audio.',13.52));
const tenant='test-lifecycle-'+Date.now(),dir=path.resolve('data/publishing-uploads',tenant);fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'video.mp4');fs.writeFileSync(file,'fixture');
assert.equal(safeContentFile(tenant,file),file);assert.equal(safeContentFile('foreign',file),'');
const outside=path.join(os.tmpdir(),'lifecycle-'+Date.now());fs.writeFileSync(outside,'secret');fs.symlinkSync(outside,path.join(dir,'escape.mp4'));assert.equal(safeContentFile(tenant,path.join(dir,'escape.mp4')),'');
fs.rmSync(dir,{recursive:true});fs.unlinkSync(outside);
const outputs=projectOutputs({id:'p',title:'video',spec:{...spec,languageRenderOutputs:{en:{status:'done',path:'/video.mp4'}},revisionHistory:[{renderOutputPath:'/old.mp4',version:1}]}});assert.equal(outputs.length,2);assert.equal(outputs[1].current,false);
console.log('Content lifecycle: node revisions, timeline constraints, audio alignment, output history and tenant file boundaries passed');
