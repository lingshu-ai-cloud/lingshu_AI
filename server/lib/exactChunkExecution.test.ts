import test from 'node:test';import assert from 'node:assert/strict';import {executeExactChunks} from './exactChunkExecution.js';
test('404 model rejection never repeats with smaller frames or starts next batch; in-flight siblings settle',async()=>{
 const calls:string[]=[];const results=await executeExactChunks([0,1,2,3],2,async(chunk,attempt)=>{calls.push(`${chunk}:${attempt}`);if(chunk===0)throw Error('404 Model not exist.');return chunk;});
 assert.deepEqual(calls,['0:1','1:1']);assert.equal(results.length,2);assert.equal(results[0]!.status,'rejected');assert.equal(results[1]!.status,'fulfilled');
});
test('ordinary bounded quality failure retains one smaller-frame retry',async()=>{let calls=0;const results=await executeExactChunks([0],1,async(_chunk,attempt)=>{calls++;if(attempt===1)throw Error('chunk_quality_failed');return 'real-observation';});assert.equal(calls,2);assert.deepEqual(results,[{status:'fulfilled',value:'real-observation'}]);});
