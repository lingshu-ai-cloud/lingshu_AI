import {readTemplateCarryoverPlans} from './weeklyTemplateCarryoverConfirmation';
import {authHeader,getToken} from './auth';
import {parseScheduleTargetGraph} from './socialProgramApi';
import type {WeeklyInitialSchedulePreview} from '../../shared/contracts/weeklyInitialSchedule';
import type {WeeklyScheduleCapacityInput,WeeklyScheduleProposal,WeeklyScheduleConfirmation,WeeklyScheduleConfirmationReceipt} from '../../shared/contracts/socialWeeklyScheduleRevision';
export interface InitialScheduleScope{tenantId:string;programId:string;packageId:string;packageVersion:number;}
const fail=():never=>{throw Error('首次排期回执与当前周草稿不一致，请重新读取。');};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const missing=['remainingMinutes','remainingCostCny','bufferMinutes','resourceKey','availableAt','resourceWorkingWindows'];
export function parseInitialSchedulePreview(v:unknown,s:InitialScheduleScope):WeeklyInitialSchedulePreview{
 if(!plain(v)||v.authority!=='estimated_task_durations_only'||!plain(v.graph)||!Array.isArray(v.requiredInputs))return fail();
 const graph=parseScheduleTargetGraph(v.graph as unknown as WeeklyInitialSchedulePreview['graph'],s);
 if(v.requiredInputs.length!==graph.tasks.length||new Set(v.requiredInputs.map(r=>plain(r)?r.taskId:null)).size!==graph.tasks.length)return fail();
 for(const r of v.requiredInputs){if(!plain(r))return fail();const task=graph.tasks.find(t=>t.taskId===r.taskId);if(!task||r.estimatedMinutes!==task.schedule.estimatedDurationMinutes||r.suggestedStartAt!==(task.schedule.latestStartAt??null)||r.suggestedFinishAt!==(task.schedule.latestFinishAt??null)||typeof r.estimatedMinutes!=='number'||!Number.isFinite(r.estimatedMinutes)||r.estimatedMinutes<0||!Array.isArray(r.missing)||JSON.stringify(r.missing)!==JSON.stringify(missing)||[r.suggestedStartAt,r.suggestedFinishAt].some(x=>x!==null&&(typeof x!=='string'||!Number.isFinite(Date.parse(x)))))return fail();}
 return v as unknown as WeeklyInitialSchedulePreview;
}
export function parseInitialScheduleProposal(v:unknown,s:InitialScheduleScope,id?:string):WeeklyScheduleProposal{
 if(!plain(v)||v.tenantId!==s.tenantId||v.programId!==s.programId||v.packageId!==s.packageId||v.packageVersion!==s.packageVersion||typeof v.proposalId!=='string'||!v.proposalId||(id&&v.proposalId!==id)||!hash(v.inputEvidenceHash)||!plain(v.plan)||!Array.isArray(v.plan.assignments)||typeof v.plan.fullGraphConditionallyReachable!=='boolean'||!plain(v.capacity)||v.inputAuthority!=='target_graph_with_verified_source_tasks_and_user_confirmed_capacity'||!v.targetGraph)return fail();
 parseScheduleTargetGraph(v.targetGraph as WeeklyScheduleProposal['targetGraph'] & {},s);readTemplateCarryoverPlans(v as unknown as WeeklyScheduleProposal);return v as unknown as WeeklyScheduleProposal;
}
export function parseInitialScheduleConfirmation(v:unknown,s:InitialScheduleScope,id:string,evidenceHash:string):WeeklyScheduleConfirmation{
 if(!plain(v)||!plain(v.item)||!plain(v.snapshot)||v.item.programId!==s.programId||v.item.packageId!==s.packageId||v.item.version!==s.packageVersion+1||v.item.status!=='draft'||v.snapshot.tenantId!==s.tenantId||v.snapshot.programId!==s.programId||v.snapshot.packageId!==s.packageId||v.snapshot.sourceVersion!==s.packageVersion||v.snapshot.targetVersion!==s.packageVersion+1||v.snapshot.proposalId!==id||v.snapshot.inputEvidenceHash!==evidenceHash||v.activated!==false||typeof v.previousPublishingAuthorizationRevoked!=='boolean'||!Array.isArray(v.materialConsumerRepairs)||v.materialConsumerRepairs.some(r=>!plain(r)||typeof r.requestId!=='string'||typeof r.reason!=='string'))return fail();return v as unknown as WeeklyScheduleConfirmation;
}
export function parseInitialScheduleConfirmationReceipt(v:unknown,s:InitialScheduleScope,id:string):WeeklyScheduleConfirmationReceipt{
 if(!plain(v)||v.proposalId!==id||v.sourceVersion!==s.packageVersion||v.targetVersion!==s.packageVersion+1||!['not_committed','pending_recovery','committed'].includes(String(v.status)))return fail();
 if(v.status==='not_committed'){if('snapshot'in v||'item'in v)return fail();return v as unknown as WeeklyScheduleConfirmationReceipt;}
 if(!plain(v.snapshot)||v.snapshot.proposalId!==id||v.snapshot.tenantId!==s.tenantId||v.snapshot.programId!==s.programId||v.snapshot.packageId!==s.packageId||v.snapshot.sourceVersion!==s.packageVersion||v.snapshot.targetVersion!==s.packageVersion+1)return fail();
 if(v.status==='pending_recovery'){if('item'in v)return fail();return v as unknown as WeeklyScheduleConfirmationReceipt;}
 if(!plain(v.item)||v.item.programId!==s.programId||v.item.packageId!==s.packageId||v.item.version!==s.packageVersion+1||v.item.previousVersion!==s.packageVersion||v.item.status!=='draft'||v.activated!==false)return fail();
 return v as unknown as WeeklyScheduleConfirmationReceipt;
}
const path=(s:InitialScheduleScope)=>`/api/overseas/social-programs/${encodeURIComponent(s.programId)}/operating-packages/${encodeURIComponent(s.packageId)}/initial-schedule`;
async function request(s:InitialScheduleScope,suffix:string,body?:unknown){const token=getToken();if(!token)throw Error('请登录后确认首次排期。');const r=await fetch(path(s)+suffix,{method:body===undefined?'GET':'POST',headers:{...authHeader(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',redirect:'error'});const v:unknown=await r.json();if(getToken()!==token)throw Error('登录身份已变化，旧排期结果不能用于当前视图。');if(!r.ok)throw Error(plain(v)&&typeof v.error==='string'?v.error:plain(v)&&typeof v.message==='string'?v.message:'首次容量排期未完成，请读取原周草稿核验。');return v;}
export const weeklyInitialScheduleApi={
 async preview(s:InitialScheduleScope){const v=await request(s,`?version=${s.packageVersion}`);return parseInitialSchedulePreview(plain(v)?v.item:null,s);},
 async propose(s:InitialScheduleScope,capacity:WeeklyScheduleCapacityInput){const v=await request(s,'/proposals',{packageVersion:s.packageVersion,capacity});return parseInitialScheduleProposal(plain(v)?v.item:null,s);},
 async readProposal(s:InitialScheduleScope,proposalId:string){const v=await request(s,`/proposals/${encodeURIComponent(proposalId)}?version=${s.packageVersion}`);return parseInitialScheduleProposal(plain(v)?v.item:null,s,proposalId);},
 async readConfirmation(s:InitialScheduleScope,proposalId:string){const v=await request(s,`/confirmations/${encodeURIComponent(proposalId)}?version=${s.packageVersion}`);return parseInitialScheduleConfirmationReceipt(plain(v)?v.item:null,s,proposalId);},
 async confirm(s:InitialScheduleScope,input:{proposalId:string;expectedVersion:number;inputEvidenceHash:string;confirmedTemplateCarryoverPlanHashes?:string[]}){if(input.expectedVersion!==s.packageVersion||!hash(input.inputEvidenceHash))return fail();return parseInitialScheduleConfirmation(await request(s,'/confirm',{packageVersion:s.packageVersion,...input}),s,input.proposalId,input.inputEvidenceHash);},
};
