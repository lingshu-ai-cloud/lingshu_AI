import type {WeeklyScheduleProposal} from '../../shared/contracts/socialWeeklyScheduleRevision';
import type {WeeklyContentTemplateRevisionPlan} from '../../shared/contracts/socialWeeklyContentTemplates';
const fail=():never=>{throw Error('模板承接计划与原周包或目标版本不一致，请重新生成提案。');};
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const ref=(v:unknown,type:string)=>!!v&&typeof v==='object'&&'type'in v&&v.type===type&&'id'in v&&typeof v.id==='string'&&!!v.id&&'version'in v&&Number.isSafeInteger(v.version)&&Number(v.version)>0;
export function readTemplateCarryoverPlans(proposal:Pick<WeeklyScheduleProposal,'tenantId'|'programId'|'packageId'|'packageVersion'|'templateCarryovers'>):WeeklyContentTemplateRevisionPlan[]{
 if(proposal.templateCarryovers===undefined)return [];if(!Array.isArray(proposal.templateCarryovers))return fail();const plans=proposal.templateCarryovers;
 if(new Set(plans.map(p=>p?.planHash)).size!==plans.length)return fail();
 for(const p of plans){if(!p||!p.sourceScope||!p.targetScope||p.sourceScope.tenantId!==proposal.tenantId||p.sourceScope.programId!==proposal.programId||p.sourceScope.packageId!==proposal.packageId||p.sourceScope.packageVersion!==proposal.packageVersion||p.targetScope.tenantId!==proposal.tenantId||p.targetScope.programId!==proposal.programId||p.targetScope.packageId!==proposal.packageId||p.targetScope.packageVersion!==proposal.packageVersion+1||p.targetScope.publicationTaskId!==p.sourceScope.publicationTaskId||!p.sourceScope.publicationTaskId||!ref(p.sourceBindingRef,'weekly_content_template_binding')||!ref(p.targetBindingRef,'weekly_content_template_binding')||!ref(p.templateRef,'weekly_content_template')||![p.sourceBindingHash,p.sourcePackageHash,p.sourcePublicationHash,p.candidateHash,p.planHash].every(hash)||typeof p.confirmationId!=='string'||!p.confirmationId||typeof p.plannedBy!=='string'||!p.plannedBy)return fail();}
 return plans;
}
export function explicitlyConfirmedTemplatePlans(proposal:Parameters<typeof readTemplateCarryoverPlans>[0],checked:string[]):string[]{const plans=readTemplateCarryoverPlans(proposal),required=plans.map(p=>p.planHash);if(!Array.isArray(checked)||new Set(checked).size!==checked.length||checked.length!==required.length||checked.some(h=>!required.includes(h)))throw Error('请逐条明确同意模板承接；未同意的绑定不能迁移到新版本。');return [...checked];}
