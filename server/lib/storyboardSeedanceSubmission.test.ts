import {test} from 'node:test';import assert from 'node:assert/strict';import {submitStoryboardSeedance} from './storyboardSeedanceSubmission.js';
const input={model:'seedance-test',baseUrl:'https://controlled.invalid',apiKey:'test',content:[{type:'text',text:'product hero'},{type:'image_url',role:'first_frame',image_url:{url:'https://controlled.invalid/frame'}}],ratio:'9:16',duration:4,resolution:'720p',silent:true};
test('durable prepare and receipt precede success; silent product payload and recovery never duplicate POST',async()=>{const order:string[]=[];let posted=0;
 const ports={assertCurrent:async()=>{order.push('current');},prepare:async()=>{order.push('prepared');},accepted:async(id:string)=>{assert.equal(id,'original-id');order.push('accepted');},request:async(_url:string,_key:string,init:RequestInit)=>{posted++;order.push('post');const b=JSON.parse(String(init.body));assert.equal(b.generate_audio,false);assert.equal(b.content[1].role,'first_frame');return{id:'original-id'};}};
 await submitStoryboardSeedance(input,ports);assert.deepEqual(order,['current','prepared','current','post','accepted']);await submitStoryboardSeedance({...input,existingTaskId:'original-id'},ports);assert.equal(posted,1);
 await assert.rejects(submitStoryboardSeedance(input,{...ports,prepare:async()=>{throw Error('unknown prepared');}}),/unknown prepared/);assert.equal(posted,1);
 await assert.rejects(submitStoryboardSeedance({...input,content:[{type:'text',text:'silent claim only'}]},ports),/silent_first_frame_required/);assert.equal(posted,1);
 await assert.rejects(submitStoryboardSeedance(input,{...ports,assertCurrent:async()=>{throw Error('scope drift');}}),/scope drift/);assert.equal(posted,1);
});
