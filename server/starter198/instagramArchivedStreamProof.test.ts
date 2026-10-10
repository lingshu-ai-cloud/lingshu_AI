import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {inspectInstagramArchivedStreamProof,verifyInstagramArchivedStreamProof} from './instagramArchivedStreamProof.js';
test('exact archived AVC faststart bytes prove stream structure; mutations and edits cannot pass',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ig-stream-'));try{const path=join(dir,'video.mp4');await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=64x64:r=30','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-g','30','-flags','+cgop','-movflags','+faststart','-use_editlist','0',path]);const bytes=await readFile(path),proof=inspectInstagramArchivedStreamProof(bytes);assert.equal(proof.status,'passed',JSON.stringify(proof));assert.ok(verifyInstagramArchivedStreamProof(proof,proof.fileSha256));assert.equal(verifyInstagramArchivedStreamProof({...proof,bytes:1},proof.fileSha256),false);assert.equal(verifyInstagramArchivedStreamProof(proof,'0'.repeat(64)),false);
 const changedSync=Buffer.from(bytes);const stss=changedSync.indexOf(Buffer.from('stss'));assert.ok(stss>0);changedSync.writeUInt32BE(2,stss+12);assert.equal(inspectInstagramArchivedStreamProof(changedSync).status,'unknown');
 const malformed=inspectInstagramArchivedStreamProof(bytes.subarray(0,bytes.length-5));assert.equal(malformed.status,'unknown');assert.ok(verifyInstagramArchivedStreamProof(malformed,malformed.fileSha256));
 await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=64x64:r=30','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path]);const edit=inspectInstagramArchivedStreamProof(await readFile(path));assert.equal(edit.status,'blocked');assert.ok(edit.reasons.includes('edit_list_present'));
 await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=64x64:r=30','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-use_editlist','0',path]);const slow=inspectInstagramArchivedStreamProof(await readFile(path));assert.equal(slow.status,'blocked');assert.ok(slow.reasons.includes('moov_after_mdat'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('malformed and unsupported archives produce bounded unknown evidence',()=>{for(const bytes of [Buffer.alloc(0),Buffer.from('invalid'),Buffer.from([0,0,0,1,109,111,111,118])]){const p=inspectInstagramArchivedStreamProof(bytes);assert.equal(p.status,'unknown');assert.ok(verifyInstagramArchivedStreamProof(p,p.fileSha256)=== (bytes.length>0));}});
