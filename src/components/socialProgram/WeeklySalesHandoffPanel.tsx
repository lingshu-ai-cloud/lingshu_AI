import { useEffect, useRef, useState } from 'react';
import type { WeeklyCustomerRelationshipCheck } from '../../../shared/contracts/customerRelationshipEvidence';
import {
  weeklySalesOverdue,
  type WeeklySalesHandoff,
  type WeeklySalesSource,
} from '../../../shared/contracts/socialWeeklySalesHandoff';
import { authApi, type EmployeeAccount } from '../../lib/auth';
import { weeklySalesHandoffApi } from '../../lib/weeklySalesHandoffApi';
import RelationshipEvidencePanel from './RelationshipEvidencePanel';
import SalesConversationEvidenceSelector from './SalesConversationEvidenceSelector';

export const salesPanelId = (programId: string, packageId: string, version: number, id: string) => `weekly-sales:${programId}:${packageId}:${version}:${id}`;

type Snapshot = {
  key: string;
  items: WeeklySalesHandoff[];
  sources: WeeklySalesSource[];
  gaps: string[];
  employees: EmployeeAccount[];
  relationshipChecks: WeeklyCustomerRelationshipCheck[];
};

const inputClass = 'rounded-lg border border-border bg-white p-2 text-xs';

export default function WeeklySalesHandoffPanel({
  programId,
  packageId,
  packageVersion,
}: {
  programId: string;
  packageId: string;
  packageVersion: number;
}) {
  const key = JSON.stringify([programId, packageId, packageVersion]);
  const current = useRef(key);
  current.current = key;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sourceIndex, setSourceIndex] = useState('');
  const [owner, setOwner] = useState('');
  const [claim, setClaim] = useState('');
  const [feedbackDue, setFeedbackDue] = useState('');

  const load = async () => {
    const captured = key;
    const result = await Promise.allSettled([
      weeklySalesHandoffApi.list(programId, packageId, packageVersion),
      weeklySalesHandoffApi.sources(programId, packageId, packageVersion),
      authApi.employees(),
    ]);
    if (current.current !== captured) return;
    const items = result[0].status === 'fulfilled' ? result[0].value : [];
    const sources = result[1].status === 'fulfilled'
      ? result[1].value
      : { items: [], gaps: [result[1].reason instanceof Error ? result[1].reason.message : '来源读取失败'] };
    const employees = result[2].status === 'fulfilled' ? result[2].value : [];
    setSourceIndex('');
    setSnapshot({
      key: captured,
      items,
      sources: sources.items,
      gaps: sources.gaps,
      employees,
      relationshipChecks: sources.relationshipChecks ?? [],
    });
    if (result[0].status === 'rejected') setError(result[0].reason instanceof Error ? result[0].reason.message : '交接读取失败');
  };

  useEffect(() => {
    setSnapshot(null);
    setSourceIndex('');
    setOwner('');
    setClaim('');
    setFeedbackDue('');
    setError('');
    void load().catch(cause => { if (current.current === key) setError(String(cause)); });
  }, [key]);

  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    const captured = key;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (current.current === captured) {
        await load();
        window.dispatchEvent(new Event('lingshu:agent-business-refresh'));
      }
    } catch (cause) {
      if (current.current === captured) setError(cause instanceof Error ? cause.message : '销售交接操作失败');
    } finally {
      setBusy(false);
    }
  };

  const visible = snapshot?.key === key ? snapshot : null;
  const userId = visible?.employees.find(employee => employee.isCurrent)?.id;

  return <section className="space-y-3 rounded-lg border border-border bg-white p-4">
    <h4 className="font-bold text-slate-900">真实销售交接与反馈</h4>
    <p className="text-xs text-slate-500">仅对真实客户及已批准交接资料创建；领取、反馈分别计时。处理完成表示人工处理已记录，成交需另有真实证据。</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {visible?.gaps.map((gap, index) => <p key={index} className="text-xs text-amber-800">{gap}</p>)}
    <RelationshipEvidencePanel scopeKey={key} checks={visible?.relationshipChecks ?? []} onSaved={load} />
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-bold">创建真实客户交接</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select aria-label="选择真实客户询盘" value={sourceIndex} onChange={event => setSourceIndex(event.target.value)} className={inputClass}>
          <option value="">请选择真实客户会话</option>
          {visible?.sources.map((source, index) => <option key={`${source.memberId}:${source.sourceInteractionId}`} value={index}>{source.channel || 'whatsapp'} · {source.customerName} · {source.sourceKind === 'new_inquiry' ? '新询盘' : source.sourceKind === 'existing_contact' ? '既有联系（非采购证明）' : '既有客户'} · {source.body.slice(0, 70)}</option>)}
        </select>
        <select aria-label="指定销售负责人" value={owner} onChange={event => setOwner(event.target.value)} className={inputClass}>
          <option value="">请选择真实租户成员</option>
          {visible?.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}
        </select>
        <label className="text-xs">领取截止<input type="datetime-local" value={claim} onChange={event => setClaim(event.target.value)} className={`mt-1 block ${inputClass}`} /></label>
        <label className="text-xs">反馈截止<input type="datetime-local" value={feedbackDue} onChange={event => setFeedbackDue(event.target.value)} className={`mt-1 block ${inputClass}`} /></label>
        <button
          type="button"
          disabled={busy || sourceIndex === '' || !owner || !claim || !feedbackDue}
          className="btn-primary disabled:opacity-40"
          onClick={() => void action(async () => {
            const source = visible?.sources[Number(sourceIndex)];
            if (!source) throw Error('请选择真实询盘');
            return weeklySalesHandoffApi.create(programId, packageId, {
              packageVersion,
              runId: source.runId,
              memberId: source.memberId,
              sourceInteractionId: source.sourceInteractionId,
              ownerUserId: owner,
              claimDueAt: new Date(claim).toISOString(),
              feedbackDueAt: new Date(feedbackDue).toISOString(),
            });
          })}
        >创建待领取交接</button>
      </div>
    </details>
    {visible?.items.map(item => <SalesItem key={item.id} item={item} userId={userId} busy={busy} action={action} />)}
    {visible && !visible.items.length && <p className="text-xs text-slate-500">尚无已创建的真实销售交接。</p>}
    <button type="button" onClick={() => void action(load)} disabled={busy} className="text-xs text-accent underline">刷新真实交接</button>
  </section>;
}

function SalesItem({
  item,
  userId,
  busy,
  action,
}: {
  item: WeeklySalesHandoff;
  userId?: string;
  busy: boolean;
  action: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [result, setResult] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [next, setNext] = useState('');
  const [due, setDue] = useState('');
  const [needs, setNeeds] = useState(false);
  const owner = item.ownerUserId === userId;
  const overdue = weeklySalesOverdue(item, Date.now());
  const submit = (kind: 'claim' | 'request_feedback' | 'feedback') => action(() => weeklySalesHandoffApi.transition(item, {
    expectedVersion: item.version,
    operationId: crypto.randomUUID(),
    action: kind,
    ...(kind === 'feedback' ? { feedback: { result, evidenceInteractionIds: evidence, nextStep: next, nextDueAt: new Date(due).toISOString(), needsInformation: needs } } : {}),
  }));

  return <article id={salesPanelId(item.programId, item.packageId, item.packageVersion, item.id)} className={`scroll-mt-6 rounded-lg border p-3 ${overdue ? 'border-red-300 bg-red-50' : 'border-border bg-white'}`}>
    <p className="text-sm font-bold">{item.customerId} · {{ awaiting_claim: '待领取', in_progress: '处理中', awaiting_feedback: '待反馈', handled: '已处理', needs_information: '需补资料' }[item.status]} · 原周包 v{item.packageVersion}</p>
    <p className="text-xs">指定销售：{item.ownerUserId} · 领取截止 {new Date(item.claimDueAt).toLocaleString()} · 反馈截止 {new Date(item.feedbackDueAt).toLocaleString()}{overdue ? ` · ${overdue === 'claim' ? '未领取' : overdue === 'feedback' ? '未反馈' : '补资料'}逾期` : ''}</p>
    <p className="mt-1 text-xs">真实问题：{String(item.sourceEvidence.body)} · 客服批准资料 v{item.approvedBatchVersion}</p>
    {item.feedback && <p className="mt-1 text-xs">处理结果：{item.feedback.result} · 下一步：{item.feedback.nextStep} · {item.feedback.nextDueAt}</p>}
    {owner && item.status === 'awaiting_claim' && <button type="button" disabled={busy} onClick={() => void submit('claim')} className="mt-2 text-xs text-accent underline">由我领取</button>}
    {owner && item.status === 'in_progress' && <button type="button" disabled={busy} onClick={() => void submit('request_feedback')} className="ml-3 text-xs text-accent underline">进入待反馈</button>}
    {owner && ['in_progress', 'awaiting_feedback', 'needs_information'].includes(item.status) && <details className="mt-2">
      <summary className="cursor-pointer text-xs">记录真实反馈</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input aria-label="真实处理结果" placeholder="人工实际处理结果" value={result} onChange={event => setResult(event.target.value)} className={inputClass} />
        <SalesConversationEvidenceSelector handoff={item} selectedIds={evidence} onSelection={setEvidence} disabled={busy} />
        <input aria-label="下一步" placeholder="下一步" value={next} onChange={event => setNext(event.target.value)} className={inputClass} />
        <input aria-label="下一步截止" type="datetime-local" value={due} onChange={event => setDue(event.target.value)} className={inputClass} />
        <label className="text-xs"><input type="checkbox" checked={needs} onChange={event => setNeeds(event.target.checked)} /> 需补资料</label>
        <button type="button" disabled={busy || !result || !evidence.length || !next || !due} onClick={() => void submit('feedback')} className="text-left text-xs text-accent underline disabled:opacity-40">保存人工反馈证据</button>
      </div>
    </details>}
  </article>;
}
