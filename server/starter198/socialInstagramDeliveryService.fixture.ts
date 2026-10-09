import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {createSocialWeeklyG6ReviewService} from './socialWeeklyG6ReviewService.js';
import {createSocialInstagramDeliveryService} from './socialInstagramDeliveryService.js';
import {passedDirectorChecks} from './socialDirectorG5ReviewService.fixture.js';
/** Real owned bytes/cache/G4 and explicitly reviewed source G5. No packaging/review/publish occurs in setup. */
export async function prepareInstagramDeliveryFixture(){
 const f=await prepareWeeklyQualityAuditFixture({width:360,height:640,fps:30});try{
 const pub=f.pkg.socialContentPackage.publicationTasks[0]!;pub.platform='instagram';const task=f.tables.starter_social_content_tasks![0]!,brief=task.brief as Record<string,unknown>,authority=brief._weeklyAuthority as Record<string,unknown>;authority.publicationTask=structuredClone(pub);(authority.weeklyPackage as typeof f.pkg).socialContentPackage.publicationTasks=[structuredClone(pub)];
 const scope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact',programId:f.pkg.programId,packageId:f.pkg.packageId,packageVersion:f.pkg.version,publicationTaskId:pub.publicationTaskId},sourceScope={tenantId:'t',taskId:'content',runId:'run',artifactId:'artifact'};
 await f.g5.assign(sourceScope,'owner',{reviewerUserId:'owner'});const g5ctx=await f.g5.context(sourceScope,'owner');await f.g5.human(sourceScope,'owner',{requestId:'actual_ig_source_director_0001',expectedContextHash:g5ctx.contextHash,checks:passedDirectorChecks(g5ctx)});
 return {...f,scope,g6:createSocialWeeklyG6ReviewService(f.repository),delivery:createSocialInstagramDeliveryService(f.repository)};
 }catch(error){await f.cleanup();throw error;}
}
