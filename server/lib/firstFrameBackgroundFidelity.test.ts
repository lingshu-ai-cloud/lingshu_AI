import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { inspectFirstFrameBackgroundFidelity } from './firstFrameBackgroundFidelity.js';

const plate = (outer:[number,number,number],center:[number,number,number]) => sharp({create:{width:128,height:224,channels:3,background:{r:outer[0],g:outer[1],b:outer[2]}}})
  .composite([{input:{create:{width:60,height:160,channels:3,background:{r:center[0],g:center[1],b:center[2]}},},left:34,top:64}]).jpeg().toBuffer();

test('allows presenter-core changes while the source background stays locked',async()=>{
  const result=await inspectFirstFrameBackgroundFidelity(await plate([220,220,220],[20,20,20]),await plate([220,220,220],[180,40,40]));
  assert.equal(result.passed,true);
});

test('rejects a regenerated outer environment',async()=>{
  const result=await inspectFirstFrameBackgroundFidelity(await plate([235,235,235],[20,20,20]),await plate([50,70,90],[180,40,40]));
  assert.equal(result.passed,false);
});
