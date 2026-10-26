import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeyGenVoiceCapabilityCache, parseBoundHeyGenLogicalVoice, readHeyGenVoiceMetadata, selectHeyGenSpeechEngine } from './heygenVoiceCapabilities';
test('exact provider metadata selects the saved compatible engine without substituting voice',async()=>{
 const metadata=await readHeyGenVoiceMetadata('bound',{key:'test',fetch:(async(url,init)=>{
  assert.equal(String(url),'https://api.heygen.com/v3/voices/bound');assert.equal(init?.method,undefined);
  return Response.json({data:{voice_id:'bound',available_engines:['orca','starfish'],default_engine:'orca'}});
 }) as typeof fetch});
 assert.equal(selectHeyGenSpeechEngine(metadata,'bound'),'orca');
 assert.throws(()=>selectHeyGenSpeechEngine(metadata,'different'),/metadata_invalid/);
 assert.throws(()=>selectHeyGenSpeechEngine({...metadata,default_engine:'elevenlabs'},'bound'),/capability_unavailable/);
 assert.throws(()=>selectHeyGenSpeechEngine({...metadata,default_engine:undefined},'bound'),/ambiguous/);
 assert.equal(selectHeyGenSpeechEngine({...metadata,available_engines:['starfish'],default_engine:undefined},'bound'),'starfish');
});
test('frozen logical identity preserves legacy recovery and rejects unrecognized engine',()=>{
 assert.deepEqual(parseBoundHeyGenLogicalVoice('heygen:voice:hash'),{voiceId:'voice',engine:'starfish'});
 assert.deepEqual(parseBoundHeyGenLogicalVoice('heygen:voice:hash:orca'),{voiceId:'voice',engine:'orca'});
 assert.throws(()=>parseBoundHeyGenLogicalVoice('heygen:voice:hash:elevenlabs'),/identity_invalid/);
});
test('detail metadata may be supplemented only by exact ID catalogue capabilities',async()=>{
 let calls=0;
 const voice=await readHeyGenVoiceMetadata('bound',{key:'test',fetch:(async(url)=>{
  calls++;const u=new URL(String(url));
  if(u.pathname.endsWith('/bound'))return Response.json({data:{voice_id:'bound',name:'Brody'}});
  if(u.searchParams.get('type')==='private')return new Response('',{status:403});
  if(!u.searchParams.get('token'))return Response.json({data:[{voice_id:'other',available_engines:['starfish']}],has_more:true,next_token:'next'});
  return Response.json({data:[{voice_id:'bound',available_engines:['orca'],default_engine:'orca'}],has_more:false});
 }) as typeof fetch});
 assert.equal(selectHeyGenSpeechEngine(voice,'bound'),'orca');assert.equal(calls,4);
 await assert.rejects(readHeyGenVoiceMetadata('bound',{key:'test',fetch:(async(url)=>String(url).includes('/bound')?Response.json({data:{voice_id:'bound'}}):Response.json({data:[],has_more:true,next_token:'loop'})) as typeof fetch}),/pagination_invalid/);
});

test('capability cache isolates credentials and IDs, expires, deduplicates and obeys fresh reads',async()=>{
 const cache=createHeyGenVoiceCapabilityCache();let clock=1000,calls=0;
 const transport=(async(url)=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json({data:{voice_id:decodeURIComponent(new URL(String(url)).pathname.split('/').pop()!),available_engines:['orca'],default_engine:'orca'}});}) as typeof fetch;
 const ports={cache,fetch:transport,key:'account-one',now:()=>clock};
 const [one,two]=await Promise.all([readHeyGenVoiceMetadata('bound',ports),readHeyGenVoiceMetadata('bound',ports)]);
 assert.equal(calls,1);assert.deepEqual(one,two);one.available_engines.push('mutated');
 assert.deepEqual((await readHeyGenVoiceMetadata('bound',ports)).available_engines,['orca']);assert.equal(calls,1);
 await readHeyGenVoiceMetadata('bound',{...ports,key:'account-two'});assert.equal(calls,2);
 await readHeyGenVoiceMetadata('other',ports);assert.equal(calls,3);
 await readHeyGenVoiceMetadata('bound',{...ports,fresh:true});assert.equal(calls,4);
 clock+=60001;await readHeyGenVoiceMetadata('bound',ports);assert.equal(calls,5);
 assert.ok([...cache.values.keys()].every(key=>!key.includes('account-one')&&!key.includes('account-two')));
});
test('metadata errors are not cached and custom transports do not share global fixture state',async()=>{
 const cache=createHeyGenVoiceCapabilityCache();let calls=0;
 const ports={cache,key:'test',fetch:(async()=>{calls++;return new Response('',{status:503});}) as typeof fetch};
 await assert.rejects(readHeyGenVoiceMetadata('bound',ports),/unavailable/);
 await assert.rejects(readHeyGenVoiceMetadata('bound',ports),/unavailable/);assert.equal(calls,2);
 const custom={key:'fixture',fetch:(async()=>{calls++;return Response.json({data:{voice_id:'bound',available_engines:['orca']}});}) as typeof fetch};
 await readHeyGenVoiceMetadata('bound',custom);await readHeyGenVoiceMetadata('bound',custom);assert.equal(calls,4);
});
