import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCatalogPresenterVoice} from './presenterVoiceResolution';
const look=(voiceId='original')=>({id:'stock',name:'Stock',status:'completed',orientation:'unknown' as const,voiceId});
test('catalogue default resolves from original provider metadata without mutating saved enterprise preferences',async()=>{
 const saved={avatarId:'stock',voiceId:'old',voiceSelectionMode:'follow_avatar',rightsEvidence:{authorizationRef:'license://heygen/public-catalog/stock'}};
 const resolved=await resolveCatalogPresenterVoice(saved,async id=>{assert.equal(id,'stock');return look();});
 assert.equal(resolved.voiceId,'original');assert.equal(saved.voiceId,'old');
 assert.equal((await resolveCatalogPresenterVoice({...saved,voiceSelectionMode:'explicit'},async()=>{throw Error('must not read');})).voiceId,'old');
 await assert.rejects(resolveCatalogPresenterVoice(saved,async()=>look('')),/default_voice_unresolved/);
 await assert.rejects(resolveCatalogPresenterVoice(saved,async()=>({...look(),id:'other'})),/presenter_unavailable/);
 await assert.rejects(resolveCatalogPresenterVoice({...saved,avatarId:'own'},async()=>look()),/policy_invalid/);
});
