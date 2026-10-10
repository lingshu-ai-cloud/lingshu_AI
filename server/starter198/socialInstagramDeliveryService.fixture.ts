import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {createSocialWeeklyG6ReviewService} from './socialWeeklyG6ReviewService.js';
import {createSocialInstagramDeliveryService} from './socialInstagramDeliveryService.js';
import {passedDirectorChecks} from './socialDirectorG5ReviewService.fixture.js';
/** Real owned bytes/cache/G4 and explicitly reviewed source G5. No packaging/review/publish occurs in setup. */
export async function prepareInstagramDeliveryFixture(options:{fullyConfigured?:boolean}={}){
 const f=await prepareWeeklyQualityAuditFixture({width:360,height:640,fps:30});try{
 const pub=f.pkg.socialContentPackage.publicationTasks[0]!;pub.platform='instagram';const task=f.tables.starter_social_content_tasks![0]!,brief=task.brief as Record<string,unknown>,authority=brief._weeklyAuthority as Record<string,unknown>;authority.publicationTask=structuredClone(pub);(authority.weeklyPackage as typeof f.pkg).socialContentPackage.publicationTasks=[structuredClone(pub)];
 const scope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:pub.publicationTaskId},sourceScope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact'};
 if(options.fullyConfigured){
  const {sealAccountCredential}=await import('../lib/accountCredentials.js');
  const {refreshPlatformCapabilityEvidence}=await import('../publishing/platformCapabilities.js');
  const {savePublicationReceptionBinding}=await import('../socialPrograms/publicationReceptionService.js');
  pub.publishWindow=f.pkg.weekStart+'T12:00:00+08:00';
  f.pkg.socialContentPackage.authorization={mode:'bounded',accountIds:[pub.accountId],maxPublishItems:1,weekStart:f.pkg.weekStart,weekEnd:f.pkg.weekEnd,allowRealPublishing:true,authorizedBy:'owner',authorizedAt:f.pkg.weekStart+'T00:00:00+08:00',revokedBy:null,revokedAt:null};
  const binding=await savePublicationReceptionBinding(f.store,{tenantId:'t',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationId:pub.publicationTaskId,cta:pub.cta!,enterpriseFactHash:f.profile.factVersion!.contentHash,targets:[{id:'sales-inbox',required:true,ownerId:'owner',destination:{kind:'messaging',channel:'messenger',receptionMode:'human'},requiredDocumentUrls:[]}]},'owner');
  pub.receptionRequirement={required:true,bindingId:binding.bindingId};
  authority.publicationTask=structuredClone(pub);authority.weeklyPackage=structuredClone(f.pkg);
  f.tables.social_accounts=[{id:pub.accountId,tenantId:'t',platform:'instagram',status:'connected',providerAccountId:'actual-ig-id',scope:'instagram_content_publish',accessToken:sealAccountCredential('controlled-token')},{id:'messenger-sales',tenantId:'t',platform:'facebook',status:'connected',providerAccountId:'actual-page',messengerSubscribed:true,accessToken:sealAccountCredential('controlled-messenger-token')}];
  await refreshPlatformCapabilityEvidence({tenantId:'t',accountId:pub.accountId,platform:'instagram',capability:'publishing.official',dataStore:f.store,providers:{async instagram(){return {id:'actual-ig-id',publishGranted:true};},async tiktok(){throw Error('unused');},async youtube(){throw Error('unused');},async facebook(){throw Error('unused');},async tiktokReceipt(){throw Error('unused');}}});
 }
 await f.g5.assign(sourceScope,'owner',{reviewerUserId:'owner'});const g5ctx=await f.g5.context(sourceScope,'owner');await f.g5.human(sourceScope,'owner',{requestId:'actual_ig_source_director_0001',expectedContextHash:g5ctx.contextHash,checks:passedDirectorChecks(g5ctx)});
 return {...f,scope,g6:createSocialWeeklyG6ReviewService(f.repository),delivery:createSocialInstagramDeliveryService(f.repository)};
 }catch(error){await f.cleanup();throw error;}
}
