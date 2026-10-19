import type {DataStore,Record_} from '../storage/datastore.js';
import type {SocialCrawlStrategy,SocialDiscoveryMode} from '../../shared/contracts/socialContentWorkflow.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {organizationRoleOrNull} from '../lib/organizationRole.js';
import {readWeeklyReviewActor} from '../socialPrograms/weeklyReviewEvidence.js';

const COLLECTION='social_discovery_scopes';
type ScopeRow=Record_&{tenant_id:string;version:number;status:string;payload:SocialCrawlStrategy};
type AccountRow=Record_&{tenantId:string;platform:string;accountUrl:string};

export interface WeeklyAccountScopeRevisionInput {
  tenantId:string; actorUserId:string; accountId:string;
  expectedScopeId:string; expectedScopeVersion:number; expectedScopeHash:string;
  expectedProductFactBindingHash:string; targetCount:5;
}

function fail(code:string):never{throw Error(code);}
function validTikTokAccount(url:string){
  try {const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname==='www.tiktok.com'&&/^\/@[A-Za-z0-9._]{2,24}\/?$/.test(parsed.pathname)&&!parsed.search&&!parsed.hash;}
  catch{return false;}
}

/** Only a currently registered account and a user-approved scope may yield a new weekly source target. */
export async function reviseWeeklyAccountCollectionScope(store:DataStore,input:WeeklyAccountScopeRevisionInput){
  if(!store.compareAndSwap||await store.supportsAtomicCompareAndSwap?.()===false)fail('weekly_account_scope_atomic_storage_required');
  if(!input.tenantId||!input.actorUserId||!input.accountId||!input.expectedScopeId||!Number.isSafeInteger(input.expectedScopeVersion)||input.expectedScopeVersion<1||input.targetCount!==5)fail('weekly_account_scope_input_invalid');
  const actor=await readWeeklyReviewActor(store,input.tenantId,input.actorUserId);
  if(!actor||actor.tenantId!==input.tenantId||!['super_admin','admin','social_operator'].includes(organizationRoleOrNull(actor.role)??'')||actor.disabled===true||actor.active===false||['disabled','suspended'].includes(String(actor.status)))fail('weekly_account_scope_actor_forbidden');
  const [old,account]=await Promise.all([store.getById<ScopeRow>(COLLECTION,input.expectedScopeId),store.getById<AccountRow>('competitor_accounts',input.accountId)]);
  if(!old||old.tenant_id!==input.tenantId||old.version!==input.expectedScopeVersion||socialRequestHash(old.payload)!==input.expectedScopeHash||old.payload?.approval?.status!=='approved'||old.payload.approval.scopeVersion!==old.version)fail('weekly_account_scope_source_changed');
  if(!account||account.tenantId!==input.tenantId||account.platform!=='tiktok'||!validTikTokAccount(account.accountUrl))fail('weekly_account_scope_account_invalid');
  const binding=(old.payload as SocialCrawlStrategy&{productFactBinding?:unknown}).productFactBinding;
  if(!binding||socialRequestHash(binding)!==input.expectedProductFactBindingHash)fail('weekly_account_scope_product_fact_changed');
  const oldBrief=old.payload.discoveryBrief;
  if(!oldBrief||!Array.isArray(oldBrief.platforms)||!oldBrief.platforms.includes('tiktok')||!Array.isArray(oldBrief.discoveryModes)||!Array.isArray(oldBrief.competitorAccounts))fail('weekly_account_scope_mode_invalid');
  const oldAccounts=[...new Set(oldBrief.competitorAccounts)];
  if(oldAccounts.length>5)fail('weekly_account_scope_daily_capacity_exceeded');
  const library=await store.list<AccountRow>('competitor_accounts',{where:{tenantId:input.tenantId},page:1,perPage:200});
  if(library.totalItems!==library.items.length||library.totalPages>1||socialRequestHash([...new Set([...oldAccounts,account.accountUrl])].sort())!==socialRequestHash(library.items.map(row=>row.accountUrl).sort()))fail('weekly_account_scope_library_changed');
  const accounts=oldAccounts.includes(account.accountUrl)?oldAccounts:[...oldAccounts,account.accountUrl];
  if(accounts.length+input.targetCount-1>10)fail('weekly_account_scope_daily_capacity_exceeded');
  const version=old.version+1;
  const now=new Date().toISOString();
  const payload:SocialCrawlStrategy=structuredClone(old.payload);
  payload.keywordSet.version=version;
  payload.discoveryBrief.keywordSetVersion=version;
  payload.discoveryBrief.competitorAccounts=accounts;
  payload.discoveryBrief.discoveryModes=[...new Set<SocialDiscoveryMode>([...oldBrief.discoveryModes,'account'])];
  payload.discoveryBrief.modePolicies={...oldBrief.modePolicies,account:{...(oldBrief.modePolicies?.account??{platforms:['tiktok'],resultLimit:10,refreshIntervalMinutes:1440,budgetLimitCny:null}),enabled:true,sourceRefs:accounts}};
  payload.discoveryBrief.weeklyAccountCollectionTarget={accountUrl:account.accountUrl,targetCount:5};
  payload.benchmarkAccounts=[...payload.benchmarkAccounts.filter(row=>row.accountRef!==account.accountUrl),{accountRef:account.accountUrl,type:'expression_reference',weight:0.7}];
  payload.approval={status:'approved',approvedBy:'user',approvedByUserId:input.actorUserId,approvedAt:now,scopeVersion:version};
  (payload as SocialCrawlStrategy&{weeklyAccountRevision?:unknown}).weeklyAccountRevision={sourceScopeId:old.id,sourceScopeVersion:old.version,sourceScopeHash:input.expectedScopeHash,accountId:account.id,accountUrl:account.accountUrl,productFactBindingHash:input.expectedProductFactBindingHash,approvedByUserId:input.actorUserId,targetCount:5};
  const id=socialRequestHash({kind:'weekly-account-scope-revision.v1',tenantId:input.tenantId,sourceScopeId:old.id,sourceScopeHash:input.expectedScopeHash,accountId:account.id,targetCount:5}).slice(0,15);
  let next=await store.getById<ScopeRow>(COLLECTION,id);
  if(next&&next.tenant_id!==input.tenantId)fail('weekly_account_scope_revision_conflict');
  if(!next){next=await store.create<ScopeRow>(COLLECTION,{id,tenant_id:input.tenantId,keyword_set_id:old.keyword_set_id,version,status:'pending_activation',payload,created_by:input.actorUserId,created_at:now,updated_at:now});if(!next)next=await store.getById<ScopeRow>(COLLECTION,id);}
  const storedRevision=(next?.payload as SocialCrawlStrategy&{weeklyAccountRevision?:Record<string,unknown>})?.weeklyAccountRevision;
  if(!next||next.version!==version||next.status!=='pending_activation'&&next.status!=='active'||!storedRevision||storedRevision.sourceScopeId!==old.id||storedRevision.sourceScopeHash!==input.expectedScopeHash||storedRevision.accountId!==account.id||storedRevision.accountUrl!==account.accountUrl||storedRevision.productFactBindingHash!==input.expectedProductFactBindingHash||storedRevision.approvedByUserId!==input.actorUserId||storedRevision.targetCount!==5||next.payload.discoveryBrief.weeklyAccountCollectionTarget?.accountUrl!==account.accountUrl||next.payload.discoveryBrief.weeklyAccountCollectionTarget.targetCount!==5)fail('weekly_account_scope_revision_conflict');
  const active=await store.list<ScopeRow>(COLLECTION,{where:{tenant_id:input.tenantId,status:'active'},page:1,perPage:20});
  if(active.totalItems>1||active.items.some(row=>row.id!==old.id&&row.id!==id))fail('weekly_account_scope_active_changed');
  if(old.status==='active'){
    if(!await store.compareAndSwap(COLLECTION,old.id,{status:'active',version:old.version},{status:'retired',updated_at:new Date().toISOString()}))fail('weekly_account_scope_source_changed');
  }else if(old.status!=='retired')fail('weekly_account_scope_source_changed');
  if(next.status!=='active'&&!await store.compareAndSwap(COLLECTION,id,{status:'pending_activation',version},{status:'active',updated_at:new Date().toISOString()}))fail('weekly_account_scope_activation_unknown');
  return {scopeId:id,scopeVersion:version,scopeHash:socialRequestHash(next.payload),accountUrl:account.accountUrl,targetCount:5};
}
