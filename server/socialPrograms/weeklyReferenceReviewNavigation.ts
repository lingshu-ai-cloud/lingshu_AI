import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyContentNavigationScope} from '../../shared/contracts/weeklyContentNavigation.js';
import type {WeeklyReferenceReviewNavigation} from '../../shared/contracts/weeklyReferenceReviewNavigation.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {readWeeklyContentNavigation} from './weeklyContentNavigation.js';
import {readWeeklyReferenceSources,assertWeeklyReferenceBindings} from '../runtime/socialWeeklyReferenceSource.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';
import {socialJson,socialObject} from '../starter198/socialContentValidation.js';
import {loadReferenceShotReview} from '../lib/referenceShotReview.js';
import {SocialProgramError} from './service.js';
function fail(code:string):never {throw new SocialProgramError(code,409,'当前周任务的参考来源或审核版本已变化，请重新核对冻结排期。');}
/** Read only: exact owned weekly binding and active canonical reference, never a recommendation. */
export async function readWeeklyReferenceReviewNavigation(store:DataStore,scope:WeeklyContentNavigationScope,recordId:string):Promise<WeeklyReferenceReviewNavigation>{
 if(typeof recordId!=='string'||!recordId.trim()||recordId!==recordId.trim())fail('weekly_reference_navigation_record_invalid');
 const navigation=await readWeeklyContentNavigation(store,scope);
 const rows=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:scope.tenantId,package_id:scope.packageId,version:scope.packageVersion},perPage:2});
 if(rows.totalItems!==1||rows.items.length!==1)fail('weekly_reference_navigation_package_invalid');
 const pkg=socialJson(rows.items[0]!.payload) as WeeklyOperatingPackage|null;
 if(!pkg||pkg.programId!==scope.programId||pkg.packageId!==scope.packageId||pkg.version!==scope.packageVersion)fail('weekly_reference_navigation_package_invalid');
 const items=pkg.agentPlanning?.dispatch?.scheduleItems.filter(item=>item.publicationTaskId===navigation.publicationTaskId)??[];
 if(items.length!==1||items[0]!.directorAnalysisRef.type!=='weekly_director_analysis'||items[0]!.directorAnalysisRef.version!==1)fail('weekly_reference_navigation_analysis_invalid');
 const analyses=pkg.agentPlanning?.directorAnalyses.filter(analysis=>analysis.analysisId===items[0]!.directorAnalysisRef.id)??[];
 if(analyses.length!==1)fail('weekly_reference_navigation_analysis_invalid');
 const bound=await store.list<Record_>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,task_id:navigation.contentTaskId},perPage:2});
 const content=bound.items[0];if(bound.totalItems!==1||!content||content.tenant_id!==scope.tenantId||content.task_id!==navigation.contentTaskId)fail('weekly_reference_navigation_binding_invalid');
 const brief=socialObject(socialJson(content.brief));
 const references=await readWeeklyReferenceSources(store,scope.tenantId,brief?._weeklyAuthority,analyses[0]!);
 const detail=await readSocialTaskDetail({repository:createStarter198Repository(store),tenantId:scope.tenantId,taskId:navigation.contentTaskId});
 if(!detail)fail('weekly_reference_navigation_binding_invalid');
 assertWeeklyReferenceBindings(detail,references);
 const selected=references.filter(reference=>reference.record.id===recordId);
 if(selected.length!==1||selected[0]!.record.tenantId!==scope.tenantId)fail('weekly_reference_navigation_record_not_selected');
 return {...scope,contentTaskId:navigation.contentTaskId,recordId,sourceVersion:selected[0]!.sourceVersion,analysisVersion:loadReferenceShotReview(selected[0]!.record).version};
}
