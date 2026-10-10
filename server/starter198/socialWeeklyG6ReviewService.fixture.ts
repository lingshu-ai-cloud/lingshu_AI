import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {createSocialWeeklyG6ReviewService} from './socialWeeklyG6ReviewService.js';
import type {SocialWeeklyG6Scope} from '../../shared/contracts/socialWeeklyG6Review.js';
/** Real local decoded media, G4 human evidence, G5 explicit independent human audit, actual confirmed reception and controlled provider-probe port. No external calls. G6 submission and final approval remain caller actions. */
export async function prepareWeeklyG6Fixture(options:{registeredOwnedMedia?:boolean;profile?:'b2b_cold_start'|'b2b_existing'}={}){
 const f=await prepareWeeklyQualityAuditFixture({width:360,height:640,fps:30,...options});try{
 const {sealAccountCredential}=await import('../lib/accountCredentials.js');const {refreshPlatformCapabilityEvidence}=await import('../publishing/platformCapabilities.js');const {savePublicationReceptionBinding}=await import('../socialPrograms/publicationReceptionService.js');const {g5FixtureScope,passedDirectorChecks}=await import('./socialDirectorG5ReviewService.fixture.js');
 const pub=f.pkg.socialContentPackage.publicationTasks[0]!;pub.publishWindow=f.pkg.weekStart+'T12:00:00+08:00';
 if(options.profile){
  pub.motherContentId=pub.motherContentId||'actual-profile-mother-content';
  const referenceSourcePolicy=options.profile==='b2b_cold_start'
   ?{profile:options.profile,allocationUnit:'mother_content' as const,ownedPercent:0,externalPercent:100}
   :{profile:options.profile,allocationUnit:'mother_content' as const,ownedPercent:40,externalPercent:60};
  f.pkg.referenceSourcePolicy=referenceSourcePolicy;
  const planning=f.tables.social_weekly_agent_planning?.find(row=>row.tenant_id==='t'&&row.package_id===f.pkg.packageId&&row.package_version===f.pkg.version);
  if(!planning)throw Error('actual_fixture_planning_missing');
  const payload=planning.payload as Record<string,any>;
  payload.referenceSourcePolicy=structuredClone(referenceSourcePolicy);
  if(payload.skeleton){payload.skeleton.referenceSourcePolicy=structuredClone(referenceSourcePolicy);for(const slot of payload.skeleton.slots??[]){slot.motherContentId=pub.motherContentId;slot.referenceSource=options.profile==='b2b_cold_start'?'external':(slot.referenceSource??'external');}}
 }
 f.pkg.socialContentPackage.authorization={mode:'bounded',accountIds:[pub.accountId],maxPublishItems:5,weekStart:f.pkg.weekStart,weekEnd:f.pkg.weekEnd,allowRealPublishing:true,authorizedBy:'owner',authorizedAt:f.pkg.weekStart+'T00:00:00+08:00',revokedBy:null,revokedAt:null};
 if(typeof pub.cta!=='string'||!pub.cta)throw Error('actual_fixture_cta_missing');
 const binding=await savePublicationReceptionBinding(f.store,{tenantId:'t',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationId:pub.publicationTaskId,cta:pub.cta,enterpriseFactHash:f.profile.factVersion!.contentHash,targets:[{id:'sales-inbox',required:true,ownerId:'owner',destination:{kind:'messaging',channel:'messenger',receptionMode:'human'},requiredDocumentUrls:[]}]},'owner');pub.receptionRequirement={required:true,bindingId:binding.bindingId};
 const brief=f.tables.starter_social_content_tasks![0]!.brief as Record<string,unknown>;const authority=brief._weeklyAuthority as Record<string,unknown>;authority.publicationTask=structuredClone(pub);const frozen=authority.weeklyPackage as import('../../shared/contracts/socialProgram.js').WeeklyOperatingPackage;frozen.referenceSourcePolicy=f.pkg.referenceSourcePolicy?structuredClone(f.pkg.referenceSourcePolicy):undefined;frozen.socialContentPackage.publicationTasks=frozen.socialContentPackage.publicationTasks.map(item=>item.publicationTaskId===pub.publicationTaskId?structuredClone(pub):item);
 f.tables.social_accounts=[{id:pub.accountId,tenantId:'t',platform:'tiktok',status:'connected',providerAccountId:'actual-open-id',scope:'video.publish',accessToken:sealAccountCredential('controlled-provider-token')},{id:'messenger-sales',tenantId:'t',platform:'facebook',status:'connected',providerAccountId:'actual-sales-page',messengerSubscribed:true,accessToken:sealAccountCredential('controlled-messenger-token')}];
 await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:pub.accountId,platform:'tiktok',capability:'publishing.official',dataStore:f.store,providers:{async tiktok(){return {openId:'actual-open-id',publishGranted:true};},async youtube(){throw Error('not used');},async instagram(){throw Error('not used');},async facebook(){throw Error('not used');},async tiktokReceipt(){throw Error('not used');}}});
 await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});const g5=await f.g5.context(g5FixtureScope,'owner');await f.g5.human(g5FixtureScope,'owner',{requestId:'actual-g6-source-director-0001',expectedContextHash:g5.contextHash,checks:passedDirectorChecks(g5)});
 const scope:SocialWeeklyG6Scope={...g5FixtureScope,programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:pub.publicationTaskId};const service=createSocialWeeklyG6ReviewService(f.repository);return {...f,scope,service};}catch(error){await f.cleanup();throw error;}
}
