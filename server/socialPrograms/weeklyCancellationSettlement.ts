import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {StoredPublicationAssignment} from '../publishing/weeklyLineage.js';
import {assertWeeklyPublicationStoredScope} from '../publishing/weeklyFormalPublicationBoundary.js';
import {readStarterPublicationPackage} from '../publishing/starterPublicationPackage.js';
import {publicationInstant} from './publicationDeadlines.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyCancellationSettlement} from '../../shared/contracts/weeklyCancellationSettlement.js';
import {readWeeklyCancellationReceipt} from './weeklyCancellation.js';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
async function unique<T extends {id:string}=Record_>(store:DataStore,collection:string,where:Record<string,string|number>){const rows=await store.list<T & Record_>(collection,{where,page:1,perPage:2});return rows.totalItems===1&&rows.items.length===1&&Object.entries(where).every(([k,v])=>rows.items[0]?.[k]===v)?rows.items[0]:null;}
export async function readWeeklyCancellationSettlements(input:{dataStore:DataStore;tenantId:string;programId:string;packageId:string;packageVersion:number;now?:Date}):Promise<WeeklyCancellationSettlement[]>{
 const receipt=await readWeeklyCancellationReceipt(input);if(!receipt)return [];const now=(input.now??new Date()).getTime();return Promise.all(receipt.effects.map(async effect=>{
 const base={resourceType:effect.resourceType,resourceId:effect.resourceId,resolvedAt:null};
 if(effect.resourceType!=='publication_attempt')return {...base,status:'unverified' as const,gap:'production_receipt_requires_actual_reconciliation'};
 const fail=(gap:string):WeeklyCancellationSettlement=>({...base,status:'unverified',gap});
 const attempt=await unique(input.dataStore,'social_publication_attempts',{tenant_id:input.tenantId,id:effect.resourceId});if(!attempt)return fail('original_attempt_missing_or_ambiguous');
 const assignment=await unique<StoredPublicationAssignment>(input.dataStore,'social_publication_assignments',{tenant_id:input.tenantId,assignment_id:String(attempt.assignment_id)});const payload=object(assignment?.payload),lineage=object(payload.lineage),program=object(lineage.programRef),pkg=object(lineage.operatingPackageRef);
 if(!assignment||assignment.operating_package_id!==input.packageId||assignment.operating_package_version!==input.packageVersion||assignment.package_id!==attempt.package_id||payload.tenantId!==input.tenantId||payload.assignmentId!==attempt.assignment_id||payload.packageId!==attempt.package_id||program.id!==input.programId||pkg.id!==input.packageId||pkg.version!==input.packageVersion||payload.assignmentHash!==assignment.assignment_hash||payload.platform!==assignment.platform)return fail('original_attempt_scope_changed');
 const week=await unique(input.dataStore,'social_weekly_operating_packages',{tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId,version:input.packageVersion});if(!week)return fail('original_week_missing');try{assertWeeklyPublicationStoredScope(assignment,week.payload as WeeklyOperatingPackage);}catch{return fail('original_assignment_frozen_scope_changed');}
 const manifest=await readStarterPublicationPackage(input.tenantId,String(attempt.package_id),input.dataStore).catch(()=>null);const manifestLineage=manifest?.operatingLineage;if(!manifest||!manifestLineage||manifest.packageId!==assignment.package_id||manifest.platform!==assignment.platform||manifestLineage.assignmentId!==assignment.assignment_id||manifestLineage.assignmentHash!==assignment.assignment_hash||manifestLineage.productionResultRef.id!==assignment.production_result_id)return fail('original_manifest_changed');
 const expected=assignment.platform==='tiktok'?'tiktok-content-posting-api':assignment.platform==='youtube'?'youtube-data-api':['instagram','facebook'].includes(String(assignment.platform))?'meta-graph-api':null;if(!expected||attempt.provider!==expected)return fail('provider_identity_unverified');
 if(!['published','failed'].includes(String(attempt.status)))return {...base,status:'unknown' as const,gap:'platform_receipt_still_unknown'};
 const started=publicationInstant(String(attempt.started_at)),resolved=publicationInstant(String(attempt.resolved_at));if(started===null||resolved===null||started>resolved||resolved>now)return fail('resolution_time_unverified');
 if(attempt.status==='published'&&(!attempt.provider_receipt_id||!attempt.platform_post_id||String(attempt.provider_receipt_id).startsWith('simr_')))return fail('published_receipt_missing');if(attempt.status==='failed'&&!attempt.failure_code)return fail('failure_receipt_missing');
 return {...base,status:attempt.status as 'published'|'failed',resolvedAt:String(attempt.resolved_at),gap:null};
 }));
}
