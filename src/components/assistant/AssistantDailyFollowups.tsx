import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Table } from 'antd';
import { dailyFollowupsSchema, type DailyFollowups } from '../../../shared/contracts/assistantWork';
import { authHeader } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

export default function AssistantDailyFollowups() {
  const [data, setData] = useState<DailyFollowups>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const identity = useRef(productionNavigationIdentity());
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError('');
    fetch('/api/overseas/strategy/daily-followups', { headers: authHeader(), signal: abort.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok) throw Error(body.message || '待跟进客户暂不可读取'); return dailyFollowupsSchema.parse(body); })
      .then(value => { if (!abort.signal.aborted && identity.current === productionNavigationIdentity()) setData(value); })
      .catch(reason => { if (!abort.signal.aborted) setError(reason.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [revision]);
  return <section className="mt-3 space-y-3 min-w-0" aria-label="今日优先跟进客户">
    {error && <Alert type="error" title={error}/>}
    <Table loading={busy} rowKey="id" size="small" pagination={false} scroll={{ x: 850 }} dataSource={data?.customers || []}
      locale={{ emptyText: data ? '今日待跟进客户已处理完，或暂无可跟进客户。' : '客户尚未读取' }}
      columns={[
        { title: '客户', dataIndex: 'name', width: 120 },
        { title: '渠道／阶段', render: (_, c) => `${c.channel}／${({ lead: '新线索', inquiry: '询价中', quoted: '已报价', won: '已成交', silent30: '沉默30天', silent60: '沉默60天' } as Record<string, string>)[c.stage] || c.stage}`, width: 140 },
        { title: '最近互动', render: (_, c) => c.lastInteraction ? new Date(c.lastInteraction).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '时间待确认', width: 150 },
        { title: '待解决问题', dataIndex: 'issue' }, { title: '推荐原因', dataIndex: 'reason' },
        { title: '操作', fixed: 'right', width: 115, render: (_, c) => <Button type="link" disabled={!c.canFollow} title={c.canFollow ? undefined : '该渠道暂不支持当前会话人工发送入口'} onClick={() => {
          if (identity.current !== productionNavigationIdentity()) return;
          const url = new URL(window.location.href); url.searchParams.set('page', 'conversion'); url.searchParams.set('customer', c.id); url.searchParams.set('followupDraft', '1'); window.location.assign(url);
        }}>{c.canFollow ? '去跟进' : '渠道暂不支持'}</Button> },
      ]}/>
    <Button loading={busy} onClick={() => setRevision(value => value + 1)}>{error ? '重试读取' : '刷新／查看下一批'}</Button>
    {data && <span className="ml-3 text-xs text-text-secondary">今日已跟进 {data.completed} 位，剩余 {data.remaining} 位；未发送的客户会继续保留。</span>}
  </section>;
}
