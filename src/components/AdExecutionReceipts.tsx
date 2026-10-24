import { useEffect, useRef, useState } from 'react';
import { platformAdsRequest } from '../lib/platformAds';

const pending = new Set(['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED']);
const labels: Record<string, string> = { VERIFIED: '平台操作已核验', FAILED: '操作失败', UNKNOWN: '结果待核验', EXECUTING: '执行中', PROVIDER_ACCEPTED: '平台已接收，待核验' };
type Receipt = Record<string, unknown>;
export default function AdExecutionReceipts({ taskId, records, onRefresh }: {
  taskId: string; records: Receipt[]; onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const inFlight = useRef(false), scope = useRef(taskId);
  scope.current = taskId;
  useEffect(() => { scope.current = taskId; setFeedback(''); return () => { scope.current = ''; }; }, [taskId]);
  const reconcile = async (record: Receipt) => {
    if (inFlight.current || !pending.has(String(record.status)) || typeof record.id !== 'string') return;
    const currentTask = taskId;
    inFlight.current = true; setBusy(true); setFeedback('');
    try {
      const result = await platformAdsRequest<{ execution: Receipt }>(`/tasks/${encodeURIComponent(taskId)}/executions/${encodeURIComponent(record.id)}/reconcile`, { method: 'POST' });
      if (scope.current !== currentTask) return;
      await onRefresh();
      if (scope.current === currentTask) setFeedback(result.execution.status === 'VERIFIED' ? '平台结果已核验，原回执已更新。' : '操作仍待核验，请保留原回执，不要重复创建。');
    } catch (error) {
      if (scope.current === currentTask) setFeedback(error instanceof Error ? error.message : '对账失败，请保留原回执后重试。');
    } finally {
      inFlight.current = false;
      if (scope.current === currentTask) setBusy(false);
    }
  };
  return <section aria-label="执行记录与平台回执">
    <div className="ads-section-title"><h3>执行记录与平台回执</h3><button className="ads-button" disabled={busy} onClick={() => onRefresh().catch(error => setFeedback(error instanceof Error ? error.message : '回执读取失败'))}>刷新记录</button></div>
    {feedback && <p role="status" className="ads-operation-feedback">{feedback}</p>}
    {records.length ? records.map((record, index) => <div key={String(record.id || index)}>
      <details><summary>{String(record.action || '操作')} · {labels[String(record.status)] || String(record.status || '未知')} · {String(record.createdAt || '')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(record, null, 2)}</pre></details>
      {pending.has(String(record.status)) && typeof record.id === 'string' && <>
        <button type="button" className="ads-button" disabled={busy} onClick={() => void reconcile(record)}>{busy ? '正在核对…' : '核对这条回执'}</button>
        <p className="ads-muted">只核对已有平台资源并更新本地回执，不创建或启动广告。部分资源缺失时仍需平台人工核对。</p>
      </>}
    </div>) : <p className="ads-muted">尚无执行记录。平台请求失败或结果不确定时不会显示为投放成功。</p>}
  </section>;
}
