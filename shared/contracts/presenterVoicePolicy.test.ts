import test from 'node:test';
import assert from 'node:assert/strict';
import { presenterVoicePolicy, presenterSpeechCapabilities } from './presenterVoicePolicy';
const catalog={avatarId:'stock',rightsEvidence:{authorizationRef:'license://heygen/public-catalog/stock'},presenterSource:'heygen_catalog',voiceSelectionMode:'follow_avatar'};
test('catalogue defaults need no enterprise voice ID while enterprise people must bind an explicit voice',()=>{
 assert.equal(presenterVoicePolicy(catalog).voiceReady,true);
 assert.equal(presenterVoicePolicy({avatarId:'own',voiceSelectionMode:'explicit'}).voiceReady,false);
 assert.equal(presenterVoicePolicy({avatarId:'own',voiceId:'clone',voiceSelectionMode:'explicit'}).voiceReady,true);
 assert.equal(presenterVoicePolicy({avatarId:'own',voiceId:'clone',voiceSelectionMode:'follow_avatar'}).valid,false);
 assert.equal(presenterVoicePolicy({...catalog,avatarId:'wrong'}).valid,false);
 assert.equal(presenterVoicePolicy({...catalog,presenterSource:'enterprise_created'}).valid,false);
 assert.equal(presenterVoicePolicy({...catalog,voiceSelectionMode:'guess'}).valid,false);
 assert.equal(presenterVoicePolicy({avatarId:'legacy',voiceId:'voice'}).voiceSelectionMode,'explicit');
});
test('independent TTS mismatch preserves native speech and supports verified original track reuse',()=>{
 const input={nativeSpeechAvailable:true,independentVoiceEngines:['orca'],supportedNarrationEngines:['starfish'],originalTrackReusable:false};
 assert.deepEqual(presenterSpeechCapabilities(input),{nativeSpeech:true,independentNarration:false,narration:'needs_voice_review',code:'presenter_narration_capability_unavailable'});
 assert.equal(presenterSpeechCapabilities({...input,originalTrackReusable:true}).narration,'original_speech_track');
 assert.equal(presenterSpeechCapabilities({...input,independentVoiceEngines:['starfish']}).narration,'same_voice_tts');
});
