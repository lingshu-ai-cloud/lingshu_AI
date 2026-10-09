import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage,VersionedSocialRef} from '../../shared/contracts/socialProgram.js';
import type {WeeklyContentTemplateBinding} from '../../shared/contracts/socialWeeklyContentTemplates.js';
import {CONTENT_TEMPLATE_BINDINGS,createWeeklyContentTemplateService} from './weeklyContentTemplates.js';
import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';
import {withExecutionPackageGate} from './weeklyExecutionGate.js';
import {materializeWeeklyExecutionTasks,projectWeeklyExecution} from './executionTasks.js';
import {createWeeklyPlanningAuthority} from './planningAuthority.js';
import {scheduleHash} from './weeklyScheduleSnapshots.js';
import {SocialProgramError} from './service.js';
const fail=(code:string,status=409):never=>{throw new SocialProgramError(code,status,'模板修订身份或保存结果不一致，请读取真实待绑定凭据重试。');};
export function createWeeklyContentTemplateApplicationService(store:DataStore){
 return {async apply(scope:{tenantId:string;programId:string;actorUserId:string},input:{bindingId:string;sourceVersion:number;targetVersion:number}){
 if(!Number.isSafeInteger(input.sourceVersion)||input.sourceVersion<1||!Number.isSafeInteger(input.targetVersion))return fail('content_template_application_version_invalid',400);
 const row=await store.getById<Record_>(CONTENT_TEMPLATE_BINDINGS,input.bindingId);const b=row?.payload as WeeklyContentTemplateBinding|undefined;
 if(!b||b.bindingId!==input.bindingId||b.tenantId!==scope.tenantId||b.programId!==scope.programId||b.confirmedBy!==scope.actorUserId||b.packageVersion!==input.targetVersion||input.targetVersion!==input.sourceVersion+1)return fail('content_template_application_binding_invalid');
 const {recordHash,...payload}=b;if(recordHash!==scheduleHash(payload)||row?.record_hash!==recordHash)return fail('content_template_application_binding_corrupt');
 const a={tenantId:scope.tenantId,programId:scope.programId,packageId:b.packageId,packageVersion:input.sourceVersion,publicationTaskId:b.publicationTaskId};
 return withExecutionPackageGate(store,a,async assert=>{
 const templates=createWeeklyContentTemplateService(store);
 const checked=await templates.bind(a,{actorUserId:scope.actorUserId,templateRef:b.templateRef,candidateHash:b.candidateHash,expectedTargetVersion:input.targetVersion});if(checked.bindingId!==b.bindingId)return fail('content_template_application_binding_changed');
 const rows=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:scope.tenantId,program_id:scope.programId,package_id:b.packageId},perPage:500});if(rows.totalItems!==rows.items.length||new Set(rows.items.map(r=>r.version)).size!==rows.items.length)return fail('content_template_application_versions_incomplete');
 const sourceRows=rows.items.filter(r=>Number(r.version)===input.sourceVersion);if(sourceRows.length!==1)return fail('content_template_application_source_missing');const source=sourceRows[0]!.payload as WeeklyOperatingPackage;if(source.status!=='draft'||source.version!==input.sourceVersion||source.programId!==scope.programId||source.packageId!==b.packageId)return fail('content_template_application_source_invalid');
 const publicationTasks=source.socialContentPackage.publicationTasks.map(p=>p.publicationTaskId===b.publicationTaskId?{...p,contentTemplateBindingRef:{type:'weekly_content_template_binding',id:b.bindingId,version:1}}:p);if(!publicationTasks.some(p=>p.publicationTaskId===b.publicationTaskId))return fail('content_template_application_publication_missing');
 const ref:VersionedSocialRef={type:'weekly_content_template_application',id:b.bindingId,version:1};
 const saved=rows.items.find(r=>Number(r.version)===input.targetVersion);if(saved){const target=saved.payload as WeeklyOperatingPackage&{templateApplicationRef?:VersionedSocialRef};if(target.status!=='draft'||target.version!==input.targetVersion||target.previousVersion!==input.sourceVersion||scheduleHash(target.templateApplicationRef)!==scheduleHash(ref)||scheduleHash(target.socialContentPackage.publicationTasks)!==scheduleHash(publicationTasks))return fail('content_template_application_target_conflict');await templates.readForPlanning({...a,packageVersion:target.version},b.bindingId);await assert();const planning=await createWeeklyPlanningAuthority(store).initialize(scope.tenantId,target);const tasks=await materializeWeeklyExecutionTasks(store,scope.tenantId,target);return {item:{...projectWeeklyExecution(target,tasks,new Date().toISOString()),agentPlanning:planning},activated:false as const,recovered:true};}
 if(rows.items.some(r=>Number(r.version)>input.sourceVersion))return fail('content_template_application_head_changed');await assert();const service=createWeeklyOperatingPackageService(store);const item=await service.revise(scope.tenantId,scope.actorUserId,scope.programId,b.packageId,{expectedVersion:input.sourceVersion,publicationTasks,changeReason:'明确将已确认内容模板应用到未来周任务'},{templateApplicationRef:ref});if(item.version!==input.targetVersion)return fail('content_template_application_target_version');return {item,activated:false as const,recovered:false};
 });
 }};
}
