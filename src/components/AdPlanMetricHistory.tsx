import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Space, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import type { PlatformAdMetricHistory, PlatformAdMetricSnapshot } from '../../shared/platformAdMetricHistory';
import { platformAdsRequest } from '../lib/platformAds';
const n = (v: number | null) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export default function AdPlanMetricHistory({ taskId }: { taskId: string }) {
  const [range, setRange] = useState<[string, string]>([dayjs().subtract(29, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')]);
  const [snapshot, setSnapshot] = useState<{ query: string; data: PlatformAdMetricHistory } | null>(null), [busy, setBusy] = useState(false), [syncing, setSyncing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0);
  const active = useRef(taskId), lock = useRef(false);
  useEffect(() => { active.current = taskId; return () => { active.current = ''; }; }, [taskId]);
  const query = `${taskId}?${new URLSearchParams({ since: range[0], until: range[1] })}`, data = snapshot?.query === query ? snapshot.data : null;
  useEffect(() => {
    const c = new AbortController(); setBusy(true); setError('');
    platformAdsRequest<PlatformAdMetricHistory>(`/tasks/${encodeURIComponent(taskId)}/metrics/history?${new URLSearchParams({ since: range[0], until: range[1] })}`, { signal: c.signal })
      .then(value => { if (!c.signal.aborted) setSnapshot({ query, data: value }); }).catch(e => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : '历史快照读取失败'); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [query, refresh]);
  const sync = async () => {
    if (lock.current) return; lock.current = true; setSyncing(true); setNotice('');
    try { const result = await platformAdsRequest<{ savedRows: number; dataNote: string }>(`/tasks/${encodeURIComponent(taskId)}/metrics/sync`, { method: 'POST', body: '{}' }); if (active.current === taskId) { setNotice(`已保存 ${result.savedRows} 条快照。${result.dataNote}`); setRefresh(v => v + 1); } }
    catch (e) { if (active.current === taskId) setNotice(`同步失败：${e instanceof Error ? e.message : '请重试'}`); }
    finally { lock.current = false; if (active.current === taskId) setSyncing(false); }
  };
  return <section aria-label="已保存指标历史"><Space wrap><DatePicker.RangePicker aria-label="快照日期范围" allowClear={false} value={[dayjs(range[0]), dayjs(range[1])]} onChange={dates => { if (dates?.[0] && dates[1]) setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]); }}/><Button loading={busy} onClick={() => setRefresh(v => v + 1)}>读取历史快照</Button><Button loading={syncing} onClick={() => void sync()}>保存最近7天快照</Button><Tag>本地已同步数据</Tag></Space>
    <p>日期按快照中记录的账户日期筛选，最多 366 天。读取历史不请求平台；保存只同步平台最近 7 天，不补采任意历史、不启用广告。</p>
    {error && <Alert type="error" showIcon title={error}/>}{notice && <Alert type={notice.startsWith('同步失败') ? 'error' : 'success'} showIcon title={notice}/>}
    <Table<PlatformAdMetricSnapshot> rowKey="id" loading={busy} dataSource={data?.items || []} scroll={{ x: 1050 }} pagination={{ pageSize: 10 }} columns={[
      { title: '日期／账户', render: (_, r) => <>{r.date}<p>{r.accountId}</p></> }, { title: '币种／时区', render: (_, r) => <>{r.currency}<p>{r.reportTimezone || '时区未知'}</p></> },
      { title: '消耗', render: (_, r) => n(r.values.spend) }, { title: '展示', render: (_, r) => n(r.values.impressions) }, { title: '点击', render: (_, r) => n(r.values.clicks) },
      { title: '目标结果', render: (_, r) => <>{r.metricLabel} {n(r.values.results)}</> }, { title: '采集时间', dataIndex: 'reportedAt' },
    ]}/>{data && <p>{data.dataNote}</p>}
  </section>;
}
