import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundPresenterVoice, readWeeklyProductionVoice, assertBoundPresenterAudio } from './socialContentBoundPresenterVoice';
import { resolveStudioVoiceExecutionPlan } from '../routes/studio';

test('selected presenter binds the physical voice and version into cache and budget identity', async () => {
 const person = { id:'sales', authorized:true, avatarId:'look', voiceId:'bound-voice', assetVersion:4, toolMappings:{heygen:{avatarId:'look',voiceId:'bound-voice'}} };
 const store:any = { list:async()=>({items:[{tenant_id:'tenant',payload:{presenters:[person]}}]}) };
 const binding = await readBoundPresenterVoice(store,'tenant',['sales']);
 assert.ok(binding);
 const plan = resolveStudioVoiceExecutionPlan({tenantId:'tenant',text:'Hello. Welcome.',voice:binding.logicalVoice,language:'en',env:{HEYGEN_API_KEY:'test-only',DASHSCOPE_API_KEY:'test-only',MINIMAX_API_KEY:'test-only'}});
 assert.equal(plan.primary?.provider,'heygen'); assert.equal(plan.primary?.voiceId,'bound-voice'); assert.equal(plan.fallback,null);
 assert.throws(()=>resolveStudioVoiceExecutionPlan({tenantId:'tenant',text:'Hello.',voice:binding.logicalVoice,nativeProvider:'qwen',env:{HEYGEN_API_KEY:'test-only'}}),/provider_mismatch/);
 const old = binding.fingerprint; person.assetVersion++;
 assert.notEqual((await readBoundPresenterVoice(store,'tenant',['sales']))?.fingerprint,old);
 assert.throws(()=>assertBoundPresenterAudio('bound-voice',{provider:'qwen',physicalVoiceId:'Cherry'}),/voice_mismatch/);
 assert.throws(()=>assertBoundPresenterAudio('bound-voice',{provider:'heygen',physicalVoiceId:'another-voice'}),/voice_mismatch/);
 assertBoundPresenterAudio('bound-voice',{provider:'heygen',physicalVoiceId:'bound-voice'});
 person.toolMappings.heygen.voiceId='different';
 await assert.rejects(readBoundPresenterVoice(store,'tenant',['sales']),/missing_or_conflicting/);
 await assert.rejects(readBoundPresenterVoice(store,'another-tenant',['sales']),/registry_missing/);
});

test('weekly production requires the authorized default VoiceIdentity even without visible presenter shots', async () => {
 const person = { id:'sales', authorized:true, avatarId:'look', voiceId:'bound-voice', assetVersion:4,
   toolMappings:{heygen:{avatarId:'look',voiceId:'bound-voice'}}, rightsEvidence:{
     authorizationRef:'document://studio_presenter_assets/source/look',consentRef:'consent://user-declaration/source',grantedAt:'2026-01-01T00:00:00.000Z',
     subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis'] } };
 const payload:any = { defaultPresenterId:'sales', presenters:[person] };
 const source:any = { id:'source',tenant_id:'tenant',kind:'import_authorization',payload:{lookId:'look',voiceId:'bound-voice',groupId:'group',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false} };
 const otherSource:any = { id:'source2',tenant_id:'tenant',kind:'import_authorization',payload:{lookId:'other',voiceId:'different',groupId:'group2',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false} };
 const store:any = { list:async()=>({totalItems:1,items:[{tenant_id:'tenant',payload}]}), getById:async(_c:string,id:string)=>id==='source2'?otherSource:source };
 const voice = await readWeeklyProductionVoice(store,'tenant',[]);
 assert.match(voice.logicalVoice,/^heygen:bound-voice:/);
 assert.equal(voice.presenters[0]?.id,'sales');
 delete payload.defaultPresenterId;
 await assert.rejects(readWeeklyProductionVoice(store,'tenant',[]),/weekly_default_voice_identity_missing/);
 payload.defaultPresenterId='sales';
 person.rightsEvidence.subjectAdultConfirmed=false;
 await assert.rejects(readWeeklyProductionVoice(store,'tenant',[]),/weekly_default_voice_authorization_missing/);
 person.rightsEvidence.subjectAdultConfirmed=true;
 payload.presenters.push({...person,id:'other',avatarId:'other',voiceId:'different',toolMappings:{heygen:{avatarId:'other',voiceId:'different'}},rightsEvidence:{...person.rightsEvidence,authorizationRef:'document://studio_presenter_assets/source2/other',consentRef:'consent://user-declaration/source2'}});
 await assert.rejects(readWeeklyProductionVoice(store,'tenant',['other']),/multiple_presenter_voices_require_separate_audio_tracks/);
});

test('weekly voice source stays tenant-bound and survives restart without accepting forged catalog evidence', async () => {
 const source:any = { id:'source',tenant_id:'tenant',kind:'import_authorization',payload:{lookId:'look',voiceId:'voice',groupId:'group',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false} };
 const person:any = { id:'sales',authorized:true,avatarId:'look',voiceId:'voice',assetVersion:2,
   toolMappings:{heygen:{avatarId:'look',voiceId:'voice'}},rightsEvidence:{authorizationRef:'document://studio_presenter_assets/source/look',consentRef:'consent://user-declaration/source',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']} };
 const disk = { source, defaults:{tenant_id:'tenant',payload:{defaultPresenterId:'sales',presenters:[person]}} };
 const open = () => { const snapshot=structuredClone(disk); return {list:async()=>({totalItems:1,items:[snapshot.defaults]}),getById:async(_c:string,id:string)=>id===snapshot.source.id?snapshot.source:null} as any; };
 assert.equal((await readWeeklyProductionVoice(open(),'tenant',[])).voiceId,'voice');
 assert.equal((await readWeeklyProductionVoice(open(),'tenant',[])).voiceId,'voice');
 disk.source.payload.adultConfirmed=false;
 await assert.rejects(readWeeklyProductionVoice(open(),'tenant',[]),/source_mismatch/);
 disk.source.payload.adultConfirmed=true;
 disk.source.tenant_id='other';
 await assert.rejects(readWeeklyProductionVoice(open(),'tenant',[]),/source_mismatch/);
 disk.source.tenant_id='tenant'; disk.source.payload.voiceId='other';
 await assert.rejects(readWeeklyProductionVoice(open(),'tenant',[]),/binding_missing/);
 disk.source.payload.voiceId='voice'; disk.defaults.payload.presenters[0].rightsEvidence.authorizationRef='document://studio_presenter_assets/catalog/look';
 await assert.rejects(readWeeklyProductionVoice(open(),'tenant',[]),/source_mismatch/);
 disk.defaults.payload.presenters[0].rightsEvidence.authorizationRef='document://studio_presenter_assets/source/look';
 disk.source.payload.revokedAt='2026-10-19T00:00:00Z';
 await assert.rejects(readWeeklyProductionVoice(open(),'tenant',[]),/source_mismatch/);
});

test('weekly bound clone needs the retained provider-confirmed binding source', async () => {
 const person:any = {id:'person',authorized:true,avatarId:'look',voiceId:'clone',assetVersion:3,toolMappings:{heygen:{avatarId:'look',voiceId:'clone'}},
  rightsEvidence:{authorizationRef:'document://studio_presenter_assets/import/look',consentRef:'consent://user-declaration/import',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']},
  voiceAuthorization:{voiceId:'clone',recordedAt:'2026-01-02T00:00:00Z',source:'user_confirmation',authorizationRef:'document://studio_presenter_assets/binding/clone'}};
 const rows:any = {import:{id:'import',tenant_id:'tenant',kind:'import_authorization',payload:{lookId:'look',voiceId:'original',groupId:'group',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false}},
  binding:{id:'binding',tenant_id:'tenant',kind:'voice_binding_authorization',payload:{presenterId:'person',avatarId:'look',voiceId:'clone',authorizationDeclared:true,providerVoiceConfirmed:true,recordedAt:'2026-01-02T00:00:00Z'}}};
 const store:any={list:async()=>({totalItems:1,items:[{tenant_id:'tenant',payload:{defaultPresenterId:'person',presenters:[person]}}]}),getById:async(_c:string,id:string)=>structuredClone(rows[id]||null)};
 assert.equal((await readWeeklyProductionVoice(store,'tenant',[])).voiceId,'clone');
 rows.binding.payload.providerVoiceConfirmed=false;
 await assert.rejects(readWeeklyProductionVoice(store,'tenant',[]),/binding_mismatch/);
 rows.binding.payload.providerVoiceConfirmed=true;
 rows.binding.payload.revokedAt='2026-10-19T00:00:00Z';
 await assert.rejects(readWeeklyProductionVoice(store,'tenant',[]),/binding_mismatch/);
});

test('manual production may still omit a bound presenter voice', async () => {
 const store:any = { list:async()=>{throw Error('manual route must not read defaults');} };
 assert.equal(await readBoundPresenterVoice(store,'tenant',[]),null);
});
