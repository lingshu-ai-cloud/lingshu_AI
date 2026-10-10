import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {convertInstagramDelivery,INSTAGRAM_DELIVERY_CONVERSION_VERSION} from './socialInstagramDeliveryConversion.js';
test('local packaging decodes real source audio/video and freezes distinct actual delivery bytes without claiming review',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'instagram-delivery-test-'));try{
 const file=path.join(root,'source.mp4');const generated=await runVisualFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=360x640:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file],false,{timeoutMs:30000});assert.equal(generated.ok,true);
 const source=await readFile(file),hash=createHash('sha256').update(source).digest('hex');const result=await convertInstagramDelivery(source,hash);
 assert.equal(result.sourceSha256,hash);assert.notEqual(result.deliverySha256,hash);assert.equal(result.deliverySha256,createHash('sha256').update(result.bytes).digest('hex'));assert.equal(result.metadata.fileSha256,result.deliverySha256);assert.equal(result.metadata.width,720);assert.equal(result.metadata.height,1280);assert.equal(result.metadata.framesPerSecond,30);assert.equal(result.metadata.audioSampleRateHz,48000);assert.equal(result.metadata.audioChannels,2);assert.equal(result.conversionVersion,INSTAGRAM_DELIVERY_CONVERSION_VERSION);assert.equal('passed' in result,false);
 await assert.rejects(convertInstagramDelivery(source,'0'.repeat(64)),/source_hash_changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('invalid owned video cannot yield a prepared delivery',async()=>{const bytes=Buffer.from('not video');await assert.rejects(convertInstagramDelivery(bytes,createHash('sha256').update(bytes).digest('hex')),/conversion_failed/);});
