import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage,VersionedSocialRef} from '../../shared/contracts/socialProgram.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {withExecutionPackageGate} from './weeklyExecutionGate.js';
import {preflightWeeklyEnterpriseFactRevision} from './weeklyEnterpriseFactRevisionPreflight.js';
import {readWeeklyExistingFactSource} from './weeklyExistingFactSource.js';
import {latestPackageRow} from './weeklyOperatingPackageSupport.js';
import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';
import {createWeeklyAutomaticScheduleService,AUTOMATIC_WEEKLY_SCHEDULES,readWeeklyAutomaticPreproductionAdmission} from './weeklyAutomaticSchedule.js';
import {connectAndBindWeeklyAutomaticSchedule,uniqueApprovedWeeklyDiscoveryAuthority,type WeeklyAutomaticExecutionScope} from './weeklyAutomaticScheduleFlow.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {readScheduleSnapshot} from './weeklyScheduleSnapshots.js';

export const WEEKLY_ENTERPRISE_FACT_MIGRATIONS='social_weekly_enterprise_fact_migrations';
type Scope=WeeklyAutomaticExecutionScope;
interface Receipt{
 schemaVersion:'weekly-enterprise-fact-migration.v1';migrationId:string;source:Scope;sourceWeekStart:string;
 sourcePublicationHash:string;targetPublicationHash:string;factRef:VersionedSocialRef;factHash:string;
 state:'planned'|'revised'|'schedule_blocked'|'activating_independent'|'independent_active'|'scheduled'|'completed';revisedVersion:number|null;targetVersion:number|null;
 createdAt:string;updatedAt:string;recordHash:string;
}
type Ports={
 revise?:(scope:Scope,publicationTasks:WeeklyOperatingPackage['socialContentPackage']['publicationTasks'],marker:string)=>Promise<number>;
 schedule?:(scope:Scope)=>Promise<{status:'scheduled'|'blocked';targetVersion:number|null}>;
 bind?:(scope:Scope)=>Promise<void>;
 blockedAdmission?:(scope:Scope)=>Promise<boolean>;
 now?:()=>string;
};
const sealed=(value:Omit<Receipt,'recordHash'>|Receipt):Receipt=>{const {recordHash:_ignored,...body}=value as Receipt;return {...body,recordHash:socialRequestHash(body)} as Receipt;};
function checked(row:Record_):Receipt{const receipt=row.payload as Receipt;if(!receipt||receipt.schemaVersion!=='weekly-enterprise-fact-migration.v1'||receipt.migrationId!==row.id||receipt.recordHash!==sealed(receipt).recordHash||row.record_hash!==receipt.recordHash||row.tenant_id!==receipt.source.tenantId||row.program_id!==receipt.source.programId||row.package_id!==receipt.source.packageId||row.package_version!==receipt.source.packageVersion)throw Error('weekly_fact_migration_receipt_corrupt');return receipt;}
async function rows(store:DataStore,collection:string,where:Record<string,string|number>){const result:Record_[]=[];for(let page=1;page<=1000;page++){const found=await store.list<Record_>(collection,{where,page,perPage:250,sort:'id'});if(!Number.isSafeInteger(found.totalItems)||found.totalItems<0)throw Error('weekly_fact_migration_scan_invalid');result.push(...found.items);if(result.length===found.totalItems)return result;if(!found.items.length||result.length>found.totalItems)throw Error('weekly_fact_migration_scan_incomplete');}throw Error('weekly_fact_migration_scan_limit');}
async function persist(store:DataStore,receipt:Receipt,next:Pick<Receipt,'state'|'revisedVersion'|'targetVersion'>,now:string){
 const updated=sealed({...receipt,...next,updatedAt:now});
 if(!await store.update(WEEKLY_ENTERPRISE_FACT_MIGRATIONS,receipt.migrationId,{state:updated.state,record_hash:updated.recordHash,payload:updated,updated_at:now}))throw Error('weekly_fact_migration_receipt_write_failed');
 return updated;
}
function refEqual(a:VersionedSocialRef,b:VersionedSocialRef){return a.type===b.type&&a.id===b.id&&a.version===b.version;}
function targetPublications(pkg:WeeklyOperatingPackage,ref:VersionedSocialRef){return pkg.socialContentPackage.publicationTasks.map(pub=>({...pub,factRefs:[ref]}));}

/** Preparation stops before connecting a local consumer. Even a valid schedule
 * receipt is not an instruction to start the worker. */
export async function reconcileWeeklyEnterpriseFactMigration(store:DataStore,scope:Scope,ports:Ports={},control:{activateConsumer?:boolean}={}):Promise<Receipt>{
 return withExecutionPackageGate(store,scope,async assert=>{
 const now=ports.now??(()=>new Date().toISOString());
 const where={tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion};
 let found=(await rows(store,WEEKLY_ENTERPRISE_FACT_MIGRATIONS,where)).map(checked);
 if(found.length>1)throw Error('weekly_fact_migration_receipt_ambiguous');
 let receipt=found[0]??null;
 if(!receipt){
  receipt=await (async()=>{
   const raced=(await rows(store,WEEKLY_ENTERPRISE_FACT_MIGRATIONS,where)).map(checked);if(raced.length>1)throw Error('weekly_fact_migration_receipt_ambiguous');if(raced[0])return raced[0];
   const preflight=await preflightWeeklyEnterpriseFactRevision(store,scope),source=preflight.sourcePackage;
   const id=socialRequestHash({schemaVersion:'weekly-enterprise-fact-migration.v1',source:scope,sourceWeekStart:source.weekStart,factRef:preflight.currentFactRef,factHash:preflight.currentFactHash,sourcePublicationHash:socialRequestHash(source.socialContentPackage.publicationTasks)}).slice(0,32);
   const createdAt=now(),value=sealed({schemaVersion:'weekly-enterprise-fact-migration.v1',migrationId:id,source:scope,sourceWeekStart:source.weekStart,sourcePublicationHash:socialRequestHash(source.socialContentPackage.publicationTasks),targetPublicationHash:socialRequestHash(preflight.publicationTasks),factRef:preflight.currentFactRef,factHash:preflight.currentFactHash,state:'planned',revisedVersion:null,targetVersion:null,createdAt,updatedAt:createdAt});
   await assert();const created=await store.create(WEEKLY_ENTERPRISE_FACT_MIGRATIONS,{id,tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,state:value.state,record_hash:value.recordHash,payload:value,created_at:createdAt,updated_at:createdAt});
   if(!created){const row=await store.getById<Record_>(WEEKLY_ENTERPRISE_FACT_MIGRATIONS,id);if(!row||checked(row).recordHash!==value.recordHash)throw Error('weekly_fact_migration_receipt_write_failed');}
   return value;
  })();
 }
 const sourceRow=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:scope.packageVersion});
 if(sourceRow.length!==1)throw Error('weekly_fact_migration_source_missing');
 const source=sourceRow[0]!.payload as WeeklyOperatingPackage;
 if(source.version!==scope.packageVersion||source.weekStart!==receipt.sourceWeekStart||socialRequestHash(source.socialContentPackage.publicationTasks)!==receipt.sourcePublicationHash||socialRequestHash(receipt.source)!==socialRequestHash(scope))throw Error('weekly_fact_migration_source_changed');
 const fact=await readWeeklyExistingFactSource(store,scope.tenantId);
 if(!refEqual(fact.ref,receipt.factRef)||fact.sourceHash!==receipt.factHash)throw Error('weekly_fact_migration_profile_changed');
 const all=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId});
 if(all.some(row=>(row.payload as WeeklyOperatingPackage).weekStart>receipt.sourceWeekStart))throw Error('weekly_fact_migration_historical_week');
 const publications=targetPublications(source,receipt.factRef);
 if(socialRequestHash(publications)!==receipt.targetPublicationHash)throw Error('weekly_fact_migration_target_changed');
 const marker=`enterprise-fact-migration:${receipt.migrationId}`;
 let revisedVersion=receipt.revisedVersion;
 if(!revisedVersion){
  const latest=await latestPackageRow(store,scope.tenantId,scope.programId,scope.packageId);
  if(latest?.payload.version===scope.packageVersion){
   const fresh=await preflightWeeklyEnterpriseFactRevision(store,scope);
   if(!refEqual(fresh.currentFactRef,receipt.factRef)||fresh.currentFactHash!==receipt.factHash||socialRequestHash(fresh.publicationTasks)!==receipt.targetPublicationHash)throw Error('weekly_fact_migration_preflight_changed');
   await assert();
   revisedVersion=ports.revise?await ports.revise(scope,publications,marker):(await createWeeklyOperatingPackageService(store).revise(scope.tenantId,scope.actorUserId,scope.programId,scope.packageId,{expectedVersion:scope.packageVersion,changeReason:`采用已确认企业事实 ${receipt.factRef.id}@${receipt.factRef.version}；${marker}；不扩大预算或对外权限`,publicationTasks:publications})).version;
  }else{
   const recovered=all.map(row=>row.payload as WeeklyOperatingPackage).filter(pkg=>pkg.packageId===scope.packageId&&pkg.previousVersion===scope.packageVersion&&String(pkg.changeReason??'').includes(marker));
   if(recovered.length!==1)throw Error('weekly_fact_migration_revision_unknown');revisedVersion=recovered[0]!.version;
  }
  await assert();receipt=await persist(store,receipt,{state:'revised',revisedVersion,targetVersion:null},now());
 }
 const revisedRows=await rows(store,'social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:revisedVersion});
 if(revisedRows.length!==1)throw Error('weekly_fact_migration_revision_missing');
 const revised=revisedRows[0]!.payload as WeeklyOperatingPackage;
 if(revised.previousVersion!==scope.packageVersion||revised.weekStart!==source.weekStart||!String(revised.changeReason??'').includes(marker)||socialRequestHash(revised.socialContentPackage.publicationTasks)!==receipt.targetPublicationHash||revised.socialContentPackage.authorization.allowRealPublishing)throw Error('weekly_fact_migration_revision_changed');
 const oldTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,scope.packageVersion),newTasks=await listWeeklyExecutionTasks(store,scope.tenantId,scope.programId,scope.packageId,revisedVersion);
 const oldOutline=oldTasks.filter(task=>task.schedule.stepKind==='business_outline'),newOutline=newTasks.filter(task=>task.schedule.stepKind==='business_outline');
 if(oldOutline.length!==1||newOutline.length!==1||(['planned','revised','schedule_blocked'].includes(receipt.state)&&(newOutline[0]!.status==='succeeded'||newOutline[0]!.resultRefs.length))||oldOutline[0]!.taskId===newOutline[0]!.taskId||newTasks.some(task=>oldTasks.some(old=>old.taskId===task.taskId)))throw Error('weekly_fact_migration_old_execution_reused');
 if(receipt.state==='independent_active')return receipt;
 if(receipt.state==='schedule_blocked'||receipt.state==='activating_independent'){
  if(control.activateConsumer!==true)return receipt;
  const independentScope={...scope,packageVersion:revisedVersion};
  const admitted=ports.blockedAdmission?receipt.state==='activating_independent'||await ports.blockedAdmission(independentScope):await (async()=>{
   const schedules=await rows(store,AUTOMATIC_WEEKLY_SCHEDULES,{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:revisedVersion});
   const schedule=schedules[0]?.payload as {status?:string;targetVersion?:number|null}|undefined;
   if(schedules.length!==1||schedule?.status!=='blocked'||schedule.targetVersion!==null)return false;
   if(receipt.state==='activating_independent')return true;
   const checks=await Promise.all(newTasks.filter(task=>['business_outline','benchmark_collection'].includes(task.schedule.stepKind)).map(task=>readWeeklyAutomaticPreproductionAdmission(store,task,now())));
   return checks.length>0&&checks.every(check=>check?.authority==='independent_preproduction_window_only'&&check.userApproval===null&&check.outboundAuthorization===false&&check.proposalId===checks[0]?.proposalId);
  })();
  if(!admitted)throw Error('weekly_fact_migration_independent_admission_missing');
  if(receipt.state==='schedule_blocked'){
   await assert();receipt=await persist(store,receipt,{state:'activating_independent',revisedVersion,targetVersion:null},now());
  }
  await assert();if(ports.bind)await ports.bind(independentScope);
  else{const discovery=await uniqueApprovedWeeklyDiscoveryAuthority(store,scope.tenantId);if(!discovery)throw Error('weekly_fact_migration_discovery_authority_missing');await connectAndBindWeeklyAutomaticSchedule(store,independentScope,discovery);}
  await assert();return persist(store,receipt,{state:'independent_active',revisedVersion,targetVersion:null},now());
 }
 let targetVersion=receipt.targetVersion;
 if(!targetVersion){
  await assert();
  const proposed=ports.schedule?await ports.schedule({...scope,packageVersion:revisedVersion}):await createWeeklyAutomaticScheduleService(store).apply({...scope,packageVersion:revisedVersion}) as {status:'scheduled'|'blocked';targetVersion:number|null};
  if(proposed.status==='blocked'&&proposed.targetVersion===null){await assert();return persist(store,receipt,{state:'schedule_blocked',revisedVersion,targetVersion:null},now());}
  if(proposed.status!=='scheduled'||proposed.targetVersion===null)throw Error('weekly_fact_migration_schedule_invalid');
  targetVersion=proposed.targetVersion;
  if(!Number.isSafeInteger(targetVersion)||targetVersion!==revisedVersion+1)throw Error('weekly_fact_migration_schedule_invalid');
  await assert();receipt=await persist(store,receipt,{state:'scheduled',revisedVersion,targetVersion},now());
 }
 const target=await latestPackageRow(store,scope.tenantId,scope.programId,scope.packageId);
 if(target?.payload.version!==targetVersion||target.payload.weekStart!==source.weekStart||target.payload.socialContentPackage.authorization.allowRealPublishing||target.payload.socialContentPackage.publicationTasks.some(pub=>pub.factRefs.length!==1||!refEqual(pub.factRefs[0]!,receipt.factRef)))throw Error('weekly_fact_migration_target_changed');
 if(targetVersion>revisedVersion){
  const ref=(target.payload as WeeklyOperatingPackage&{scheduleRevisionRef?:VersionedSocialRef}).scheduleRevisionRef;
  if(!ref)throw Error('weekly_fact_migration_schedule_snapshot_missing');
  const snapshot=await readScheduleSnapshot(store,scope.tenantId,target.payload,ref);
  if(snapshot.sourceVersion!==revisedVersion||snapshot.targetVersion!==targetVersion||snapshot.automaticAdoption?.source!=='automatic_template'||snapshot.automaticAdoption.userApproval!==null)throw Error('weekly_fact_migration_schedule_snapshot_invalid');
 }
 if(control.activateConsumer===true&&receipt.state!=='completed'){
  const nextScope={...scope,packageVersion:targetVersion};
  await assert();if(ports.bind)await ports.bind(nextScope);
  else{
   const discovery=await uniqueApprovedWeeklyDiscoveryAuthority(store,scope.tenantId);
   if(!discovery)throw Error('weekly_fact_migration_discovery_authority_missing');
   await connectAndBindWeeklyAutomaticSchedule(store,nextScope,discovery);
  }
  await assert();receipt=await persist(store,receipt,{state:'completed',revisedVersion,targetVersion},now());
 }
 return receipt;
 });
}

/** Explicit second stage; its caller must decide that starting the local
 * consumer is safe under the current provider and collection gates. */
export async function activateWeeklyEnterpriseFactMigration(store:DataStore,scope:Scope,ports:Ports={}):Promise<Receipt>{
 return reconcileWeeklyEnterpriseFactMigration(store,scope,ports,{activateConsumer:true});
}
