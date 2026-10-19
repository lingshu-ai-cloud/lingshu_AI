import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {OperatingAuthoritySnapshot,BusinessContentGoal} from '../../shared/contracts/socialOperatingDecision.js';
import {verifyEnterpriseFactContent,type EnterpriseProfile} from '../routes/enterprise.js';
import {readWeeklyExistingFactSource} from './weeklyExistingFactSource.js';
import {latestPackageRow} from './weeklyOperatingPackageSupport.js';
import {socialJson,socialObject} from '../starter198/socialContentValidation.js';
import {evaluateProductionOutlineReadiness} from '../socialOperating/productionReadiness.js';
import {executionPackageFrozen} from './weeklyExecutionGate.js';

const parse=<T>(value:unknown)=>socialObject(socialJson(value)) as T;
async function exact(store:DataStore,collection:string,where:Record<string,string|number>){
 const found=await store.list<Record_>(collection,{where,page:1,perPage:2});
 if(found.totalItems!==1||found.items.length!==1)throw Error('weekly_fact_revision_authority_missing');
 return found.items[0]!;
}

/** Read-only gate for the latest natural week's immutable fact revision.
 * A caller must still create a durable migration receipt, use normal revise,
 * and reconnect accepted-template schedule/preproduction authority. */
export async function preflightWeeklyEnterpriseFactRevision(store:DataStore,input:{tenantId:string;programId:string;packageId:string;packageVersion:number}){
 const latest=await latestPackageRow(store,input.tenantId,input.programId,input.packageId);
 if(!latest||latest.payload.version!==input.packageVersion||latest.payload.status!=='draft')throw Error('weekly_fact_revision_source_not_latest');
 if(await executionPackageFrozen(store,input))throw Error('weekly_fact_revision_source_frozen');
 const packages=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:input.tenantId,program_id:input.programId},page:1,perPage:500});
 if(packages.totalItems!==packages.items.length||packages.items.some(row=>!row.payload))throw Error('weekly_fact_revision_week_scan_incomplete');
 const newer=packages.items.some(row=>{
  const pkg=parse<WeeklyOperatingPackage>(row.payload);
  return pkg.weekStart>latest.payload.weekStart;
 });
 if(newer)throw Error('weekly_fact_revision_historical_week');
 const source=await readWeeklyExistingFactSource(store,input.tenantId);
 const profileRow=await exact(store,'tenant_profiles',{tenant_id:input.tenantId});
 const profile=parse<EnterpriseProfile>(profileRow.profile);
 if(!verifyEnterpriseFactContent(profile).verified||profile.factVersion?.id!==source.ref.id||profile.factVersion?.revision!==source.ref.version)throw Error('weekly_fact_revision_profile_changed');
 const pubs=latest.payload.socialContentPackage.publicationTasks;
 if(!pubs.length||pubs.some(pub=>!pub.factRefs.length||pub.factRefs.some(ref=>ref.type!=='enterprise_fact')))throw Error('weekly_fact_revision_frozen_facts_missing');
 if(pubs.every(pub=>pub.factRefs.every(ref=>ref.id===source.ref.id&&ref.version===source.ref.version)))throw Error('weekly_fact_revision_already_current');
 const snapshotRef=latest.payload.operatingDecisionSnapshotRef,goalRef=latest.payload.businessContentGoalRef;
 if(snapshotRef?.type!=='operating_authority_snapshot'||goalRef?.type!=='business_content_goal')throw Error('weekly_fact_revision_operating_authority_missing');
 const snapshot=parse<OperatingAuthoritySnapshot>((await exact(store,'social_operating_authority_snapshots',{tenant_id:input.tenantId,program_id:input.programId,snapshot_id:snapshotRef.id,version:snapshotRef.version})).payload);
 const goal=parse<BusinessContentGoal>((await exact(store,'social_business_content_goals',{tenant_id:input.tenantId,program_id:input.programId,goal_id:goalRef.id,version:goalRef.version})).payload);
 if(snapshot.planningWeekStart!==latest.payload.weekStart||snapshot.businessContentGoalRef.id!==goalRef.id||snapshot.businessContentGoalRef.version!==goalRef.version||goal.programId!==input.programId||goal.goalId!==goalRef.id||goal.version!==goalRef.version||!evaluateProductionOutlineReadiness(goal).ready)throw Error('weekly_fact_revision_operating_authority_changed');
 const statements=new Set([profile.company?.description,profile.brand?.usp,profile.products?.highlights,profile.products?.certifications,...(profile.products?.items??[]).flatMap(p=>[p.name,p.highlights,p.certifications])].map(s=>String(s??'').trim().slice(0,1000)).filter(Boolean));
 if(snapshot.enterprise.publicFacts.some(f=>!statements.has(f.statement))||goal.publicFactRefs.some(ref=>!snapshot.enterprise.publicFacts.some(f=>f.ref.id===ref.id&&f.ref.version===ref.version)))throw Error('weekly_fact_revision_business_facts_changed');
 return {sourcePackage:latest.payload,currentFactRef:source.ref,currentFactHash:source.sourceHash,publicationTasks:pubs.map(pub=>({...pub,factRefs:[source.ref]}))};
}
