import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {WEEKLY_AUTOMATION_TEMPLATE} from '../../shared/weeklyAutomationTemplate.js';
import type {ExecutionPackageScope} from './weeklyExecutionGate.js';
import {SocialProgramError} from './service.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
export const WEEKLY_TEMPLATE_ADOPTIONS='social_weekly_template_adoptions';
const id=(s:ExecutionPackageScope)=>createHash('sha256').update(JSON.stringify([s.tenantId,s.programId,s.packageId,s.packageVersion,WEEKLY_AUTOMATION_TEMPLATE.version])).digest('hex');
export async function readWeeklyAutomationTemplate(store:DataStore,s:ExecutionPackageScope){
 const row=await store.getById<Record_>(WEEKLY_TEMPLATE_ADOPTIONS,id(s));if(!row)return null;
 const p=row.payload as {scope:ExecutionPackageScope;template:typeof WEEKLY_AUTOMATION_TEMPLATE;adoptedAt:string;source:string;actorUserId:string;userApproval:null};
 const scope={tenantId:s.tenantId,programId:s.programId,packageId:s.packageId,packageVersion:s.packageVersion};
 if(!p||row.tenant_id!==s.tenantId||row.program_id!==s.programId||row.package_id!==s.packageId||row.package_version!==s.packageVersion||socialRequestHash(p.scope)!==socialRequestHash(scope)||socialRequestHash(p.template)!==socialRequestHash(WEEKLY_AUTOMATION_TEMPLATE)||p.source!=='automatic_template'||typeof p.actorUserId!=='string'||!p.actorUserId.trim()||p.userApproval!==null||!Number.isFinite(Date.parse(p.adoptedAt)))throw new SocialProgramError('weekly_template_adoption_invalid',409,'默认模板留痕无效，未继续执行。');
 return p;
}
/** Caller holds authenticated, current-version package gate. No approvals granted. */
export async function adoptWeeklyAutomationTemplate(store:DataStore,s:ExecutionPackageScope,actorUserId:string){
 const old=await readWeeklyAutomationTemplate(store,s);if(old)return old;
 const scope={tenantId:s.tenantId,programId:s.programId,packageId:s.packageId,packageVersion:s.packageVersion};
 const payload={scope,template:WEEKLY_AUTOMATION_TEMPLATE,source:'automatic_template',adoptedAt:new Date().toISOString(),actorUserId,userApproval:null};
 if(!await store.create(WEEKLY_TEMPLATE_ADOPTIONS,{id:id(s),tenant_id:s.tenantId,program_id:s.programId,package_id:s.packageId,package_version:s.packageVersion,payload}))throw new SocialProgramError('weekly_template_adoption_write_failed',503,'默认模板未能留痕。');
 return payload;
}
