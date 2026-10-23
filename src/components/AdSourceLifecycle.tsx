import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Empty, Space, Table, Tag } from 'antd';
import type { AdSourceIdentity, AdSourceLifecycle as Lifecycle } from '../../shared/adSourceLifecycle';
import { preserveAdLifecycleReports } from '../../shared/adSourceLifecycle';
import { platformAdsRequest } from '../lib/platformAds';
const number = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
export default function AdSourceLifecycle(identity: AdSourceIdentity) {
  const query = new URLSearchParams(Object.entries(identity).filter(([, v]) => !!v)).toString();
  const [snapshot, setData] = useState<{ query: string; value: Lifecycle } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const data = snapshot?.query === query ? snapshot.value : null;
  useEffect(() => {
    const c = new AbortController(); setBusy(true); setError('');
    platformAdsRequest<Lifecycle>(`/creative-lifecycle?${query}`, { signal: c.signal }).then(value => { if (!c.signal.aborted) setData(old => ({ query, value: preserveAdLifecycleReports(old?.query === query ? old.value : null, value) })); }).catch(e => { if (!c.signal.aborted) setError(e.message || '生命周期读取失败'); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [query, refresh]);
  return <section aria-label="素材投放生命周期" style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    <Space wrap><h3>投放表现与关联</h3><Button loading={busy} onClick={() => setRefresh(n => n + 1)}>刷新表现</Button>{data && <Tag>更新：{new Date(data.checkedAt).toLocaleString('zh-CN')}</Tag>}</Space>
    {error && <Alert type="error" showIcon title={error} description={data ? '刷新失败，保留旧快照；以每条 Meta 采集时间为准。' : '尚无成功报告，不能解释为零投放或零询盘。'}/>}
    {data && <>
      {data.fileEvidence?.some(f => f.state === 'missing') && <Alert type="warning" showIcon title="原始文件缺失" description="保留这条素材记录，但暂不能预览或用于新投放。请到来源企业的内容制作中找回原文件；不会用其他素材替代。"/>}
      {data.fileEvidence?.some(f => ['mismatch', 'unavailable', 'fingerprinted'].includes(f.state)) && <Alert type="warning" showIcon title="文件版本尚未确认" description="暂不自动关联广告表现，请先在来源企业核对原始成片。"/>}
      <Collapse items={[{ key: 'evidence', label: '来源、版本与统计口径', children: <Descriptions size="small" column={1} items={[
        ...(data.source.sourceTenantId ? [{ key: 'tenant', label: '来源企业', children: <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{data.source.sourceTenantName} · {data.source.sourceTenantId}</span> }] : []),
        { key: 'source', label: '源版本', children: <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{`${data.source.name} · ${data.source.origin === 'studio' ? '我的历史素材' : '已保存社媒成片'} · ${data.source.sha256 || '指纹尚未核验'}`}</span> },
        { key: 'join', label: '来源关联', children: <span style={{ whiteSpace: 'normal' }}>{data.source.note}</span> },
        { key: 'scope', label: '数据边界', children: <span style={{ whiteSpace: 'normal' }}>{data.scopeNote}</span> },
        { key: 'roi', label: '利润 ROI / CRM 有效询盘', children: <span style={{ whiteSpace: 'normal' }}>未接通可验证利润与 CRM 去重归因，不计算；不是 0，也不等于下表 ROAS / lead / 消息会话。</span> },
      ]}/> }]}/>
      {data.truncated && <Alert type="warning" showIcon title="关联记录超过读取上限，当前不是完整素材总账。"/>}
      {data.ads.some(a => a.error) && <Alert type="warning" showIcon title="部分 Meta 数据刷新失败或资源不一致。保留的旧报告以逐条采集时间为准，失败不是零消耗/零询盘。"/>}
      {!data.source.verifiedSource ? <Alert type="info" showIcon title="尚未确认投放关联" description="当前记录还不能与具体广告准确对应，暂不展示投放表现。"/> : !data.ads.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已确认的广告关联，暂不展示投放表现；不代表从未投放。"/>}
      {data.ads.some(a => a.report && !a.report.totals) && <Alert type="info" showIcon title="等待平台数据回传" description="已有关联广告，Meta 暂未返回可用表现；显示 —，不记为零消耗或零询盘。"/>}
      {data.ads.length > 0 && <Table<Lifecycle['ads'][number]> size="small" tableLayout="fixed" rowKey={r => `${r.accountId}:${r.adId}`} pagination={false} dataSource={data.ads} scroll={{ x: 1500 }} columns={[
        { title: '计划 / 广告 / 来源', width: 240, render: (_: unknown, r: Lifecycle['ads'][number]) => <><p>{r.taskName}</p><p>{r.adId} · {r.mapping}</p><p>{r.accountId}</p></> },
        { title: '状态 / 数据范围', width: 270, render: (_: unknown, r: Lifecycle['ads'][number]) => r.report ? <><p>配置 {r.report.configuredStatus} · 有效 {r.report.effectiveStatus}</p><p>{r.report.currency} · {r.report.reportTimezone}</p><p>{r.report.windowAvailable ? `${r.report.window.since} — ${r.report.window.until}` : 'maximum 空报告，历史窗口未返回'}</p><p>Meta 采集：{new Date(r.report.reportedAt).toLocaleString('zh-CN')}</p><p>{r.report.attributionSpec.length ? r.report.attributionSpec.map(a => `${a.event_type} ${a.window_days} 天`).join(' / ') : '归因窗口未返回，不推断'}</p>{r.report.issues.map(i => <p key={i.code}>{i.code} · {i.message}</p>)}{r.error && <p role="alert">{r.error}</p>}</> : <p role="alert">{r.error || '报告尚未返回'}</p> },
        ...(['spend', 'impressions', 'linkClicks', 'leads', 'messagingConversations', 'purchaseValue', 'purchaseRoas'] as const).map(key => ({ title: ({ spend: '花费（账户币种）', impressions: '展示', linkClicks: '链接点击', leads: 'Meta 归因线索 lead', messagingConversations: 'Meta 新消息会话', purchaseValue: 'Meta 归因购买金额', purchaseRoas: 'Meta 购买 ROAS（非 ROI）' })[key], width: 140, render: (_: unknown, r: Lifecycle['ads'][number]) => number(r.report?.totals?.[key]) })),
      ].map(column => ({ ...column, onCell: () => ({ style: { whiteSpace: 'normal', overflowWrap: 'anywhere' } }), onHeaderCell: () => ({ style: { whiteSpace: 'normal', overflowWrap: 'anywhere' } }) }))}/>}
    </>}
  </section>;
}
