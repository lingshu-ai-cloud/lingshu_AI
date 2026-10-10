import {assertCustomerWorkspaceIdentity} from '../lib/customerWorkspaceIdentity';
import {readCustomerTaskApprovalContext,type CustomerTaskApprovalContext} from '../lib/customerTaskApprovalApi';
import FollowupTemplateEditor, { needsFollowupTemplate } from './FollowupTemplateEditor';
import { useAgentProductionAction } from '../lib/agentProductionSession';
import {readCustomerItemNavigation} from '../lib/weeklyCustomerProductionLink';
import {AUTH_TOKEN_CHANGED_EVENT,getToken} from '../lib/auth';
import { useEffect, useRef, useState } from 'react';
import { authHeader } from '../lib/auth';
import { buildTaskDeepLink, dispatchDigitalEmployeeDeepLink, type DigitalEmployeeDeepLink } from '../lib/digitalEmployees';

const secondaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-border-bright hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';
const primaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-3 py-2 text-xs font-bold text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40';

export default function CustomerWorkflowPanel({ handoff, customers }: { handoff: DigitalEmployeeDeepLink; customers: Array<{ id: string; name: string }> }) {
  const [sessionToken,setSessionToken]=useState(getToken());
  const identity=JSON.stringify([handoff.runId,handoff.taskId,handoff.businessRef.followupItemId,handoff.businessRef.customerNavigation,sessionToken]);
  const live=useRef(identity);live.current=identity;
  const panelRoot=useRef<HTMLElement|null>(null);
  const agentProduction = useAgentProductionAction('customer');
  const [workspace, setWorkspace] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [approval,setApproval]=useState<CustomerTaskApprovalContext|null>(null),[approvalObserved,setApprovalObserved]=useState(false),[approvalUnknown,setApprovalUnknown]=useState(false),[approvalOriginalHash,setApprovalOriginalHash]=useState<string|null>(null),[approvalReadBackHash,setApprovalReadBackHash]=useState<string|null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(()=>{const changed=()=>{setWorkspace(null);setApproval(null);setApprovalObserved(false);setSessionToken(getToken());};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);
  const taskKey = handoff.businessRef?.taskKey;
  const titles: Record<string, string> = { customer_attribution: '客户来源与归因', customer_segmentation: '客户分层与范围确认', followup_batch_draft: '逐客草稿与修订', followup_batch_approval: '跟进批次审批', followup_dispatch: '客户跟进执行' };
  const currentTask = workspace?.tasks?.find((task: any) => task.id === handoff.taskId);
  const segmentMode = handoff.businessRef?.taskKey === 'customer_segmentation';

  const request = async (route: string, body?: unknown) => {
    const headers=authHeader();
    const response = await fetch(`/api/overseas/digital-employees/${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if(headers.Authorization!==authHeader().Authorization)throw Error('登录身份已变化，请重新读取原客服运行。');
    if (!response.ok) throw Error(data.message || data.error || '操作失败');
    return data;
  };

  const load = async () => {
    const captured=identity;
    const binding=handoff.businessRef.followupItemId?await readCustomerItemNavigation(handoff):null;
    if(live.current!==captured||getToken()!==sessionToken)return;
    const data = await request(binding?`runs/${handoff.runId}/customer-task-navigation/workspace?taskId=${encodeURIComponent(handoff.taskId)}&itemId=${encodeURIComponent(binding.itemId)}`:`runs/${handoff.runId}/customer-workspace`);
    if(live.current!==captured||getToken()!==sessionToken)return;
    assertCustomerWorkspaceIdentity(data,handoff,binding);
    if(taskKey==='followup_batch_approval'){const original=await readCustomerTaskApprovalContext(handoff.runId,handoff.taskId);if(live.current!==captured||getToken()!==sessionToken)return;if(original.batchId!==data.batch?.id||original.batchVersion!==data.batch?.version)throw Error('工作区批次与原审批请求不一致。');setApproval(original);setApprovalReadBackHash(original.requestHash);setApprovalObserved(false);}
    setWorkspace(data);
    setDrafts(Object.fromEntries((data.items || []).map((item: any) => [item.customer_id, item.draft_body || ''])));
    setSelected((data.members || []).filter((member: any) => member.membership === 'included').map((member: any) => member.customer_id));
  };
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load().catch(error => { if (active) setError(error.message); }); };
    setWorkspace(null);setApproval(null);setApprovalObserved(false);setApprovalUnknown(false);setApprovalOriginalHash(null); setError('');setBusy(false);setSelected([]);setDrafts({});setNote(''); refresh();
    window.addEventListener('lingshu:agent-business-refresh', refresh);
    return () => { active = false; window.removeEventListener('lingshu:agent-business-refresh', refresh); };
  }, [identity]);

  useEffect(()=>{
    const itemId=handoff.businessRef.followupItemId;
    if(!workspace||typeof itemId!=='string')return;
    const target=Array.from(panelRoot.current?.querySelectorAll<HTMLElement>('[data-followup-item]')||[]).find(node=>node.dataset.followupItem===itemId);
    target?.scrollIntoView({block:'nearest'});target?.focus({preventScroll:true});
  },[workspace,identity]);

  const act = async (fn: () => Promise<unknown>) => {
    const captured=identity;
    setBusy(true);
    setError('');
    try {
      await fn();
      if(live.current!==captured||getToken()!==sessionToken)return;
      await load();
    } catch (error) {
      if(live.current===captured&&getToken()===sessionToken)setError(error instanceof Error ? error.message : '操作失败');
    } finally {
      if(live.current===captured)setBusy(false);
    }
  };

  return <section ref={panelRoot} className="mx-4 mt-3 space-y-4 border-y border-border bg-surface py-4">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-1 pb-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Customer workflow</p>
        <h3 className="mt-1 text-base font-bold text-text-primary">{titles[taskKey] || '客户任务工作区'}</h3>
      </div>
    </header>

    {(currentTask || workspace) && <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-1 pb-3 text-xs text-text-secondary">
      {currentTask && <p>{currentTask.title} · {currentTask.status}{currentTask.blocker_reason ? ` · ${currentTask.blocker_reason}` : ''}</p>}
      {workspace && <p>本轮客群 {workspace.segment?.member_count || 0} 人 · 跟进草稿 {workspace.items?.length || 0} 条</p>}
    </div>}
    {agentProduction.active && taskKey === 'followup_batch_draft' && <div className="flex flex-col items-stretch justify-between gap-3 border-l-2 border-accent bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <p className="text-xs text-text-secondary">由客户 Agent 基于当前批次生成逐客跟进草稿。</p>
      <button type="button" data-agent-action="customer-primary" disabled={!agentProduction.action || agentProduction.busy || busy} onClick={() => void act(agentProduction.execute)} className={`${primaryButton} shrink-0`}>{agentProduction.busy ? '正在生成草稿…' : agentProduction.action?.label || '等待生成跟进草稿'}</button>
    </div>}
    {workspace?.readOnly && <p className="border-l-2 border-border-bright bg-surface-2 px-3 py-2 text-xs text-text-secondary">当前历史运行或旧批次仅供查看；如需继续，请核对最新任务。</p>}
    {error && <p role="alert" className="border-l-2 border-red bg-surface-2 px-3 py-2 text-sm text-red">{error}</p>}
    {!workspace && !error && <p className="text-sm text-text-muted">正在加载本轮客户任务…</p>}

    {taskKey==='followup_batch_approval'&&approval&&<div className="space-y-2 rounded border p-3"><h4>原批次正式审批 · v{approval.batchVersion} · {approval.status}</h4><p>{approval.actionSummary}</p><p>批准保留原发送授权与安全复核，不代表消息已发送。</p><label><input type="checkbox" checked={approvalObserved} disabled={busy||approvalUnknown||!approval.canDecide} onChange={e=>setApprovalObserved(e.target.checked)}/>我已逐条核对本批次客户、内容及阻断原因</label>{(['approved','rejected'] as const).map(decision=><button key={decision} type="button" disabled={busy||approvalUnknown||!approval.canDecide||!approvalObserved||workspace?.readOnly} onClick={()=>{setApprovalOriginalHash(approval.requestHash);setApprovalReadBackHash(null);setApprovalUnknown(true);void act(async()=>{await request(`approvals/${approval.approvalId}/decide`,{decision,note,expectedSubjectVersion:String(approval.batchVersion),expectedContentHash:approval.contentHash,expectedRequestHash:approval.requestHash});});}}>{decision==='approved'?'明确批准原批次':'明确拒绝原批次'}</button>)}{approvalUnknown&&<><button type="button" disabled={busy} onClick={()=>void act(load)}>只读查询原审批结果</button>{approval.status==='pending'&&approval.canDecide&&approvalOriginalHash===approval.requestHash&&approvalReadBackHash===approval.requestHash&&<button type="button" disabled={busy} onClick={()=>{setApprovalUnknown(false);setApprovalObserved(false);}}>原请求仍待审批，重新逐条核对</button>}{approvalOriginalHash!==approval.requestHash&&<p>原审批请求已变化；保留原提交记录，不直接重发决定。</p>}</>}</div>}
    {segmentMode ? <>
      <div>
        <p className="text-sm font-bold text-text-primary">确定本轮客户范围</p>
        <p className="mt-1 text-xs text-text-muted">选择本轮纳入的客户，形成可追溯的分层快照。</p>
      </div>
      <div className="grid max-h-56 overflow-auto border-y border-border sm:grid-cols-2">
        {!customers.length && <p className="px-3 py-6 text-center text-sm text-text-muted sm:col-span-2">当前没有可纳入的客户，需先接入或导入客户。</p>}
        {customers.map((customer, index) => <label key={customer.id} className={`flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-text-secondary transition hover:bg-surface-2 ${index % 2 === 0 && index < customers.length - 1 ? 'sm:border-r sm:border-border' : ''} ${index < customers.length - 1 ? 'border-b border-border' : ''} ${index < customers.length - (customers.length % 2 || 2) ? 'sm:border-b' : 'sm:border-b-0'}`}>
          <input className="accent-accent" type="checkbox" disabled={workspace?.readOnly} checked={selected.includes(customer.id)} onChange={event => setSelected(event.target.checked ? [...selected, customer.id] : selected.filter(id => id !== customer.id))} />
          {customer.name}
        </label>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryButton}
          data-agent-action="customer-primary"
          disabled={agentProduction.active ? !agentProduction.action || agentProduction.busy : busy || workspace?.readOnly || !selected.length}
          onClick={() => void act(() => agentProduction.active
            ? agentProduction.execute()
            : request(`runs/${handoff.runId}/customer-segments`, { name: '用户确认的本轮客户', criteria: { match: 'all', minIntentScore: 0, includeCustomerIds: selected } }))}
        >
          {busy ? '正在生成分层…' : '确认客群并生成草稿'}
        </button>
        {workspace?.segment && <p className="border-l-2 border-accent pl-3 text-xs text-text-secondary">已保存：纳入 {workspace.segment.member_count} 人，排除 {workspace.segment.excluded_count} 人。</p>}
      </div>
    </> : workspace?.batch ? <>
      <p className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs text-amber">批次 v{workspace.batch.version} · {workspace.batch.status}。修改后保存为新版本，原审批失效，需重新批准。</p>
      <div className="grid max-h-[28rem] overflow-auto border-y border-border md:grid-cols-2">
        {(workspace.items || []).map((item: any, index: number) => <div key={item.id} data-followup-item={item.id} tabIndex={-1} className={`px-3 py-4 ${index % 2 === 0 && index < (workspace.items || []).length - 1 ? 'md:border-r md:border-border' : ''} ${index < (workspace.items || []).length - 1 ? 'border-b border-border' : ''} ${index < (workspace.items || []).length - ((workspace.items || []).length % 2 || 2) ? 'md:border-b' : 'md:border-b-0'}`}>
          <label className="block text-sm font-bold text-text-primary">
            {item.customer_name}
            <textarea readOnly={workspace?.readOnly} className="ui-field mt-2 min-h-28 !rounded-md !px-3 !py-2 !text-sm !leading-6" value={drafts[item.customer_id] || ''} onChange={event => setDrafts({ ...drafts, [item.customer_id]: event.target.value })} />
            {(needsFollowupTemplate(item) || item.exclusion_reason) && <span className="mt-2 block text-xs font-medium text-amber">{needsFollowupTemplate(item) ? '需要配置已获批的 WhatsApp 模板' : item.exclusion_reason}</span>}
          </label>
          {!workspace.readOnly && needsFollowupTemplate(item) && <FollowupTemplateEditor batchId={workspace.batch.id} itemId={item.id} onSaved={load} />}
        </div>)}
      </div>
      <label className="block text-xs font-bold text-text-secondary">
        草稿修订意见
        <textarea aria-label="草稿修订意见" placeholder="告诉 Agent 每位买家需要如何改写" className="ui-field mt-2 min-h-24 !rounded-md !px-3 !py-2 !text-sm !leading-6" value={note} onChange={event => setNote(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || workspace?.readOnly} className={primaryButton} onClick={() => void act(() => request(`followup-batches/${workspace.batch.id}/revise`, { version: workspace.batch.version, drafts, note }))}>保存修改并重新提交审批</button>
        <button type="button" disabled={busy || workspace?.readOnly || !note.trim()} className={secondaryButton} onClick={() => void act(() => request(`followup-batches/${workspace.batch.id}/revise`, { version: workspace.batch.version, regenerate: true, note }))}>{busy ? '正在处理…' : '按意见重新生成并提交审批'}</button>
      </div>
    </> : workspace && <div className="border-y border-border bg-surface-2 px-4 py-7 text-center">
      <p className="text-sm text-text-secondary">{taskKey === 'customer_attribution' ? '此任务用于核对客户来源，尚未进入草稿生成。' : workspace.segment ? '客群已建立，草稿尚未生成。请查看草稿任务的执行状态。' : '本轮尚未建立客群，请先完成客户分层。'}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">{(workspace.tasks || []).filter((task: any) => ['customer_segmentation', 'followup_batch_draft'].includes(task.task_key) && task.id !== handoff.taskId).map((task: any) => <button key={task.id} type="button" className={secondaryButton} onClick={() => dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(task, undefined, handoff.runId))}>查看{task.title}</button>)}</div>
    </div>}
  </section>;
}
