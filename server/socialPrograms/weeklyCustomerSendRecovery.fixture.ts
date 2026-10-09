import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {WEEKLY_CUSTOMER_BINDINGS} from '../runtime/socialWeeklyCustomerBridge.js';
import {readWeeklyCustomerRelationshipScope,evaluateWeeklyCustomerRelationship} from './weeklyCustomerRelationshipScope.js';
export function sendRecoveryFixture() {
  const scope = { tenant_id: 'tenant', goal_id: 'goal', plan_id: 'plan', run_id: 'run' };
  const taskKeys = ['customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'];
  const data: Record<string, Record_[]> = {
 users:[{id:'owner',tenantId:'tenant',role:'customer_service'},{id:'issuer',tenantId:'tenant',role:'admin'},{id:'stranger',tenantId:'tenant',role:'customer_service'}],
    social_weekly_operating_packages: [{ id: 'pkg', tenant_id: 'tenant', program_id: 'program', package_id: 'week', version: 1, payload: { programId: 'program', packageId: 'week', version: 1, weekStart: '2026-10-05', weekEnd: '2026-10-11' } }],
    workflow_runs: [{ id: 'run', ...scope, status: 'running' }],
    weekly_goals: [{ id: 'goal', tenant_id: 'tenant', business_line: 'customer_conversion', starts_at: '2026-10-05T00:00:00Z', ends_at: '2026-10-11T23:59:59Z' }],
    weekly_plans: [{ id: 'plan', tenant_id: 'tenant', goal_id: 'goal' }],
    workflow_tasks: taskKeys.map(key => ({ id: key, ...scope, task_key: key, agent_role: 'customer', status: 'succeeded' })),
    customer_segments: [{ id: 'segment', ...scope, task_id: 'customer_segmentation', status: 'generated', version: 1, criteria: {}, criteria_hash: createHash('sha256').update('{}').digest('hex'), snapshot_at: '2026-10-06T10:00:00Z', member_count: 1 }],
    customer_segment_members: [{ id: 'member', tenant_id: 'tenant', segment_id: 'segment', customer_id: 'buyer', customer_snapshot: { id: 'buyer', name: 'Real persisted buyer' }, membership: 'included' }],
    followup_batches: [{ id: 'batch', ...scope, task_id: 'followup_batch_draft', segment_id: 'segment', version: 2, content_hash: 'batch-hash', approval_id: 'approval', approved_version: 2, approved_by: 'owner' }],
    followup_batch_items: [{ id: 'item', tenant_id: 'tenant', batch_id: 'batch', segment_member_id: 'member', customer_id: 'buyer', draft_body: 'Approved buyer-specific draft', content_hash: createHash('sha256').update(JSON.stringify('Approved buyer-specific draft')).digest('hex'), send_mode: 'session_message', status: 'sent', exclusion_reason: '', provider_message_id: 'wamid.real-provider-receipt', provider_receipt: { id: 'wamid.real-provider-receipt' }, sent_at: '2026-10-06T12:00:00Z' }],
    approval_requests: [{ id: 'approval', ...scope, task_id: 'followup_batch_approval', subject_version: 2, content_hash: 'batch-hash', status: 'approved', decided_by: 'owner', decided_at: '2026-10-06T11:00:00Z' }],
  };
  data.social_programs=[{id:'program-row',tenant_id:'tenant',program_id:'program',payload:{route:'account_repair'}}];
  data.whatsapp_customers=[{id:'buyer-row',tenant_id:'tenant',customer_id:'buyer',payload:{id:'buyer',tenantId:'tenant'}}];
  data.whatsapp_interactions=[{id:'prior-row',tenant_id:'tenant',customer_id:'buyer',interaction_id:'prior',payload:{id:'prior',tenantId:'tenant',customerId:'buyer',type:'msg_in',body:'Real prior conversation',timestamp:Date.parse('2026-09-01T00:00:00Z'),metaMessageId:'wamid.prior'}}];
  const batchHash = createHash('sha256').update(JSON.stringify(data.followup_batch_items!.map(row => row.content_hash))).digest('hex');
  data.followup_batches![0]!.content_hash = batchHash; data.approval_requests![0]!.content_hash = batchHash;
  const store = {
    async getById<T>(collection: string, id: string) { return (data[collection]?.find(row => row.id === id) ?? null) as T | null; },
    async list<T>(collection: string, query: any = {}) { const found = (data[collection] ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)); const per = query.perPage ?? 250; const page = query.page ?? 1; return { items: found.slice((page - 1) * per, page * per) as T[], totalItems: found.length, totalPages: Math.ceil(found.length / per), page, perPage: per }; },
    async create<T>(collection: string, values: Record<string, unknown>) { const row = { id: `${collection}-${data[collection]?.length ?? 0}`, ...values }; (data[collection] ??= []).push(row); if(collection===WEEKLY_CUSTOMER_BINDINGS){const rs=await readWeeklyCustomerRelationshipScope(store,'tenant',String(values.run_id));if(rs)for(const member of data.customer_segment_members??[]){const relation=await evaluateWeeklyCustomerRelationship(store,rs,String(member.customer_id));member.customer_snapshot={...(member.customer_snapshot as object),weeklyRelationship:relation.frozen};}} return row as T; },
    async update<T>(collection:string,id:string,patch:Record<string,unknown>){const row=data[collection]?.find(r=>r.id===id);if(!row)return null;Object.assign(row,patch);return row as T;},
  } as unknown as DataStore;
  return { store, data };
}