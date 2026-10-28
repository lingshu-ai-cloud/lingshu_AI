import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Spin } from 'antd';
import { AUTH_TOKEN_CHANGED_EVENT, getToken } from '../../lib/auth';
import { createSocialInsightReport, readSocialInsightReport } from '../../lib/socialInsightApi';
import type { SocialInsightJob, SocialInsightReport } from '../../../shared/socialInsightReport';
import { socialInsightStageLabel } from './socialInsightStageLabel';

type Pending = { requestId: string; keyword: string; jobId?: string };
const pendingKey = (scope: string) => `lingshu.social-insight.pending:${scope}`;
function restore(scope: string): Pending | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey(scope)) || 'null');
    return value && typeof value.requestId === 'string' && typeof value.keyword === 'string' ? value : null;
  } catch { return null; }
}
function savePending(scope: string, value: Pending | null) {
  try { if (value) localStorage.setItem(pendingKey(scope), JSON.stringify(value)); else localStorage.removeItem(pendingKey(scope)); } catch { /* Task identity remains in memory for this window. */ }
}
const running = (job: SocialInsightJob) => job.status === 'queued' || job.status === 'running';

/** Keyword confirmation starts one durable report; reopening only reconciles that task. */
export default function SocialInsightDialog({ scope, onClose, onReport }: {
  scope: string; onClose: () => void; onReport: (report: SocialInsightReport, partial: boolean, reportId: string) => void;
}) {
  const initial = useRef(restore(scope));
  const [keyword, setKeyword] = useState(initial.current?.keyword || '');
  const [pending, setPending] = useState<Pending | null>(initial.current);
  const [job, setJob] = useState<SocialInsightJob | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const currentToken = useRef(getToken()), delivered = useRef(false), active = useRef(true);
  const controller = useRef<AbortController | null>(null), submitting = useRef(false);
  const callbacks = useRef({ onClose, onReport }); callbacks.current = { onClose, onReport };
  useEffect(() => {
    active.current = true;
    const close = () => { active.current = false; controller.current?.abort(); callbacks.current.onClose(); };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === 'overseas_token') close(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, close); window.addEventListener('storage', storage);
    return () => { active.current = false; controller.current?.abort(); window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, close); window.removeEventListener('storage', storage); };
  }, []);
  useEffect(() => {
    if (!pending) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController(); controller.current = abort;
    const current = () => !disposed && active.current && getToken() === currentToken.current;
    const reconcile = async () => {
      setBusy(true); setError('');
      try {
        const result = pending.jobId ? await readSocialInsightReport(pending.jobId, abort.signal)
          : await createSocialInsightReport(pending.keyword, pending.requestId, abort.signal);
        if (!current()) return;
        setJob(result);
        const known = { ...pending, jobId: result.id };
        savePending(scope, known);
        if (!pending.jobId) { setPending(known); return; }
        if (running(result)) { timer = setTimeout(() => void reconcile(), 3000); return; }
        if ((result.status === 'succeeded' || result.status === 'partial') && result.report && !delivered.current) {
          delivered.current = true; savePending(scope, null); callbacks.current.onReport(result.report, result.status === 'partial', result.id); return;
        }
        setError(result.error?.message || (result.status === 'empty' ? '近7天未采集到符合关键词和日期要求的公开内容，暂不能生成有效报告。' : '本次未形成完整报告，请保留当前任务核对结果。'));
      } catch (reason) {
        if (current() && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : '任务状态读取失败，请核对现有任务，不要重复提交。');
      } finally { if (current()) setBusy(false); }
    };
    void reconcile();
    return () => { disposed = true; abort.abort(); if (timer) clearTimeout(timer); };
  }, [pending, revision, scope]);
  const start = () => {
    if (submitting.current || pending) return;
    const value = keyword.trim();
    if (!value || value.length > 80) { setError('请输入1至80字的查询关键词。'); return; }
    submitting.current = true;
    const next = { keyword: value, requestId: crypto.randomUUID() };
    savePending(scope, next); setPending(next);
  };
  return <Modal open title="社交媒体资讯" onCancel={onClose} width={520} footer={pending ? [
    <Button key="close" onClick={onClose}>{busy || job && running(job) ? '稍后查看' : '关闭'}</Button>,
    job && ['blocked', 'empty', 'failed'].includes(job.status) && <Button key="edit" onClick={() => {
      savePending(scope, null); submitting.current = false; setPending(null); setJob(null); setError('');
    }}>重新查询</Button>,
    error && <Button key="reconcile" type="primary" loading={busy} onClick={() => setRevision(value => value + 1)}>核对现有任务</Button>,
  ] : [<Button key="cancel" onClick={onClose}>取消</Button>, <Button key="generate" type="primary" onClick={start}>生成报告</Button>]}>
    <div className="space-y-4 py-2">
      {pending ? <div role="status" aria-live="polite" className="space-y-2 rounded-lg bg-surface-2 p-4">
        <p className="font-semibold text-text-primary">{pending.keyword}</p>
        <p className="flex items-center gap-2 text-sm text-text-secondary">{!error && <Spin size="small"/>}{job ? socialInsightStageLabel(job) : '正在确认报告任务'}</p>
        <p className="text-xs text-text-muted">{!job || running(job) ? '关闭窗口后任务继续；再次点击场景可查看结果。' : '任务记录已保留，不会自动重新采集。'}</p>
      </div> : <label className="block text-sm text-text-primary">想查询什么关键词？
        <Input autoFocus className="mt-2" aria-label="社媒查询关键词" value={keyword} maxLength={80} placeholder="例如：sunscreen、护肤原料、品牌名称" onChange={event => setKeyword(event.target.value)} onPressEnter={start}/>
      </label>}
      <p className="text-sm text-text-secondary">默认近7天 · TikTok公开内容 · 当前商户按B2B分析。报告分B2B、B2C两类，包含图表、素材封面、视频链接及询盘内容建议。</p>
      {error && <Alert type="warning" showIcon title={error}/>}
    </div>
  </Modal>;
}
