import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';
import {createWeeklyAutomaticScheduleService,AUTOMATIC_WEEKLY_SCHEDULES} from './weeklyAutomaticSchedule.js';
import {connectAndBindWeeklyAutomaticSchedule,uniqueApprovedWeeklyDiscoveryAuthority,type ApprovedWeeklyDiscoveryAuthority,type WeeklyAutomaticExecutionScope} from './weeklyAutomaticScheduleFlow.js';
import {readIndependentAdmission} from './weeklyIndependentAdmission.js';
import {readWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {latestPackageRow,PACKAGES} from './weeklyOperatingPackageSupport.js';
import {WEEKLY_PREPRODUCTION_JOBS,type WeeklyPreproductionJob} from '../runtime/weeklyPreproductionProducer.js';

export const WEEKLY_DISCOVERY_SCOPE_MIGRATIONS='social_weekly_discovery_scope_migrations';

interface MigrationReceipt {
  schemaVersion:'weekly-discovery-scope-migration.v1';
  migrationId:string;
  source:WeeklyAutomaticExecutionScope;
  oldAuthority:ApprovedWeeklyDiscoveryAuthority&{scopeHash:string};
  nextAuthority:ApprovedWeeklyDiscoveryAuthority&{scopeHash:string};
  oldJobIds:string[];
  state:'planned'|'revised'|'scheduled'|'completed'|'superseded';
  revisedVersion:number|null;
  targetVersion:number|null;
  createdAt:string;
  updatedAt:string;
  recordHash:string;
}

type Advance=(input:{receipt:MigrationReceipt;authority:ApprovedWeeklyDiscoveryAuthority})=>Promise<{revisedVersion:number;targetVersion:number}>;

const sealed=(value:Omit<MigrationReceipt,'recordHash'>|MigrationReceipt):MigrationReceipt=>{
  const {recordHash:_recordHash,...body}=value as MigrationReceipt;
  return {...body,recordHash:socialRequestHash(body)} as MigrationReceipt;
};
const valid=(row:Record_):MigrationReceipt=>{
  const value=row.payload as MigrationReceipt;
  if(!value||value.schemaVersion!=='weekly-discovery-scope-migration.v1'||value.migrationId!==row.id||value.recordHash!==socialRequestHash((({recordHash:_recordHash,...body})=>body)(value))||row.record_hash!==value.recordHash)throw Error('weekly_discovery_scope_migration_corrupt');
  return value;
};

async function rows(store:DataStore,collection:string,where:Record<string,string|number>={}){
  const result:Record_[]=[];
  for(let page=1;page<=1000;page++){
    const found=await store.list<Record_>(collection,{where,page,perPage:250,sort:'id'});
    result.push(...found.items);
    if(page>=found.totalPages){if(result.length!==found.totalItems)throw Error('weekly_discovery_scope_migration_scan_incomplete');return result;}
    if(!found.items.length)throw Error('weekly_discovery_scope_migration_scan_incomplete');
  }
  throw Error('weekly_discovery_scope_migration_scan_limit');
}

async function readScheduleTarget(store:DataStore,source:WeeklyAutomaticExecutionScope):Promise<number|null>{
  const found=await rows(store,AUTOMATIC_WEEKLY_SCHEDULES,{tenant_id:source.tenantId,program_id:source.programId,package_id:source.packageId,package_version:source.packageVersion});
  if(found.length>1)throw Error('weekly_discovery_scope_schedule_ambiguous');
  if(!found.length)return null;
  const row=found[0]!,payload=row.payload as Record<string,unknown>;
  if(row.content_hash!==socialRequestHash(payload))throw Error('weekly_template_schedule_receipt_invalid');
  const target=Number(payload.targetVersion);
  return Number.isSafeInteger(target)&&target>source.packageVersion?target:null;
}

async function defaultAdvance(store:DataStore,input:{receipt:MigrationReceipt;authority:ApprovedWeeklyDiscoveryAuthority}){
  const packages=createWeeklyOperatingPackageService(store);
  const marker=`discovery-scope-migration:${input.receipt.migrationId}`;
  let revisedVersion=input.receipt.revisedVersion;
  if(!revisedVersion){
    const latest=await latestPackageRow(store,input.receipt.source.tenantId,input.receipt.source.programId,input.receipt.source.packageId);
    if(latest?.payload.version===input.receipt.source.packageVersion){
      const revised=await packages.revise(input.receipt.source.tenantId,input.receipt.source.actorUserId,input.receipt.source.programId,input.receipt.source.packageId,{expectedVersion:input.receipt.source.packageVersion,changeReason:`自动迁移已批准采集范围 ${input.receipt.oldAuthority.scopeId}@${input.receipt.oldAuthority.scopeVersion} → ${input.authority.scopeId}@${input.authority.scopeVersion}；${marker}；不扩大预算、发布或消息权限`});
      revisedVersion=revised.version;
    }else{
      const candidates=await rows(store,PACKAGES,{tenant_id:input.receipt.source.tenantId,program_id:input.receipt.source.programId,package_id:input.receipt.source.packageId});
      const recovered=candidates.map(row=>row.payload as WeeklyOperatingPackage).filter(pkg=>pkg.previousVersion===input.receipt.source.packageVersion&&String(pkg.changeReason||'').includes(marker));
      if(recovered.length!==1)throw Error('weekly_discovery_scope_revision_changed');
      revisedVersion=recovered[0]!.version;
    }
  }
  const revisedScope={...input.receipt.source,packageVersion:revisedVersion};
  let targetVersion=await readScheduleTarget(store,revisedScope);
  if(!targetVersion){
    const latest=await latestPackageRow(store,revisedScope.tenantId,revisedScope.programId,revisedScope.packageId);
    if(latest?.payload.version!==revisedVersion)throw Error('weekly_discovery_scope_schedule_changed');
    const scheduled=await createWeeklyAutomaticScheduleService(store).apply(revisedScope) as {targetVersion?:number|null};
    // The accepted template explicitly admits independent preproduction even
    // when the complete publication graph is not yet feasible. This mirrors
    // the authenticated route: no schedule revision means continue on the
    // current immutable package revision, never manufacture another approval.
    targetVersion=scheduled.targetVersion??revisedVersion;
    if(!Number.isSafeInteger(targetVersion)||targetVersion<revisedVersion)throw Error('weekly_discovery_scope_schedule_not_ready');
  }
  await connectAndBindWeeklyAutomaticSchedule(store,{...revisedScope,packageVersion:targetVersion},input.authority);
  return {revisedVersion,targetVersion};
}

/**
 * Reconcile a retired discovery authority only for an already opted-in current
 * weekly package. Old jobs are immutable; recovery produces a new package graph
 * and binds its new consumers to the one current approved scope.
 */
export async function reconcileWeeklyDiscoveryScopeMigrations(
  store:DataStore,
  ports:{now?:()=>string;advance?:Advance}={},
):Promise<{migrated:number;deferred:number}>{
  let migrated=0,deferred=0;
  const packageRows=await rows(store,PACKAGES);
  const latestByPackage=new Map<string,WeeklyOperatingPackage>();
  for(const row of packageRows){
    const pkg=row.payload as WeeklyOperatingPackage,key=[row.tenant_id,row.program_id,row.package_id].join('\0'),prior=latestByPackage.get(key);
    if(pkg&&Number.isSafeInteger(pkg.version)&&(!prior||pkg.version>prior.version))latestByPackage.set(key,pkg);
  }
  const newestWeekByProject=new Map<string,string>();
  for(const [key,pkg] of latestByPackage){
    const [tenantId,programId]=key.split('\0'),project=[tenantId,programId].join('\0'),prior=newestWeekByProject.get(project);
    if(!prior||pkg.weekStart>prior)newestWeekByProject.set(project,pkg.weekStart);
  }
  const handledProjects=new Set<string>();
  // A prior attempt may have committed the immutable package revision before
  // consumer binding. Resume its durable intent before discovering new work.
  const pending=(await rows(store,WEEKLY_DISCOVERY_SCOPE_MIGRATIONS)).map(valid).filter(item=>!['completed','superseded'].includes(item.state));
  for(const receipt of pending){
    const sourcePackage=packageRows.map(row=>row.payload as WeeklyOperatingPackage).find(pkg=>pkg.packageId===receipt.source.packageId&&pkg.programId===receipt.source.programId&&pkg.version===receipt.source.packageVersion);
    const project=[receipt.source.tenantId,receipt.source.programId].join('\0');
    if(!sourcePackage)throw Error('weekly_discovery_scope_migration_source_missing');
    if(sourcePackage.weekStart!==newestWeekByProject.get(project)){
      const now=ports.now?.()??new Date().toISOString(),superseded=sealed({...receipt,state:'superseded',updatedAt:now});
      if(!await store.update(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,receipt.migrationId,{state:superseded.state,record_hash:superseded.recordHash,payload:superseded,updated_at:now}))throw Error('weekly_discovery_scope_migration_write_failed');
      continue;
    }
    const authority=await uniqueApprovedWeeklyDiscoveryAuthority(store,receipt.source.tenantId),scope=authority&&await store.getById<Record_>('social_discovery_scopes',authority.scopeId);
    if(!authority||!scope||authority.scopeId!==receipt.nextAuthority.scopeId||authority.scopeVersion!==receipt.nextAuthority.scopeVersion||socialRequestHash(scope.payload)!==receipt.nextAuthority.scopeHash){deferred+=1;handledProjects.add(project);continue;}
    const result=await (ports.advance??(value=>defaultAdvance(store,value)))({receipt,authority});
    const now=ports.now?.()??new Date().toISOString(),completed=sealed({...receipt,state:'completed',revisedVersion:result.revisedVersion,targetVersion:result.targetVersion,updatedAt:now});
    if(!await store.update(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,receipt.migrationId,{state:completed.state,record_hash:completed.recordHash,payload:completed,updated_at:now}))throw Error('weekly_discovery_scope_migration_write_failed');
    migrated+=1;handledProjects.add(project);
  }
  const jobs=(await rows(store,WEEKLY_PREPRODUCTION_JOBS)).map(row=>{
    const job=row.payload as WeeklyPreproductionJob;
    if(!job||row.id!==job.jobId||row.tenant_id!==job.tenantId||row.program_id!==job.programId||row.package_id!==job.packageId||row.package_version!==job.packageVersion||row.record_hash!==job.recordHash||job.recordHash!==socialRequestHash({...job,recordHash:''}))throw Error('weekly_preproduction_job_corrupt');
    return job;
  }).filter(job=>job.kind==='discovery'&&job.authority?.scopeId&&['bound','blocked','no_data','running','unknown'].includes(job.status));
  const groups=new Map<string,WeeklyPreproductionJob[]>();
  for(const job of jobs){const key=[job.tenantId,job.programId,job.packageId,job.packageVersion].join('\0');groups.set(key,[...(groups.get(key)??[]),job]);}
  // Match the resident executor: one project has one current natural-week
  // window. Historical packages remain audit evidence and must not be revised
  // merely because their old discovery authority was later retired.
  const currentGroups:Array<{group:WeeklyPreproductionJob[];pkg:WeeklyOperatingPackage}>=[];
  for(const group of groups.values()){
    const first=group[0]!,latest=await latestPackageRow(store,first.tenantId,first.programId,first.packageId);
    const project=[first.tenantId,first.programId].join('\0');
    if(!handledProjects.has(project)&&latest&&latest.payload.version===first.packageVersion&&latest.payload.status==='draft'&&latest.payload.weekStart===newestWeekByProject.get(project))currentGroups.push({group,pkg:latest.payload});
  }
  const selected=new Map<string,{group:WeeklyPreproductionJob[];pkg:WeeklyOperatingPackage}>();
  for(const candidate of currentGroups){
    const first=candidate.group[0]!,key=[first.tenantId,first.programId].join('\0'),prior=selected.get(key);
    if(!prior||candidate.pkg.weekStart>prior.pkg.weekStart||candidate.pkg.weekStart===prior.pkg.weekStart&&candidate.pkg.version>prior.pkg.version)selected.set(key,candidate);
  }
  for(const {group} of selected.values()){
    const first=group[0]!;
    const oldIds=[...new Set(group.map(job=>job.authority!.scopeId))];
    if(oldIds.length!==1||group.some(job=>['running','unknown'].includes(job.status))){deferred+=1;continue;}
    const oldScope=await store.getById<Record_>('social_discovery_scopes',oldIds[0]!);
    if(!oldScope||oldScope.status==='active')continue;
    const next=await uniqueApprovedWeeklyDiscoveryAuthority(store,first.tenantId);
    if(!next||next.scopeId===oldScope.id){deferred+=1;continue;}
    const nextScope=await store.getById<Record_>('social_discovery_scopes',next.scopeId);
    if(!nextScope){deferred+=1;continue;}
    const source:WeeklyAutomaticExecutionScope={tenantId:first.tenantId,programId:first.programId,packageId:first.packageId,packageVersion:first.packageVersion,actorUserId:first.actorUserId};
    const [admission,template]=await Promise.all([readIndependentAdmission(store,source),readWeeklyAutomationTemplate(store,source)]);
    if(!admission||!template||admission.actorUserId!==first.actorUserId){deferred+=1;continue;}
    const oldAuthority={scopeId:String(oldScope.id),scopeVersion:Number(oldScope.version),requestedModes:[...group[0]!.authority!.requestedModes],scopeHash:socialRequestHash(oldScope.payload)};
    const nextAuthority={...next,scopeHash:socialRequestHash(nextScope.payload)};
    const migrationId=socialRequestHash({schemaVersion:'weekly-discovery-scope-migration.v1',source,oldAuthority,nextAuthority,oldJobIds:group.map(job=>job.jobId).sort(),templateVersion:template.template.version}).slice(0,32);
    let row=await store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,migrationId),receipt:MigrationReceipt;
    if(row)receipt=valid(row);
    else{
      const now=ports.now?.()??new Date().toISOString();
      receipt=sealed({schemaVersion:'weekly-discovery-scope-migration.v1',migrationId,source,oldAuthority,nextAuthority,oldJobIds:group.map(job=>job.jobId).sort(),state:'planned',revisedVersion:null,targetVersion:null,createdAt:now,updatedAt:now});
      const created=await store.create<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,{id:migrationId,tenant_id:source.tenantId,program_id:source.programId,package_id:source.packageId,package_version:source.packageVersion,state:receipt.state,record_hash:receipt.recordHash,payload:receipt,created_at:now,updated_at:now});
      row=created??await store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,migrationId);
      if(!row)throw Error('weekly_discovery_scope_migration_write_failed');
      receipt=valid(row);
    }
    if(receipt.state==='completed'){migrated+=1;continue;}
    const result=await (ports.advance??(value=>defaultAdvance(store,value)))({receipt,authority:next});
    const now=ports.now?.()??new Date().toISOString();
    const completed=sealed({...receipt,state:'completed',revisedVersion:result.revisedVersion,targetVersion:result.targetVersion,updatedAt:now});
    if(!await store.update(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,migrationId,{state:completed.state,record_hash:completed.recordHash,payload:completed,updated_at:now}))throw Error('weekly_discovery_scope_migration_write_failed');
    migrated+=1;
  }
  return {migrated,deferred};
}
