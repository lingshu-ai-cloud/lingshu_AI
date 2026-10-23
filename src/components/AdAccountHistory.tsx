import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Empty, Select, Space, Spin, Table, Tag } from 'antd';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { platformAdsRequest } from '../lib/platformAds';
import type { MetaAccountHistory } from '../../shared/metaAccountHistory';
import { LsMetricStrip } from './ui/LsExperiencePrimitives';

type Connection = { id: string; provider: string; name: string; accountId: string; currency: string };
const format = (v: number | null | undefined) => v == null ? '暂无数据' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export default function AdAccountHistory() {
  const [connections, setConnections] = useState<Connection[]>([]), [selected, setSelected] = useState('');
  const [reports, setReports] = useState<Record<string, MetaAccountHistory>>({}), [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [listBusy, setListBusy] = useState(true), [refresh, setRefresh] = useState(0), [billing, setBilling] = useState(false), [listError, setListError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setListError(''); setListBusy(true);
    platformAdsRequest<{ items: Connection[] }>('/connections', { signal: abort.signal }).then(v => {
      if (!abort.signal.aborted) setConnections(v.items.filter(c => c.provider === 'meta'));
    }).catch(e => { if (!abort.signal.aborted) setListError(e instanceof Error ? e.message : '账户读取失败'); })
      .finally(() => { if (!abort.signal.aborted) setListBusy(false); });
    return () => abort.abort();
  }, [refresh]);
  const connection = connections.find(c => c.id === selected) || connections[0];
  useEffect(() => {
    if (!connection) return;
    const abort = new AbortController(), id = connection.id; setBusy(true);
    platformAdsRequest<MetaAccountHistory>(`/connections/${encodeURIComponent(id)}/history`, { signal: abort.signal }).then(v => {
      if (!abort.signal.aborted) { setReports(old => ({ ...old, [id]: v })); setErrors(old => ({ ...old, [id]: '' })); }
    }).catch(e => { if (!abort.signal.aborted) setErrors(old => ({ ...old, [id]: e instanceof Error ? e.message : '历史数据读取失败' })); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [connection?.id, refresh]);
  const report = connection ? reports[connection.id] : undefined, error = connection ? errors[connection.id] : '';
  // Empty history is not a zero-valued Insights report. Never synthesize lead/ROAS totals.
  const sum = (key: 'spend' | 'impressions') => report?.complete && report.items.length && report.items.every(i => i.metrics[key] != null)
    ? report.items.reduce((n, i) => n + i.metrics[key]!, 0) : null;
  return <section className="meta-performance" aria-label="Meta 账户真实历史">
    <div className="meta-performance-toolbar">
      <Select aria-label="历史广告账户" placeholder="选择已授权账户" value={connection?.id} onChange={setSelected} options={connections.map(c => ({ value: c.id, label: `${c.name} · ${c.currency}` }))}/>
      <Tag>平台可用历史 · 有消耗广告</Tag>
      <Button icon={<RefreshCw size={15}/>} loading={busy} onClick={() => setRefresh(v => v + 1)}>刷新历史数据</Button>
      <Button disabled={!report} onClick={() => setBilling(true)}>账单与付款方式</Button>
    </div>
    {listError && <Alert type="error" showIcon title={listError}/>}
    {error && <Alert type="error" showIcon title="真实历史查询失败" description={`${error}${report ? '；下方保留上次查询结果，不代表最新数据。' : '；不能据此判断没有消耗。'}`}/>}
    {listBusy && !connection && <Spin aria-label="正在读取已授权账户"/>}
    {!listBusy && !connection && !listError && <Empty description="暂无已接入的 Meta 账户，请通过连接广告账户授权。"/>}
    {busy && !report && <Spin tip="正在只读查询 Meta 历史广告"><div style={{ minHeight: 80 }}/></Spin>}
    {report && <>
      <Space wrap role="status"><span>{report.accountName}</span><Tag>{report.currency} · {report.timezone}</Tag><span>查询于 {new Date(report.reportedAt).toLocaleString('zh-CN')}</span></Space>
      {!report.complete && <Alert type="warning" showIcon title={`历史记录较多，当前展示 ${report.items.length} 条，未覆盖全部历史；不展示汇总。`}/>}
      {report.complete && !report.items.length && <Alert type="info" showIcon title="当前账户未查到有真实消耗的历史广告"
        description={report.hasAccountSpend === false ? 'Meta 返回账户累计花费为 0；平台可用历史中没有花费大于 0 的广告。这不是数据回调故障，也不是充值后就会自动产生效果。' : 'Meta 可用历史未返回花费大于 0 的广告；不代表账户从未投放，也不以其他账户或沙盒数据补齐。'}/>}
      <LsMetricStrip items={[{ key: 'spend', label: `历史广告花费 (${report.currency})`, value: format(sum('spend')) }, { key: 'impressions', label: '历史广告展示', value: format(sum('impressions')) },
        { key: 'leads', label: 'Meta 线索 / 消息会话', value: report.items.length ? '查看广告明细' : '暂无数据' }, { key: 'roas', label: 'Meta 购买 ROAS', value: report.items.length ? '查看广告明细' : '暂无数据' }]}/>
      <Table<MetaAccountHistory['items'][number]> rowKey="adId" size="small" dataSource={report.items} scroll={{ x: 1000 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="没有可展示的真实消耗记录；展示、询盘和 ROAS 不补零、不使用沙盒数据。"/> }} columns={[
        { title: '广告 / 广告系列', key: 'name', width: 240, render: (_, i) => <><p>{i.adName}</p><p>{i.campaignName}</p></> },
        { title: '数据窗口', key: 'window', width: 190, render: (_, i) => `${i.since} — ${i.until}` },
        { title: `花费 (${report.currency})`, key: 'spend', render: (_, i) => format(i.metrics.spend) },
        { title: '展示', key: 'impressions', render: (_, i) => format(i.metrics.impressions) },
        { title: 'Meta 归因线索', key: 'leads', render: (_, i) => format(i.metrics.leads) },
        { title: 'Meta 新消息会话', key: 'messages', render: (_, i) => format(i.metrics.messagingConversations) },
        { title: 'Meta 购买 ROAS', key: 'roas', render: (_, i) => format(i.metrics.purchaseRoas) },
      ]}/>
      <Collapse ghost items={[{ key: 'definitions', label: '数据范围与缺失说明', children: <div className="meta-performance-notes"><p>直接读取当前企业已授权账户的 Meta Insights，不限于在灵枢创建的计划。仅展示平台可用历史中花费大于 0 的广告，不是无限期全生命周期承诺。账户、币种和时区分别展示，不混算。</p><p>线索使用 Meta actions 的 lead；新消息会话单列，不等于已核实的有效询盘，不与线索相加。购买 ROAS 直接读取 Meta purchase_roas，不用点击推算，不等于利润 ROI。未返回的指标显示“暂无数据”，平台真实返回 0 时才显示 0。</p><p>以展示时间回报，使用广告组统一归因设置；各广告窗口分别展示。缺少 CRM 对应关系时不宣称已打通有效询盘或成交收入。仅查询，不导入计划、不挂接素材、不修改广告。</p></div> }]} />
    </>}
    <Drawer title="Meta 账单与付款方式" open={billing} onClose={() => setBilling(false)} size={560}>
      {report && <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Descriptions column={1} items={[{ key: 'account', label: '广告账户', children: `${report.accountName} · ${report.accountId}` }, { key: 'currency', label: '账户币种', children: report.currency },
          { key: 'type', label: '平台付款类型', children: report.billing.prepay === true ? '预付账户' : report.billing.prepay === false ? '非预付账户' : '暂未确认' }]}/>
        <Alert type="info" showIcon title="当前入口只做账单核对，不会充值或扣费" description="灵枢积分与 Meta 广告资金是两套独立账本。当前未接入站内代收或资金划拨，不采集银行卡，也不生成充值订单。"/>
        {report.billing.error && <Alert type="warning" title={report.billing.error}/>}
        <p>{report.billing.prepay === true ? '请到账单页核对是否提供“添加资金”，可用方式和额度由 Meta 决定。' : report.billing.prepay === false ? 'Meta 返回该账户不是预付账户，不应默认走充值流程。请到账单页核对付款方式、待付账单和账户资格。' : '付款类型尚未确认，请到账单页核对，不推断可充值。'}</p>
        <p>在 Meta 页面先核对上述账户和币种；若要求登录，请在官方页面完成登录。本次仅查看，不执行付款、添加资金或提交银行卡。返回灵枢后刷新只会重新查询（缓存最长 60 秒），不会把页面访问视为充值成功。</p>
        <Button icon={<ExternalLink size={15}/>} href={report.billing.settingsUrl} target="_blank" rel="noopener noreferrer">前往 Meta 账单页（只读核对）</Button>
        <Button loading={busy} onClick={() => setRefresh(v => v + 1)}>返回后重新核对账户</Button>
      </Space>}
    </Drawer>
  </section>;
}
