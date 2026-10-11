import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {STARTER_198_CAPABILITIES} from '../../shared/contracts/starter198.js';
import {addSocialTaskSource} from './socialContentTasks.js';
import {defaultBrief} from './socialContentTaskSupport.js';
import {parseCreateSocialTask,parseSocialSource,socialRequestHash} from './socialContentValidation.js';
import {SOCIAL_WORK_PACKAGE_KINDS} from '../../shared/contracts/socialContentWorkflow.js';
import {resolveSocialTaskReferenceScript} from './socialContentScriptResolvers.js';
type Row = Record_ & Record<string, unknown>;

class MemoryStore implements DataStore {
  readonly rows = new Map<string, Row[]>();
  private sequence = 0;

  constructor(collections: string[]) {
    for (const name of collections) this.rows.set(name, []);
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const bucket = this.rows.get(collection) ?? [];
    const duplicate = collection === 'durable_operation_leases'
      ? bucket.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)
      : collection === 'starter_social_content_operations'
        ? bucket.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)
        : collection === 'starter_social_content_tasks'
          ? bucket.some(row => row.tenant_id === data.tenant_id && row.create_idempotency_key === data.create_idempotency_key)
          : 'last_operation_id' in data
            ? bucket.some(row => row.tenant_id === data.tenant_id && row.last_operation_id === data.last_operation_id)
            : false;
    if (duplicate) return null;
    this.sequence += 1;
    const row = { id: String(data.id || `row${String(this.sequence).padStart(12, '0')}`), ...structuredClone(data) } as Row;
    bucket.push(row);
    this.rows.set(collection, bucket);
    return structuredClone(row) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(data));
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const bucket = this.rows.get(collection) ?? [];
    const index = bucket.findIndex(row => row.id === id);
    if (index < 0) return false;
    bucket.splice(index, 1);
    return true;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}) {
    let items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      items = [...items].sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1));
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: items.slice((page - 1) * perPage, page * perPage).map(item => structuredClone(item)) as T[],
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  }
}

const limits = {
  workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 2, languageCount: 2,
  primaryPlatformCount: 2, concurrentRunCount: 1, contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
  assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

const tenant='cache-source-tenant';
const analysis={analysisRunId:'real-analysis-run',contentSha256:'a'.repeat(64),analysisMode:'exact',analysisQuality:'video',gemini:{theme:'产品信息',scriptDetails15s:[{time:'0-3',purpose:'产品钩子',visual:'产品瓶特写',shot:'近景',dialogue:'查看产品。',confidence:.98},{time:'3-38',purpose:'产品信息',visual:'产品包装展示',shot:'近景',dialogue:'联系我们。',confidence:.98}]}};
const cached={id:'cache-selected',tenantId:tenant,sourceUrl:'https://example.com/cached-38',duration:38,aiAnalysis:JSON.stringify(analysis)};
function setup(row:typeof cached|null=cached){
 const ds=new MemoryStore([...Object.values(STARTER_COLLECTIONS),'durable_operation_leases','trend_videos']);
 ds.rows.get(STARTER_COLLECTIONS.access)!.push({id:'access',tenant_id:tenant,product_profile:'starter_198',profile_version:'starter_198.v1',entitlement_snapshot_id:'snapshot',feature_entitlements:STARTER_198_CAPABILITIES.map(capability=>({capability,enabled:true})),resource_limits:limits,status:'active',cycle_started_at:'2026-10-01T00:00:00Z',cycle_ends_at:'2026-11-01T00:00:00Z',updated_at:'2026-10-11'});
 ds.rows.get(STARTER_COLLECTIONS.socialContentTasks)!.push({id:'task-row',tenant_id:tenant,task_id:'task-public',status:'draft',version:'1',source_count:0,knowledge_source_count:0,material_source_count:0,artifact_count:0,approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,brief:defaultBrief(parseCreateSocialTask({title:'已有参考制作',objective:'产品制作',creationMode:'viral_replication',productionApproach:'material_cut'})),theme_selection:{themeId:'product_value',inputKind:'preset',topic:'产品',classificationStatus:'confirmed'},package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind})),created_at:'2026-10-11',updated_at:'2026-10-11'});
 if(row)ds.rows.get('trend_videos')!.push(row);
 const repository=createStarter198Repository(ds,{materialLibrary:async()=>({items:[],totalItems:0}) as never});
 return {ds,repository};
}
const value=()=>parseSocialSource({kind:'reference_link',sourceRef:cached.sourceUrl,label:'选择已有参考',cachedReferenceRecordId:cached.id});
test('normal source service derives/persists pin before resolver and uses only its trusted cache transport',async()=>{
 const {ds,repository}=setup();let calls=0;
 const result=await addSocialTaskSource({repository,tenantId:tenant,userId:'user',taskId:'task-public',idempotencyKey:'cache-selection-1',value:value(),referenceResolver:async input=>{
  calls++;assert.deepEqual(input.referenceReuse,{recordId:cached.id,contentSha256:analysis.contentSha256,analysisId:analysis.analysisRunId,analysisHash:socialRequestHash(analysis)});assert.equal(input.referenceStore,ds);
  return resolveSocialTaskReferenceScript(input);
 }});
 assert.equal(calls,1);assert.equal(result.task.referenceVideoAnalysis?.durationSeconds,38);assert.equal(ds.rows.get(STARTER_COLLECTIONS.socialTaskSources)!.length,1);
 const brief=ds.rows.get(STARTER_COLLECTIONS.socialContentTasks)![0]!.brief as Record<string,unknown>;assert.ok(brief.referenceReuse);
 const pin=socialRequestHash(brief.referenceReuse);
 await addSocialTaskSource({repository,tenantId:tenant,userId:'user',taskId:'task-public',idempotencyKey:'cache-selection-1',value:value(),referenceResolver:resolveSocialTaskReferenceScript});
 assert.equal(ds.rows.get(STARTER_COLLECTIONS.socialTaskSources)!.length,1);assert.equal(socialRequestHash((ds.rows.get(STARTER_COLLECTIONS.socialContentTasks)![0]!.brief as Record<string,unknown>).referenceReuse),pin);
});
test('source-create failure retains visible pin but retry recovers exactly one source after storage repair',async()=>{
 const {ds,repository}=setup();const originalCreate=repository.create.bind(repository);
 repository.create=async(collection,t,data)=>{if(collection===STARTER_COLLECTIONS.socialTaskSources)throw Error('injected_source_create_failure');return originalCreate(collection,t,data);};
 const request={repository,tenantId:tenant,userId:'user',taskId:'task-public',idempotencyKey:'partial-selection',value:value(),referenceResolver:resolveSocialTaskReferenceScript};
 await assert.rejects(addSocialTaskSource(request),/injected_source_create_failure/);
 assert.equal(ds.rows.get(STARTER_COLLECTIONS.socialTaskSources)!.length,0);
 assert.ok((ds.rows.get(STARTER_COLLECTIONS.socialContentTasks)![0]!.brief as Record<string,unknown>).referenceReuse);
 repository.create=originalCreate;
 await addSocialTaskSource(request);
 assert.equal(ds.rows.get(STARTER_COLLECTIONS.socialTaskSources)!.length,1);
});
test('invalid cache selections create no sources and never reach resolver',async()=>{
 for(const row of [null,{...cached,tenantId:'victim'},{...cached,sourceUrl:'https://example.com/other'},{...cached,aiAnalysis:'{}'}]){
  const {ds,repository}=setup(row);let calls=0;
  await assert.rejects(addSocialTaskSource({repository,tenantId:tenant,userId:'user',taskId:'task-public',idempotencyKey:'bad-selection',value:value(),referenceResolver:async()=>{calls++;throw Error('must-not-resolve');}}),/social_reference_reuse_gap/);
  assert.equal(calls,0);assert.equal(ds.rows.get(STARTER_COLLECTIONS.socialTaskSources)!.length,0);assert.equal((ds.rows.get(STARTER_COLLECTIONS.socialContentTasks)![0]!.brief as Record<string,unknown>).referenceReuse,undefined);
 }
});
test('retry after a partial write cannot silently replace the frozen reference analysis', async () => {
 const {ds,repository}=setup();const originalCreate=repository.create.bind(repository);
 repository.create=async(collection,t,data)=>{if(collection===STARTER_COLLECTIONS.socialTaskSources)throw Error('injected_source_create_failure');return originalCreate(collection,t,data);};
 const request={repository,tenantId:tenant,userId:'user',taskId:'task-public',idempotencyKey:'partial-analysis-drift',value:value(),referenceResolver:resolveSocialTaskReferenceScript};
 await assert.rejects(addSocialTaskSource(request),/injected_source_create_failure/);
 const brief=ds.rows.get(STARTER_COLLECTIONS.socialContentTasks)![0]!.brief as Record<string,unknown>;
 const originalPin=socialRequestHash(brief.referenceReuse);
 ds.rows.get('trend_videos')![0]!.aiAnalysis=JSON.stringify({...analysis,analysisRunId:'later-analysis'});
 repository.create=originalCreate;
 await assert.rejects(addSocialTaskSource(request),/social_reference_cache_selection_changed/);
 assert.equal(ds.rows.get(STARTER_COLLECTIONS.socialTaskSources)!.length,0);
 assert.equal(socialRequestHash(brief.referenceReuse),originalPin);
});
