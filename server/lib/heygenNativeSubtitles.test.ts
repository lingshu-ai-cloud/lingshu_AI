import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedHeyGenNativeSubtitleTiming,verifiedNativePhraseCues} from './heygenNativeSubtitles';
const srt='1\n00:00:00,500 --> 00:00:01,500\nHello world.\n\n2\n00:00:02,000 --> 00:00:03,800\nChoose your product.\n';
const input={srt,text:'Hello world. Choose your product.',sourceDuration:4,speed:2,targetDuration:5,duration:2.15};
test('original native SRT gives verified phrase timings after exact audio transform, without invented word timings',()=>{
 const timing=verifiedHeyGenNativeSubtitleTiming(input);assert.equal(timing.precision,'phrase');
 assert.deepEqual(timing.cues,[{start:.25,end:.75,text:'Hello world.'},{start:1,end:1.9,text:'Choose your product.'}]);
 assert.equal('words' in timing.result.transcripts[0]!.sentences[0]!,false);
});
test('native subtitle mismatch, overlap, invalid times and changed duration cannot pass alignment',()=>{
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,text:'Different words.'}),/口播文本不一致/);
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,srt:srt.replace('00:00:02,000','00:00:01,000')}));
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,srt:srt.replace('00:00:03,800','00:00:04,800')}),/range_invalid/);
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,srt:srt.replace('2\n','4\n')}),/sequence_invalid/);
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,duration:3}),/transform_changed/);
});

test('several supplier phrase fragments may form one sentence without invented word timing',()=>{
 const fragmented='1\n00:00:00,000 --> 00:00:00,700\nHello\n\n2\n00:00:00,700 --> 00:00:01,400\nworld. Choose\n\n3\n00:00:01,400 --> 00:00:02,200\nyour\n\n4\n00:00:02,200 --> 00:00:03,800\nproduct.\n';
 const measured=verifiedHeyGenNativeSubtitleTiming({...input,srt:fragmented});
 assert.equal(measured.cues.length,4);assert.equal(measured.precision,'phrase');
 assert.deepEqual(measured.cues,[{start:0,end:.35,text:'Hello'},{start:.35,end:.7,text:'world. Choose'},{start:.7,end:1.1,text:'your'},{start:1.1,end:1.9,text:'product.'}]);
 assert.deepEqual(verifiedNativePhraseCues(measured.result,input.text,input.duration),measured.cues);
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,srt:fragmented.replace('your','their')}),/transcript_mismatch/);
 assert.throws(()=>verifiedHeyGenNativeSubtitleTiming({...input,srt:fragmented.replace('00:00:00,700 -->','00:00:00,699 -->')}),/range_invalid/);
 assert.equal(measured.result.transcripts[0]!.sentences.some(row=>'words' in row),false);
});
