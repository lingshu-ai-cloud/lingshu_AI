import { useAgentProductionAction } from '../lib/agentProductionSession';
import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
import type { DigitalEmployeeDeepLink } from '../lib/digitalEmployees';

export default function CustomerWorkflowPanel({ handoff, customers }: { handoff: DigitalEmployeeDeepLink; customers: Array<{ id: string; name: string }> }) {
  const agentProduction = useAgentProductionAction('customer');
  const [workspace, setWorkspace] = useState<any>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const segmentMode = handoff.businessRef?.taskKey === 'customer_segmentation';
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(`/api/overseas/digital-employees/${route}`, { method: body ? 'POST' : 'GET', headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (!response.ok) throw Error(data.message || data.error || '操作失败'); return data;
  };
  const load = async () => {
    const data = await request(`runs/${handoff.runId}/customer-workspace`);
    setWorkspace(data); setDrafts(Object.fromEntries((data.items || []).map((item: any) => [item.customer_id, item.draft_body || ''])));
    setSelected((data.members || []).filter((member: any) => member.membership === 'included').map((member: any) => member.customer_id));
  };
  useEffect(() => { setError(''); void load().catch(error => setError(error.message)); }, [handoff.runId]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); } finally { setBusy(false); } };
  return <section className="mx-4 mt-3 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
    <div className="flex justify-between"><h3 className="font-bold">{segmentMode ? '客户分层与范围确认' : '逐客草稿与修订'}</h3><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'digitalEmployees' } }))}>返回交付看板</button></div>
    {workspace?.readOnly && <p className="text-xs text-slate-600">此历史运行仅供查看；如需继续，请制定新目标。</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!workspace && !error && <p>正在加载本轮客户任务…</p>}
    {segmentMode ? <><p className="text-xs">选择本轮纳入的客户，形成可追溯的分层快照。</p><div className="flex max-h-48 flex-wrap gap-3 overflow-auto">{customers.map(customer => <label key={customer.id} className="text-sm"><input type="checkbox" disabled={workspace?.readOnly} checked={selected.includes(customer.id)} onChange={event => setSelected(event.target.checked ? [...selected, customer.id] : selected.filter(id => id !== customer.id))} /> {customer.name}</label>)}</div><button type="button" className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50" data-agent-action="customer-primary" disabled={agentProduction.active ? !agentProduction.action || agentProduction.busy : busy || workspace?.readOnly || !selected.length} onClick={() => void act(() => agentProduction.active ? agentProduction.execute() : request(`runs/${handoff.runId}/customer-segments`, { name: '用户确认的本轮客户', criteria: { match: 'all', minIntentScore: 0, includeCustomerIds: selected } }))}>{busy ? '正在生成分层…' : '确认客群并生成草稿'}</button>{workspace?.segment && <p className="text-xs">已保存：纳入 {workspace.segment.member_count} 人，排除 {workspace.segment.excluded_count} 人。</p>}</> : workspace?.batch ? <>
      <p className="text-xs">批次 v{workspace.batch.version} · {workspace.batch.status}。修改后保存为新版本，原审批失效，需重新批准。</p>
      <div className="grid max-h-96 gap-3 overflow-auto md:grid-cols-2">{(workspace.items || []).map((item: any) => <label key={item.id} className="text-sm">{item.customer_name}<textarea readOnly={workspace?.readOnly} className="mt-1 min-h-28 w-full rounded border p-2" value={drafts[item.customer_id] || ''} onChange={event => setDrafts({ ...drafts, [item.customer_id]: event.target.value })} /><span className="text-xs text-amber-700">{item.exclusion_reason}</span></label>)}</div>
      <textarea aria-label="草稿修订意见" placeholder="告诉 Agent 每位买家需要如何改写" className="w-full rounded border p-2 text-sm" value={note} onChange={event => setNote(event.target.value)} />
      <div className="flex gap-3"><button type="button" disabled={busy || workspace?.readOnly} className="rounded bg-blue-700 p-2 text-sm text-white" onClick={() => void act(() => request(`followup-batches/${workspace.batch.id}/revise`, { version: workspace.batch.version, drafts, note }))}>保存修改并重新提交审批</button><button type="button" disabled={busy || workspace?.readOnly || !note.trim()} className="rounded border bg-white p-2 text-sm" onClick={() => void act(() => request(`followup-batches/${workspace.batch.id}/revise`, { version: workspace.batch.version, regenerate: true, note }))}>{busy ? '正在处理…' : '按意见重新生成并提交审批'}</button></div>
    </> : workspace && <p>本轮尚无跟进草稿，请先返回分层任务确认客群。</p>}
  </section>;
}
