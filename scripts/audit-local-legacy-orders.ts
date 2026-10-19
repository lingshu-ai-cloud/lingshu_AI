/** Explicit local-only repair. Never runs from HTTP GET or background startup. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pbStore} from '../server/storage/pbStore.js';
import {runWithDataAuthority} from '../server/storage/dataAuthority.js';
import {createStarter198Repository} from '../server/starter198/repository.js';
import {inspectSocialContentLegacyOrderMigration,applySocialContentLegacyOrderMigration} from '../server/starter198/socialContentLegacyOrderMigration.js';

const args=process.argv.slice(2),tenantId=args.find(a=>a.startsWith('--tenant='))?.slice(9);
if(!tenantId||!process.env.ENABLE_LOCAL_DEV_FALLBACK||process.env.LOCAL_STORE_DIR)throw new Error('Explicit tenant and default local development store required');
const apply=args.includes('--apply'),root=path.resolve('data');
const read=(relative:string):any=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
await runWithDataAuthority('local',async()=>{
 const repository=createStarter198Repository(pbStore);
 const inspectLegacyExecutionEvidence=async({taskId}:{tenantId:string;taskId:string})=>{
  const projects=[...(read('local-store/studio_projects.json')??[]),...(read('studio-projects.json')??[])];
  const linked=projects.filter(p=>{const s=typeof p.spec==='string'?JSON.parse(p.spec):p.spec;return s?.socialContentTaskId===taskId;});
  const paid=read('studio-presenter-paid-budget/ledger.json');
  const budgetDir=path.join(root,'social-content-task-budget');
  const budgets=fs.existsSync(budgetDir)?fs.readdirSync(budgetDir):[];
  const missingProofs:string[]=[];
  // Empty Studio state does not prove its earlier paid calls never happened.
  if(linked.length)missingProofs.push('studio_project_original_run_provider_receipt_and_cost_mapping_required');
  if(!paid||paid.version!==1||paid.openingUsed!==0||Object.keys(paid.entries??{}).length)missingProofs.push('studio_paid_budget_entries_or_opening_balance_reconciliation_required');
  // Unknown filenames cannot be treated as zero cost or assigned by guessing.
  if(budgets.length)missingProofs.push('file_budget_task_identity_mapping_required');
  const runs=read('local-store/workflow_runs.json')??[];
  const matchingRuns=runs.filter((r:any)=>r.tenant_id===tenantId&&(JSON.stringify(r.starter_context??{}).includes(taskId)||r.task_id===taskId));
  if(matchingRuns.length)missingProofs.push('workflow_run_original_budget_and_queue_mapping_required');
  return{verified:missingProofs.length===0,missingProofs,evidence:{authority:'local',linkedStudioProjects:linked.map(p=>({id:p.id,status:p.status,snapshotHash:hash(p)})),studioPaidLedgerHash:hash(paid),fileBudgetInventory:budgets,matchingRunIds:matchingRuns.map((r:any)=>r.id),unrelatedRunIds:runs.filter((r:any)=>!matchingRuns.includes(r)).map((r:any)=>r.id),scope:'unstarted_draft_only_no_zero_cost_inference_for_started_work'}};
 };
 const rows=await repository.list('starter_social_content_tasks',tenantId,{perPage:1000});
 if(rows.items.length!==rows.totalItems)throw new Error('Incomplete task inventory');
 const preserved=()=>Object.fromEntries(fs.readdirSync(path.join(root,'local-store')).filter(f=>f.endsWith('.json')&&!['starter_social_content_tasks.json','durable_operation_leases.json'].includes(f)).map(f=>[f,hash(read(`local-store/${f}`))]));
 const before=preserved(),paidBefore=hash(read('studio-presenter-paid-budget/ledger.json'));
 const results=[];
 for(const task of rows.items){
  const input={repository,tenantId,taskId:String(task.task_id),inspectLegacyExecutionEvidence};
  const plan=await inspectSocialContentLegacyOrderMigration(input);
  let status:string=plan.status;
  if(apply&&plan.status==='eligible'){
   // Maintenance actor is explicitly distinct from the historical creator.
   await applySocialContentLegacyOrderMigration({...input,actorId:'maintenance:local-legacy-order-audit',expectedEvidenceHash:plan.evidenceHash});
   status='migrated';
  }
  results.push({taskId:task.task_id,title:(typeof task.brief==='string'?JSON.parse(task.brief):task.brief as any)?.title,status,evidenceHash:plan.evidenceHash,missingProofs:plan.missingProofs});
 }
 for(const [file,digest] of Object.entries(before))if(preserved()[file]!==digest)throw new Error(`Protected history changed:${file}`);
 if(hash(read('studio-presenter-paid-budget/ledger.json'))!==paidBefore)throw new Error('Paid history changed');
 const after=await repository.list('starter_social_content_tasks',tenantId,{perPage:1000});
 const normalize=(r:any)=>{const {content_order,updated,...original}=r;return original;};
 if(hash(rows.items.map(normalize))!==hash(after.items.map(normalize)))throw new Error('Non-order task history changed');
 console.log(JSON.stringify({authority:'local',apply,protectedHistoryUnchanged:true,results},null,2));
});
