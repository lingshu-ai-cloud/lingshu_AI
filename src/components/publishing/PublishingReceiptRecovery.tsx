import { useEffect, useState } from 'react';
import { Alert, Button, Input, Spin } from 'antd';
import { authHeader } from '../../lib/auth';
export type ReceiptAttempt = { status: string; attemptId?: string; startedAt?: string; platformPostId?: string; error?: string };
export type ReceiptAttempts = { platform: string; querySupported: boolean; attempts: Record<string, ReceiptAttempt> };
export function unknownReceiptAttempts(data: ReceiptAttempts) { return Object.entries(data.attempts).filter(([, attempt]) => ['unknown', 'in_flight'].includes(attempt.status)); }
export async function verifyPublishingReceipt(postId: string, accountId: string, attemptId: string, platformPostId: string, request: typeof fetch = fetch) {
  if (!attemptId || !platformPostId.trim()) throw Error('请填写平台视频 ID');
  const response = await request(`/api/overseas/publishing/posts/${encodeURIComponent(postId)}/reconcile`, {
    method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, attemptId, platformPostId: platformPostId.trim() }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || '回执核对失败，请稍后重试');
  return data;
}
export function ReceiptRecoveryForm({ data, busy, error, values, onChange, onVerify }: {
  data: ReceiptAttempts; busy: boolean; error: string; values: Record<string, string>;
  onChange: (id: string, value: string) => void; onVerify: (id: string, attempt: ReceiptAttempt) => void;
}) {
  const unknown = unknownReceiptAttempts(data);
  return <div className="space-y-3 text-sm">
    <Alert type="warning" showIcon title="平台发布结果待核对" description="已停止自动重发。请核对平台记录，避免重复发布。"/>
    {error && <Alert type="error" showIcon title={error}/>}
    {!unknown.length && <p role="status">回执已核对；系统将继续完成本地回写。</p>}
    {!!unknown.length && !data.querySupported && <p>当前平台暂不支持可信回执查询。请保留平台记录并联系管理员核对，此处不会将未知结果标记成功。</p>}
    {unknown.map(([accountId, attempt]) => <div key={accountId} className="space-y-2 rounded-lg border border-border p-3">
      <p className="font-semibold">发布账号：{accountId}</p>
      {attempt.startedAt && <p className="text-xs text-text-muted">发送时间：{new Date(attempt.startedAt).toLocaleString('zh-CN')}</p>}
      {data.querySupported && attempt.attemptId ? <>
        <label className="block">YouTube 平台视频 ID<Input aria-label={`平台视频 ID ${accountId}`} disabled={busy} value={values[accountId] || ''} onChange={event => onChange(accountId, event.target.value)} className="mt-1" /></label>
        <p className="text-xs text-text-muted">系统会向 YouTube 核对账号归属、专属跟踪链接、发布时间和公开状态；核对不会重新发布视频。</p>
        <Button type="primary" loading={busy} disabled={!values[accountId]?.trim()} onClick={() => onVerify(accountId, attempt)}>查询平台并恢复回执</Button>
      </> : data.querySupported ? <p>此历史记录缺少发送尝试编号，需要管理员核对。</p> : null}
    </div>)}
  </div>;
}
export default function PublishingReceiptRecovery({ postId, onRecovered }: { postId: string; onRecovered?: () => void | Promise<void> }) {
  const [data, setData] = useState<ReceiptAttempts | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const load = async () => {
    const response = await fetch(`/api/overseas/publishing/posts/${encodeURIComponent(postId)}/attempts`, { headers: authHeader() });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '无法读取发布回执');
    setData(result);
  };
  useEffect(() => { setData(null); setError(''); setValues({}); void load().catch(error => setError(error.message || '无法连接服务')); }, [postId]);
  const verify = async (accountId: string, attempt: ReceiptAttempt) => {
    setBusy(true); setError('');
    try { await verifyPublishingReceipt(postId, accountId, attempt.attemptId || '', values[accountId] || ''); await load(); await onRecovered?.(); }
    catch (error) { setError(error instanceof Error ? error.message : '回执核对失败'); }
    finally { setBusy(false); }
  };
  return data ? <ReceiptRecoveryForm data={data} busy={busy} error={error} values={values} onChange={(id, value) => setValues(previous => ({ ...previous, [id]: value }))} onVerify={(id, attempt) => void verify(id, attempt)} /> : <div role="status">{error || <><Spin size="small"/> 正在读取发送记录…</>}{error && <Button className="ml-2" onClick={() => void load().catch(error => setError(error.message))}>重试</Button>}</div>;
}
