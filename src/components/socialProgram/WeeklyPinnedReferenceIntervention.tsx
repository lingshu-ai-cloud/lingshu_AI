import { Alert, Button, Form, Select, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { authHeader, getToken } from '../../lib/auth';

type Scope = { programId: string; packageId: string; packageVersion: number };
type Option = { candidateId: string; title: string; sourceUrl: string; accountUrl: string; discoveryAuthority: { rootJobId: string; currentJobId: string; runId: string } };
type Options = { status: 'awaiting_collection' | 'awaiting_admission' | 'already_pinned' | 'plan_locked' | 'ready'; packageVersion: number; planningVersion: number; options: Option[] };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string; error?: string };
  if (!response.ok) throw Error(body.message || body.error || '参考视频读取或保存失败');
  return body;
}

export default function WeeklyPinnedReferenceIntervention({ scope }: { scope: Scope }) {
  const identity = `${scope.programId}:${scope.packageId}:${scope.packageVersion}`;
  const current = useRef(identity); current.current = identity;
  const [item, setItem] = useState<Options | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}/agent-planning`;
  const load = async () => {
    const captured = identity, token = getToken(); setBusy(true); setError('');
    try {
      const result = await fetch(`${base}/pinned-reference-options`, { headers: authHeader() }).then(response => readJson<{ item: Options }>(response));
      if (current.current === captured && getToken() === token) { setItem(result.item); setCandidateId(null); }
    } catch (cause) {
      if (current.current === captured && getToken() === token) setError(cause instanceof Error ? cause.message : '候选读取失败');
    } finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };
  useEffect(() => { setItem(null); setCandidateId(null); void load(); }, [identity]);
  const selected = item?.options.find(option => option.candidateId === candidateId);
  const stale = Boolean(item && item.packageVersion !== scope.packageVersion);
  const submit = async () => {
    if (!item || !selected || stale || busy) return;
    const captured = identity, token = getToken(); setBusy(true); setError('');
    try {
      await fetch(`${base}/pinned-reference`, {
        method: 'POST', headers: { ...authHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({ expectedPackageVersion: item.packageVersion, expectedPlanningVersion: item.planningVersion, candidateId: selected.candidateId, expectedAccountUrl: selected.accountUrl, discoveryAuthority: selected.discoveryAuthority }),
      }).then(response => readJson(response));
      if (current.current === captured && getToken() === token) await load();
    } catch (cause) {
      if (current.current === captured && getToken() === token) setError(`${cause instanceof Error ? cause.message : '保存失败'}；请重新读取本轮候选，不要重复提交。`);
    } finally { if (current.current === captured && getToken() === token) setBusy(false); }
  };
  return <section aria-label="本轮复刻参考视频" className="space-y-3 rounded-lg border border-border bg-white p-4">
    <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold text-text-primary">本轮复刻参考视频</h5><Tag color={item?.status === 'already_pinned' ? 'success' : 'warning'}>{item?.status === 'already_pinned' ? '已指定' : '待准入'}</Tag></div>
    {stale ? <Alert type="warning" showIcon title="任务卡周包版本已变化" description="请重新打开当前周包的任务卡；旧版不能指定新参考。" /> : item?.status === 'already_pinned' ? <Alert type="info" showIcon title="参考视频已指定" description="编导将按冻结参考匹配分镜；指定不等于已完成生产或成片验收。" /> : item?.status === 'plan_locked' ? <Alert type="warning" showIcon title="计划已确认或派单" description="需新的不可变周包修订，不能覆盖原参考。" /> : item?.status === 'awaiting_collection' ? <Alert type="info" showIcon title="等待本轮同账号采集" description="旧灵感库视频不会自动成为本轮参考；采集完成后在此重新读取。" /> : item?.status === 'awaiting_admission' ? <Alert type="warning" showIcon title="本轮视频尚未通过分析交接" description="只有完成原片、账号、产品与可改编分析准入的视频才可指定。" /> : null}
    {item?.status === 'ready' && !stale && <Form layout="vertical" onFinish={() => void submit()}><Form.Item label="指定复刻的原视频" required><Select aria-label="指定复刻的原视频" value={candidateId} onChange={setCandidateId} placeholder="选择本轮合格视频" showSearch optionFilterProp="label" options={item.options.map(option => ({ value: option.candidateId, label: `${option.title} · ${option.accountUrl}` }))} /></Form.Item>
      {selected && <p className="break-all text-xs leading-5 text-text-secondary">原视频：<a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源</a>。指定一条占用一个母版位，其余母版仍须使用不同合格视频。</p>}
      <Button className="min-h-11" type="primary" htmlType="submit" disabled={!selected || busy} loading={busy}>确认指定参考视频</Button>
    </Form>}
    {error && <Alert type="error" showIcon title={error} action={<Button className="min-h-11" loading={busy} onClick={() => void load()}>重新读取</Button>} />}
    <Button className="min-h-11" loading={busy} onClick={() => void load()}>刷新本轮候选</Button>
  </section>;
}
