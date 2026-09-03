import { AlertTriangle, Check, Hand, Loader2, RefreshCcw, RotateCcw, Send, ShieldCheck, Shuffle, SkipForward, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildPublishingReconciliationPayload,
  type ApprovalDecision,
  type ApprovalRequest,
  type ManualHandoffResult,
  type PublishingReconciliationAction,
  type PublishingReconciliationDecision,
  type PublishingReconciliationReceiptDraft,
  type WeeklyGoal,
  type WorkItem,
  type WorkflowTask,
} from '../../lib/digitalEmployees';
import { agentLabel, formatDateTime, riskLabel, statusLabel, workItemTypeLabel } from './presentation';
import {
  buildObjectDiff,
  filterWorkItems,
  parseApprovalChanges,
  selectApprovalSnapshot,
  selectManualHandoffSubmission,
  selectPublishingReconciliation,
  type WorkItemFilterState,
} from './selectors';
import { StatusBadge } from './StatusBadge';

const EMPTY_FILTERS: WorkItemFilterState = { status: 'pending', type: '', risk: '', agent: '', owner: '', goalId: '' };

function Select({ label, value, values, onChange }: { label: string; value: string; values: Array<[string, string]>; onChange: (value: string) => void }) {
  return <label><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600 outline-none focus:border-emerald-400">{values.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
}

function valueText(value: unknown): string {
  if (value === undefined) return '未设置';
  if (value === null) return '空';
  if (typeof value === 'string') return value || '空字符串';
  return JSON.stringify(value);
}

function snapshotText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function snapshotStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function ApprovalDetail({
  approval,
  task,
  busy,
  onDecide,
  onHandoff,
}: {
  approval: ApprovalRequest;
  task: WorkflowTask | null;
  busy: boolean;
  onDecide: (approval: ApprovalRequest, decision: ApprovalDecision, note: string, changes?: Record<string, unknown>) => void;
  onHandoff: (task: WorkflowTask) => void;
}) {
  const [note, setNote] = useState('');
  const [changeMode, setChangeMode] = useState(false);
  const [changesText, setChangesText] = useState('{}');
  useEffect(() => { setNote(''); setChangeMode(false); setChangesText('{}'); }, [approval.id]);
  const snapshot = selectApprovalSnapshot(approval);
  const parsedChanges = useMemo(() => parseApprovalChanges(changesText), [changesText]);
  const unsupportedChangeKeys = parsedChanges.changes ? Object.keys(parsedChanges.changes).filter(key => !['scheduledAt', 'targetAccount', 'estimatedCost'].includes(key)) : [];
  const diff = useMemo(() => parsedChanges.changes ? buildObjectDiff(snapshot.parameters || {}, parsedChanges.changes) : [], [parsedChanges.changes, snapshot.parameters]);
  const decided = approval.status !== 'pending';
  const hasRecordedDiff = Array.isArray(approval.diff) ? approval.diff.length > 0 : Boolean(approval.diff && Object.keys(approval.diff).length);
  const canApproveWithChanges = snapshot.canDecide && Boolean(parsedChanges.changes) && unsupportedChangeKeys.length === 0 && diff.length > 0 && Boolean(note.trim());
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-amber-800"><ShieldCheck size={19} /><h3 className="font-black">精确动作审批</h3></div><p className="mt-2 text-sm font-bold text-slate-900">{task?.title || approval.action_summary}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{approval.action_summary}</p></div><div className="flex items-center gap-2"><StatusBadge status={approval.status} /><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">{riskLabel[snapshot.riskLevel] || snapshot.riskLevel}</span></div></div>

    {(snapshot.expired || snapshot.missingFields.length > 0) && !decided && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><p className="flex items-center gap-2 font-bold"><AlertTriangle size={15} />当前审批不可执行</p><p className="mt-1 leading-relaxed">{snapshot.expired ? '审批已超过失效时间，必须重新生成动作版本。' : `审批快照缺少：${snapshot.missingFields.join('、')}。为避免批准不完整动作，前端已锁定批准按钮。`}</p></div>}

    <dl className="mt-4 grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] text-slate-400">动作类型 / 版本</dt><dd className="mt-1 text-xs font-bold text-slate-800">{snapshot.actionType || '未绑定'} · v{snapshot.actionVersion || '—'}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] text-slate-400">目标账号</dt><dd className="mt-1 text-xs font-bold text-slate-800">{snapshot.targetAccounts?.map(account => account.name || `${account.platform ? `${account.platform} · ` : ''}${account.id}`).join('、') || (snapshot.mode === 'dry_run' ? '无目标账号（安全 dry-run）' : '未指定')}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] text-slate-400">排期 / 失效时间</dt><dd className="mt-1 text-xs font-bold text-slate-800">{formatDateTime(snapshot.scheduledAt)} / {formatDateTime(snapshot.expiresAt)}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] text-slate-400">预计费用 / 可逆性</dt><dd className="mt-1 text-xs font-bold text-slate-800">{snapshot.estimatedCost === undefined ? '未回写' : `¥${snapshot.estimatedCost.toFixed(2)}`} · {snapshot.reversibility || (snapshot.reversible === true ? '可逆' : snapshot.reversible === false ? '不可逆' : '未说明')}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2"><dt className="text-[10px] text-slate-400">内容 / 素材版本</dt><dd className="mt-1 break-words text-xs font-bold text-slate-800">内容 {snapshot.contentVersion || '未指定'} · 素材 {snapshot.materialVersions?.map(item => typeof item === 'string' ? item : `${item.id || ''}${item.version ? `@${item.version}` : ''}`).join('、') || '未指定'}</dd></div>
      <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2"><dt className="text-[10px] text-slate-400">Payload Hash</dt><dd className="mt-1 break-all font-mono text-[11px] font-semibold text-slate-700">{snapshot.payloadHash || '未绑定'}</dd></div>
      <div className="rounded-xl bg-blue-50 p-3 sm:col-span-2"><dt className="text-[10px] text-blue-500">批准后下一步</dt><dd className="mt-1 text-xs font-bold text-blue-800">{snapshot.nextStep || '未说明'}</dd></div>
    </dl>

    <details className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-700">完整动作参数</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-200">{JSON.stringify(snapshot.parameters || {}, null, 2)}</pre></details>
    {snapshot.contentSnapshot && <section className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3" aria-label="待发布完整内容快照">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-black text-emerald-950">待发布完整内容（已绑定 Hash）</h4><span className="break-all font-mono text-[9px] text-emerald-700">{snapshot.contentPayloadHash}</span></div>
      <p className="mt-3 text-sm font-black text-slate-900">{snapshotText(snapshot.contentSnapshot.title) || '未填写标题'}</p>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{snapshotText(snapshot.contentSnapshot.caption) || '未填写 caption'}</p>
      {snapshotStrings(snapshot.contentSnapshot.hashtags).length > 0 && <p className="mt-2 text-xs font-semibold text-blue-700">{snapshotStrings(snapshot.contentSnapshot.hashtags).join(' ')}</p>}
      {snapshotText(snapshot.contentSnapshot.cta) && <p className="mt-2 rounded-lg bg-white p-2 text-xs font-bold text-emerald-800">CTA：{snapshotText(snapshot.contentSnapshot.cta)}</p>}
      {snapshotStrings(snapshot.contentSnapshot.voiceover).length > 0 && <details className="mt-2 rounded-lg bg-white p-2"><summary className="cursor-pointer text-[11px] font-bold text-slate-700">完整口播（{snapshotStrings(snapshot.contentSnapshot.voiceover).length} 段）</summary><ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-600">{snapshotStrings(snapshot.contentSnapshot.voiceover).map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}</ol></details>}
      {Array.isArray(snapshot.contentSnapshot.storyboard) && <details className="mt-2 rounded-lg bg-white p-2"><summary className="cursor-pointer text-[11px] font-bold text-slate-700">完整分镜（{snapshot.contentSnapshot.storyboard.length} 镜）</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[10px] text-slate-600">{JSON.stringify(snapshot.contentSnapshot.storyboard, null, 2)}</pre></details>}
      {snapshot.artifact && snapshotText(snapshot.artifact.previewUrl) && snapshotText(snapshot.artifact.videoSha256) && <div className="mt-3"><video controls preload="metadata" src={snapshotText(snapshot.artifact.previewUrl)} className="max-h-96 w-full rounded-lg bg-black" /><p className="mt-1 break-all font-mono text-[9px] text-slate-500">成片 SHA-256：{snapshotText(snapshot.artifact.videoSha256)}</p></div>}
      {snapshot.artifact && snapshotText(snapshot.artifact.deepLink) && <a href={snapshotText(snapshot.artifact.deepLink)} className="mt-3 inline-block text-xs font-bold text-blue-700">在 Studio 打开可编辑项目 →</a>}
    </section>}
    {approval.evidence?.length > 0 && <details className="mt-2 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-700">证据与引用（{approval.evidence.length}）</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">{JSON.stringify(approval.evidence, null, 2)}</pre></details>}

    {decided ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><p className="font-bold text-slate-800">处理结果：{statusLabel[approval.status] || approval.status}</p><p className="mt-1">处理人：{approval.decided_by || '未回写'} · {formatDateTime(approval.decided_at)}</p>{approval.decision_note && <p className="mt-1">意见：{approval.decision_note}</p>}{(hasRecordedDiff || approval.changes || approval.proposed_changes) && <pre className="mt-2 overflow-auto rounded-lg bg-white p-2 text-[11px]">{JSON.stringify(approval.diff || approval.changes || approval.proposed_changes, null, 2)}</pre>}</div> : <>
      <textarea aria-label="审批意见" value={note} onChange={event => setNote(event.target.value)} className="mt-4 min-h-20 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" placeholder="审批意见；驳回或修改时必填" />
      {changeMode && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3"><label className="text-xs font-bold text-blue-900">修改参数（仅支持 scheduledAt、targetAccount、estimatedCost）<textarea value={changesText} onChange={event => setChangesText(event.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-blue-200 bg-white p-2 font-mono text-[11px] text-slate-700 outline-none focus:border-blue-400" /></label><p className="mt-1 text-[10px] text-blue-700">内容或素材本身变化时原审批失效，必须回到原业务模块修改并重新生成审批。</p>{parsedChanges.error ? <p className="mt-2 text-[11px] text-red-600">{parsedChanges.error}</p> : unsupportedChangeKeys.length ? <p className="mt-2 text-[11px] text-red-600">不支持修改：{unsupportedChangeKeys.join('、')}</p> : diff.length === 0 ? <p className="mt-2 text-[11px] text-amber-700">修改后内容与原参数一致。</p> : <div className="mt-3"><p className="text-[11px] font-bold text-blue-900">提交前 Diff</p><div className="mt-1 space-y-1">{diff.map(entry => <div key={entry.path} className="grid gap-1 rounded-lg bg-white p-2 text-[10px] sm:grid-cols-[120px_1fr_1fr]"><span className="font-mono font-bold text-slate-700">{entry.path}</span><span className="break-all text-red-600">− {valueText(entry.before)}</span><span className="break-all text-emerald-700">+ {valueText(entry.after)}</span></div>)}</div></div>}</div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {!changeMode ? <button type="button" disabled={busy || !snapshot.canDecide} onClick={() => onDecide(approval, 'approved', note)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"><Check size={14} />批准并继续</button> : <button type="button" disabled={busy || !canApproveWithChanges} onClick={() => parsedChanges.changes && onDecide(approval, 'approved_with_changes', note, parsedChanges.changes)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Check size={14} />确认 Diff 并批准</button>}
        <button type="button" disabled={busy || !snapshot.canDecide || !note.trim()} onClick={() => onDecide(approval, 'rejected', note)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><XCircle size={14} />驳回并重做</button>
        <button type="button" disabled={busy || !snapshot.canDecide} onClick={() => setChangeMode(value => !value)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"><Shuffle size={14} />{changeMode ? '取消修改' : '修改后批准'}</button>
        <button type="button" disabled={busy || !task || approval.status !== 'pending'} onClick={() => task && onHandoff(task)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-40"><Hand size={14} />人工完整接管</button>
      </div>
    </>}
  </div>;
}

const reconciliationActionLabel: Record<PublishingReconciliationAction, string> = {
  confirm_published: '确认所有账号已发布',
  confirm_not_published_retry: '确认均未发布并恢复重试',
  void: '作废本次发布任务',
};

function localDateTimeValue(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function PublishingReconciliationDetail({
  item,
  busy,
  onDecide,
}: {
  item: WorkItem;
  busy: boolean;
  onDecide: (item: WorkItem, decision: PublishingReconciliationDecision) => void;
}) {
  const view = selectPublishingReconciliation(item);
  const [action, setAction] = useState<PublishingReconciliationAction | ''>('');
  const [note, setNote] = useState('');
  const [receipts, setReceipts] = useState<PublishingReconciliationReceiptDraft[]>(() => (view?.targetAccountIds || []).map(accountId => ({
    accountId,
    outcome: '',
    platformPostId: '',
    verifiedAt: localDateTimeValue(),
    evidence: '',
  })));
  const [confirmed, setConfirmed] = useState(false);
  const reconciliationResetKey = view
    ? `${item.id}:${view.expectedRevision}:${view.targetAccountIds.join('\u0000')}`
    : item.id;
  useEffect(() => {
    setAction('');
    setNote('');
    setReceipts((view?.targetAccountIds || []).map(accountId => ({ accountId, outcome: '', platformPostId: '', verifiedAt: localDateTimeValue(), evidence: '' })));
    setConfirmed(false);
  }, [reconciliationResetKey]);
  const built = useMemo(() => view ? buildPublishingReconciliationPayload({
    action,
    expectedRevision: view.expectedRevision,
    note,
    targetAccountIds: view.targetAccountIds,
    allowedDecisions: view.allowedDecisions,
    receipts,
  }) : { ok: false as const, error: '对账待办结构无效。' }, [action, note, receipts, view]);
  const updateReceipt = (accountId: string, patch: Partial<PublishingReconciliationReceiptDraft>) => {
    setReceipts(current => current.map(receipt => receipt.accountId === accountId ? { ...receipt, ...patch } : receipt));
    setConfirmed(false);
  };
  if (!view) return null;
  if (!view.canDecide) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"><p className="flex items-center gap-2 font-bold"><AlertTriangle size={15} />当前对账待办不可处理</p><p className="mt-2">缺少：{view.missingFields.join('、') || '待办状态已变化'}。为避免不完整回执触发误发或重发，前端已锁定提交。</p></div>;

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-red-800"><AlertTriangle size={19} /><h3 className="font-black">发布结果人工对账</h3></div><p className="mt-2 text-sm font-bold text-slate-900">{item.title || '发布结果待核对'}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{item.summary || '平台调用结果不确定，必须按账号核验。'}</p></div><span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-800">高风险 · revision {view.expectedRevision}</span></div>

    <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800"><p className="font-black">禁止 blind retry：不会直接重发</p><p className="mt-1">你必须在每个目标账号后台或平台支持记录中完成核验。提交会写入不可篡改的审计轨迹；“恢复重试”可能继续触发真实对外发布。</p></div>

    <label className="mt-4 block text-xs font-bold text-slate-700">对账结论
      <select aria-label="对账结论" value={action} onChange={event => { setAction(event.target.value as PublishingReconciliationAction | ''); setConfirmed(false); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-red-400">
        <option value="">请明确选择，不预设结论</option>
        {view.allowedDecisions.map(value => <option key={value} value={value}>{reconciliationActionLabel[value]}</option>)}
      </select>
    </label>

    <div className="mt-4 space-y-3">{receipts.map(receipt => <fieldset key={receipt.accountId} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><legend className="px-1 text-xs font-black text-slate-900">账号：{receipt.accountId}</legend><div className="mt-1 grid gap-3 sm:grid-cols-2">
      <label className="text-[11px] font-bold text-slate-600">平台核验结果<select aria-label={`${receipt.accountId} 平台核验结果`} value={receipt.outcome} onChange={event => updateReceipt(receipt.accountId, { outcome: event.target.value as PublishingReconciliationReceiptDraft['outcome'], platformPostId: event.target.value === 'not_published' ? '' : receipt.platformPostId })} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"><option value="">必须选择</option><option value="published">已发布</option><option value="not_published">未发布</option></select></label>
      <label className="text-[11px] font-bold text-slate-600">核验时间<input aria-label={`${receipt.accountId} 核验时间`} type="datetime-local" value={receipt.verifiedAt} onChange={event => updateReceipt(receipt.accountId, { verifiedAt: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs" /></label>
      <label className="text-[11px] font-bold text-slate-600 sm:col-span-2">平台帖子 ID（“已发布”必填）<input aria-label={`${receipt.accountId} 平台帖子 ID`} value={receipt.platformPostId} disabled={receipt.outcome === 'not_published'} onChange={event => updateReceipt(receipt.accountId, { platformPostId: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs disabled:bg-slate-100" placeholder="平台返回的真实 post/video ID" /></label>
      <label className="text-[11px] font-bold text-slate-600 sm:col-span-2">可追溯证据 / 错误说明<textarea aria-label={`${receipt.accountId} 对账证据`} value={receipt.evidence} onChange={event => updateReceipt(receipt.accountId, { evidence: event.target.value })} className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs" placeholder="平台后台查询结果、工单 ID、截图/记录引用或明确错误说明" /></label>
    </div></fieldset>)}</div>

    <label className="mt-4 block text-xs font-bold text-slate-700">对账说明（必填）<textarea aria-label="对账说明" value={note} onChange={event => { setNote(event.target.value); setConfirmed(false); }} className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs outline-none focus:border-red-400" placeholder="记录核验人、核验渠道和做出该结论的依据" /></label>
    {!built.ok && <p role="alert" className="mt-2 text-[11px] font-semibold text-red-700">{built.error}</p>}
    <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" /><span>我已逐账号在真实平台完成核验，理解该决定会改变发布状态并留下审计记录。</span></label>
    <button type="button" disabled={busy || !confirmed || !built.ok} onClick={() => { if (built.ok) onDecide(item, built.value); }} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-xs font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><Loader2 size={14} className="animate-spin" />提交中，请勿重复操作</> : <><ShieldCheck size={14} />提交对账决定</>}</button>
  </div>;
}

export function WorkInbox({
  items,
  approvals,
  tasks,
  goals,
  busy,
  onDecide,
  onHandoff,
  onSelectTask,
  onTransfer,
  onTaskAction,
  onReturnHandoff,
  onPublishingReconciliation,
}: {
  items: WorkItem[];
  approvals: ApprovalRequest[];
  tasks: WorkflowTask[];
  goals: WeeklyGoal[];
  busy: boolean;
  onDecide: (approval: ApprovalRequest, decision: ApprovalDecision, note: string, changes?: Record<string, unknown>) => void;
  onHandoff: (task: WorkflowTask) => void;
  onSelectTask: (task: WorkflowTask) => void;
  onTransfer: (item: WorkItem, ownerId: string, note: string) => void;
  onTaskAction: (task: WorkflowTask, action: 'retry' | 'skip' | 'replan', note: string) => void;
  onReturnHandoff: (task: WorkflowTask, result: ManualHandoffResult) => void;
  onPublishingReconciliation: (item: WorkItem, decision: PublishingReconciliationDecision) => void;
}) {
  const [filters, setFilters] = useState<WorkItemFilterState>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState('');
  const [transferMode, setTransferMode] = useState(false);
  const [transferOwner, setTransferOwner] = useState('');
  const [operationNote, setOperationNote] = useState('');
  const [manualResult, setManualResult] = useState('');
  const [referenceText, setReferenceText] = useState('');
  const [externalActionsPerformed, setExternalActionsPerformed] = useState(false);
  const handoffReferences = useMemo(() => referenceText.split('\n').map(item => item.trim()).filter(Boolean), [referenceText]);
  const handoffContinueState = useMemo(() => selectManualHandoffSubmission({ note: operationNote, resultSummary: manualResult, references: handoffReferences, externalActionsPerformed, outcome: 'continue' }), [operationNote, manualResult, handoffReferences, externalActionsPerformed]);
  const handoffCompletedState = useMemo(() => selectManualHandoffSubmission({ note: operationNote, resultSummary: manualResult, references: handoffReferences, externalActionsPerformed, outcome: 'completed' }), [operationNote, manualResult, handoffReferences, externalActionsPerformed]);
  const filtered = useMemo(() => filterWorkItems(items, filters), [items, filters]);
  const selected = filtered.find(item => `${item.type}:${item.id}` === selectedId) || filtered[0] || null;
  useEffect(() => {
    if (selected && selectedId !== `${selected.type}:${selected.id}`) setSelectedId(`${selected.type}:${selected.id}`);
  }, [selected, selectedId]);
  useEffect(() => { setTransferMode(false); setTransferOwner(''); setOperationNote(''); setManualResult(''); setReferenceText(''); setExternalActionsPerformed(false); }, [selected?.id]);
  const embeddedTask = selected?.sourceTask
    || (selected?.source === 'workflow_task' && selected.sourceRecord ? selected.sourceRecord as unknown as WorkflowTask : null);
  const task = tasks.find(item => item.id === selected?.taskId) || embeddedTask || null;
  const approval = selected?.type === 'approval'
    ? approvals.find(item => item.id === selected.id) || selected.approval || null
    : null;
  const publishingReconciliation = selected ? selectPublishingReconciliation(selected) : null;
  const counts = { pending: items.filter(item => item.status === 'pending').length, processed: items.filter(item => item.status === 'processed').length, taken_over: items.filter(item => item.status === 'taken_over').length, expired: items.filter(item => item.status === 'expired').length };
  useEffect(() => {
    if (filters.status === 'pending' && counts.pending === 0 && counts.taken_over > 0) {
      setFilters(current => ({ ...current, status: 'taken_over' }));
    }
  }, [counts.pending, counts.taken_over, filters.status]);
  const types = [...new Set(items.map(item => item.type))];
  const risks = [...new Set(items.map(item => item.risk).filter(Boolean))];
  const agents = [...new Set(items.map(item => item.agent).filter(Boolean))];
  const owners = [...new Set(items.map(item => item.ownerId).filter(Boolean))];
  const setFilter = <K extends keyof WorkItemFilterState>(key: K, value: WorkItemFilterState[K]) => setFilters(current => ({ ...current, [key]: value }));

  return <section id="digital-stage-5" className="scroll-mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck size={19} className="text-amber-600" /><div><h2 className="font-bold text-slate-950">统一工作待办</h2><p className="text-[11px] text-slate-400">审批、失败、补充信息、接管和超时使用同一处理视图</p></div></div><button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600"><RefreshCcw size={13} />重置筛选</button></div>
    <div className="mt-4 flex flex-wrap gap-2">{([['pending', '待处理'], ['processed', '已处理'], ['taken_over', '已接管'], ['expired', '已过期']] as const).map(([status, label]) => <button type="button" key={status} aria-pressed={filters.status === status} onClick={() => setFilter('status', status)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filters.status === status ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>{label} {counts[status]}</button>)}<button type="button" aria-pressed={filters.status === 'all'} onClick={() => setFilter('status', 'all')} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filters.status === 'all' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>全部 {items.length}</button></div>
    <div className="mt-3 flex flex-wrap gap-2"><Select label="待办类型" value={filters.type} onChange={value => setFilter('type', value)} values={[['', '全部类型'], ...types.map(value => [value, workItemTypeLabel[value] || value] as [string, string])]} /><Select label="风险" value={filters.risk} onChange={value => setFilter('risk', value)} values={[['', '全部风险'], ...risks.map(value => [value, riskLabel[value] || value] as [string, string])]} /><Select label="Agent" value={filters.agent} onChange={value => setFilter('agent', value)} values={[['', '全部 Agent'], ...agents.map(value => [value, agentLabel[value] || value] as [string, string])]} /><Select label="负责人" value={filters.owner} onChange={value => setFilter('owner', value)} values={[['', '全部负责人'], ...owners.map(value => [value, value] as [string, string])]} /><Select label="周目标" value={filters.goalId} onChange={value => setFilter('goalId', value)} values={[['', '全部周目标'], ...goals.map(value => [value.id, value.title] as [string, string])]} /></div>

    <div className="mt-4 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">{filtered.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">当前筛选下没有待办</p>}{filtered.map(item => {
        const itemTask = tasks.find(candidate => candidate.id === item.taskId);
        const active = selected?.id === item.id && selected?.type === item.type;
        return <button type="button" key={`${item.type}:${item.id}`} onClick={() => setSelectedId(`${item.type}:${item.id}`)} className={`w-full rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-100 ${active ? 'border-amber-300 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-500">{workItemTypeLabel[item.type] || item.type} · {riskLabel[item.risk] || item.risk}</span><StatusBadge status={String(item.status)} /></div><p className="mt-2 line-clamp-2 text-xs font-bold text-slate-800">{item.title || itemTask?.title || item.summary || `任务 ${item.taskId}`}</p><p className="mt-1 truncate text-[10px] text-slate-400">{agentLabel[item.agent] || item.agent || '人工'} · {item.ownerId || '待分配'}{item.dueAt ? ` · ${formatDateTime(item.dueAt)} 到期` : ''}</p></button>;
      })}</div>
      <div className="min-w-0 rounded-2xl border border-slate-200 p-4">
        {!selected && <p className="py-20 text-center text-sm text-slate-400">选择一项待办查看详情</p>}
        {selected && approval && <ApprovalDetail approval={approval} task={task} busy={busy} onDecide={onDecide} onHandoff={onHandoff} />}
        {selected && publishingReconciliation && <PublishingReconciliationDetail item={selected} busy={busy} onDecide={onPublishingReconciliation} />}
        {selected && !approval && !publishingReconciliation && <div><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-slate-500">{workItemTypeLabel[selected.type] || selected.type}</p><h3 className="mt-1 text-base font-black text-slate-900">{task?.title || selected.title || selected.summary || '待办详情'}</h3></div><StatusBadge status={String(selected.status)} /></div><p className="mt-3 text-xs leading-relaxed text-slate-600">{selected.summary || task?.error_detail || task?.blocked_reason || '暂无补充说明'}</p>{task && <button type="button" onClick={() => onSelectTask(task)} className="mt-3 text-xs font-bold text-blue-700">查看任务详情 →</button>}{selected.type === 'failure' && task && selected.status === 'pending' && <div className="mt-4"><textarea value={operationNote} onChange={event => setOperationNote(event.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-xs outline-none focus:border-blue-400" placeholder="处理说明；跳过或重新规划时必填" /><div className="mt-2 grid gap-2 sm:grid-cols-3"><button type="button" disabled={busy} onClick={() => onTaskAction(task, 'retry', operationNote)} className="inline-flex items-center justify-center gap-1 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><RefreshCcw size={13} />有限重试</button><button type="button" disabled={busy || !operationNote.trim()} onClick={() => onTaskAction(task, 'skip', operationNote)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700 disabled:opacity-40"><SkipForward size={13} />显式跳过</button><button type="button" disabled={busy || !operationNote.trim()} onClick={() => onTaskAction(task, 'replan', operationNote)} className="inline-flex items-center justify-center gap-1 rounded-xl border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40"><Shuffle size={13} />重新规划</button></div></div>}{selected.type === 'handoff' && task && selected.status === 'taken_over' && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3"><p className="text-xs font-bold text-violet-900">提交人工处理结果</p><textarea value={manualResult} onChange={event => setManualResult(event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-violet-200 bg-white p-2 text-xs outline-none focus:border-violet-400" placeholder="人工完成了什么、结果如何" /><textarea value={referenceText} onChange={event => setReferenceText(event.target.value)} className="mt-2 min-h-16 w-full rounded-lg border border-violet-200 bg-white p-2 text-xs outline-none focus:border-violet-400" placeholder="每行一个原模块记录 ID、深链或附件引用" /><textarea value={operationNote} onChange={event => setOperationNote(event.target.value)} className="mt-2 min-h-16 w-full rounded-lg border border-violet-200 bg-white p-2 text-xs outline-none focus:border-violet-400" placeholder="交还说明" /><label className="mt-2 flex items-start gap-2 text-[11px] text-violet-900"><input type="checkbox" checked={externalActionsPerformed} onChange={event => setExternalActionsPerformed(event.target.checked)} className="mt-0.5" /><span>人工已执行外部动作；如已执行，正式记录引用必填，Agent 必须阻止重复发送、排期或费用动作。</span></label>{externalActionsPerformed && handoffReferences.length === 0 && <p role="alert" className="mt-2 text-[11px] font-bold text-red-700">已标记执行外部动作，必须填写可追溯的正式记录、回执或附件引用。</p>}<div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" disabled={busy || !handoffContinueState.canSubmit} onClick={() => onReturnHandoff(task, { note: operationNote, result: { summary: manualResult }, references: handoffReferences, externalActionsPerformed, outcome: 'continue' })} className="inline-flex items-center justify-center gap-1 rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><RotateCcw size={13} />记录结果并交还 Agent</button><button type="button" disabled={busy || !handoffCompletedState.canSubmit} onClick={() => onReturnHandoff(task, { note: operationNote, result: { summary: manualResult }, references: handoffReferences, externalActionsPerformed, outcome: 'completed' })} className="inline-flex items-center justify-center gap-1 rounded-xl border border-violet-300 bg-white px-3 py-2 text-xs font-bold text-violet-800 disabled:opacity-40"><Check size={13} />提交人工完成结果</button></div></div>}{(selected.status === 'pending' || selected.status === 'taken_over') && <div className="mt-4 border-t border-slate-100 pt-3">{!transferMode ? <button type="button" onClick={() => setTransferMode(true)} className="inline-flex items-center gap-1 text-xs font-bold text-slate-600"><Send size={13} />转交负责人</button> : <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input value={transferOwner} onChange={event => setTransferOwner(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="新负责人用户 ID" /><input value={operationNote} onChange={event => setOperationNote(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="转交说明" /><button type="button" disabled={busy || !transferOwner.trim()} onClick={() => onTransfer(selected, transferOwner.trim(), operationNote)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">确认转交</button></div>}</div>}</div>}
      </div>
    </div>
  </section>;
}
