import { orderStatuses, orderTransitions, paidOrder, type OrderStatus, type AfterSales } from '../../shared/orderLifecycle';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Download,
  Filter,
  LineChart as LineChartIcon,
  PackageCheck,
  Plus,
  Save,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { authHeader } from '../lib/auth';
import { CHART_CURSOR_STYLE, CHART_TOOLTIP_STYLE } from '../lib/uiStyles';
import { normalizeSocialBrand, SocialPlatformIcon } from './SocialPlatformIcon';



interface OrderRecord {
  id: string;
  orderNo: string;
  buyer: string;
  market: string;
  channel: string;
  product: string;
  quantity: number;
  amount: number;
  cost: number;
  status: OrderStatus;
  orderDate: string;
  owner: string;
  source?: string;
  sourceRef?: string;
  sourcePostId?: string;
  idempotencyKey?: string;
  customerSyncStatus?: string;
  customerId?: string;
  audit?: unknown[];
  afterSales?: AfterSales;
  importedAt?: string;
  updatedAt?: string;
}

type DraftOrder = Omit<OrderRecord, 'id' | 'orderNo'>;

const today = new Date().toISOString().slice(0, 10);

const EMPTY_DRAFT: DraftOrder = {
  buyer: '',
  market: '中东',
  channel: 'WhatsApp',
  product: '',
  quantity: 100,
  amount: 0,
  cost: 0,
  status: '待付款',
  orderDate: today,
  owner: 'Mia',
};

const STATUS_STYLE: Record<OrderStatus, { bg: string; fg: string }> = {
  待付款: { bg: '#FEF3C7', fg: '#92400E' },
  已付款: { bg: '#DBEAFE', fg: '#1D4ED8' },
  生产中: { bg: '#EDE9FE', fg: '#6D28D9' },
  已发货: { bg: '#DCFCE7', fg: '#166534' },
  已完成: { bg: '#D1FAE5', fg: '#047857' },
  退款: { bg: '#FEE2E2', fg: '#B91C1C' },
  已取消: { bg: '#F1F5F9', fg: '#64748B' },
};

const statusList = orderStatuses;
const markets = ['全部', '中东', '东南亚', '拉美', '北美', '欧洲', '东亚'];
const channels = ['全部', 'WhatsApp', 'TikTok Shop', 'Facebook', 'Instagram', 'Shopify', 'Email', 'TikTok'];

const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;
const pct = (value: number) => `${value.toFixed(1)}%`;
const tooltipNumber = (value: unknown) => Number(value ?? 0);

function loadOrders(): OrderRecord[] { return []; }


export default function OrderManagementPage() {
  const [orders, setOrders] = useState<OrderRecord[]>(loadOrders);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftOrder>(() => ({ ...EMPTY_DRAFT, idempotencyKey: crypto.randomUUID() }));
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('全部');
  const [channel, setChannel] = useState('全部');
  const [status, setStatus] = useState<'全部' | OrderStatus>('全部');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    fetch('/api/overseas/enterprise/orders', { headers: authHeader() })
      .then(r => r.json())
      .then((data: { items?: OrderRecord[] }) => setOrders(Array.isArray(data.items) ? data.items : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter(order => (
      (!q || `${order.orderNo} ${order.buyer} ${order.product} ${order.owner}`.toLowerCase().includes(q)) &&
      (market === '全部' || order.market === market) &&
      (channel === '全部' || order.channel === channel) &&
      (status === '全部' || order.status === status)
    )).sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  }, [orders, query, market, channel, status]);

  const summary = useMemo(() => {
    const paidLike = filtered.filter(paidOrder);
    const gmv = paidLike.reduce((sum, order) => sum + order.amount, 0);
    const cost = paidLike.reduce((sum, order) => sum + order.cost, 0);
    const pending = filtered.filter(order => order.status === '已付款' || order.status === '生产中').length;
    const refund = filtered.filter(order => order.status === '退款').reduce((sum, order) => sum + order.amount, 0);
    return {
      gmv,
      cost,
      orders: paidLike.length,
      aov: paidLike.length ? gmv / paidLike.length : 0,
      margin: gmv ? (gmv - cost) / gmv * 100 : 0,
      pending,
      refund,
    };
  }, [filtered]);

  const dailyTrend = useMemo(() => {
    const map = new Map<string, { day: string; gmv: number; orders: number }>();
    filtered.forEach(order => {
      if (!paidOrder(order)) return;
      const day = order.orderDate.slice(5);
      const current = map.get(day) ?? { day, gmv: 0, orders: 0 };
      current.gmv += order.amount;
      current.orders += 1;
      map.set(day, current);
    });
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [filtered]);

  const marketBars = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(order => {
      if (!paidOrder(order)) return;
      map.set(order.market, (map.get(order.market) ?? 0) + order.amount);
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const canSave = draft.buyer.trim() && draft.product.trim() && draft.amount > 0;

  const addOrder = async () => {
    if (!canSave) return;
    const payload = {
      ...draft,
      quantity: Math.max(1, Number(draft.quantity) || 1),
      amount: Math.max(0, Number(draft.amount) || 0),
      cost: Math.max(0, Number(draft.cost) || 0),
      source: '手工录入',
    };
    try {
    const next = await fetch('/api/overseas/enterprise/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || '保存失败'); return body; });
    setOrders(prev => [next, ...prev.filter(order => order.orderNo !== next.orderNo)]);
    setDraft({ ...EMPTY_DRAFT, idempotencyKey: crypto.randomUUID() });
    } catch (error) { setFeedback((error as Error).message); }
  };

  const setOrderStatus = async (id: string, nextStatus: OrderStatus) => {
    const evidence = ['已付款', '退款'].includes(nextStatus) ? window.prompt('填写付款/退款凭证（仅登记已发生的交易，不会扣款或退款）') : '';
    if (evidence === null) return;
    try {
    const updated = await fetch(`/api/overseas/enterprise/orders/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ status: nextStatus, evidence }),
    }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || '更新失败'); return body; });
    setOrders(prev => prev.map(order => order.id === id ? updated : order));
    setFeedback(`订单 ${updated.orderNo} 已更新为${updated.status}`);
    } catch (error) { setFeedback((error as Error).message); }
  };

  const handleAfterSales = async (order: OrderRecord) => {
    const status = order.afterSales?.status === 'open' ? 'resolved' : 'open';
    const text = window.prompt(status === 'open' ? '填写售后原因' : '填写售后处理结果（退款需另行登记凭证）');
    if (!text?.trim()) return;
    try {
      const response = await fetch(`/api/overseas/enterprise/orders/${encodeURIComponent(order.id)}/aftersales`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ status, text }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || '售后保存失败');
      setOrders(prev => prev.map(item => item.id === order.id ? updated : item));
      setFeedback(status === 'open' ? '已登记售后' : '已保存售后处理结果');
    } catch (error) { setFeedback((error as Error).message); }
  };

  const removeOrder = async (order: OrderRecord) => {
    if (!window.confirm(`确认删除订单 ${order.orderNo}？此操作用于纠正误录数据，删除后无法恢复。`)) return;
    const resp = await fetch(`/api/overseas/enterprise/orders/${encodeURIComponent(order.id)}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!resp.ok) {
      setFeedback(`订单 ${order.orderNo} 删除失败，请稍后重试`);
      return;
    }
    setOrders(prev => prev.filter(item => item.id !== order.id));
    setFeedback(`已删除误录订单 ${order.orderNo}`);
  };

  const exportCsv = () => {
    if (!filtered.length) {
      setFeedback('当前筛选没有可导出的订单');
      return;
    }
    const headers = ['订单号', '客户', '市场', '渠道', '商品', '数量', 'GMV', '成本', '状态', '日期', '负责人', '来源', '来源凭证'];
    const rows = filtered.map(order => [order.orderNo, order.buyer, order.market, order.channel, order.product, order.quantity, order.amount, order.cost, order.status, order.orderDate, order.owner, order.source || '', order.sourceRef || '']);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lingshu-orders-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback(`已导出 ${filtered.length} 条订单`);
  };

  const input = 'h-9 rounded-lg border border-border bg-surface px-3 text-xs outline-none transition-colors hover:border-border-bright focus:border-accent';
  const smallInput = `${input} w-full`;

  return (
    <div className="flex h-full flex-col bg-white" data-lingshu-guide="orders-workbench">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-5">
        <div className="mb-4 flex min-h-9 items-center justify-end gap-3">
          <span aria-live="polite" className="text-xs font-semibold text-text-muted">{feedback}</span>
          <button type="button" onClick={exportCsv} className="btn-ghost flex items-center gap-2 !px-3 !py-2">
            <Download size={14} />
            导出 CSV
          </button>
        </div>
        <div className="secondary-stat-strip mb-5">
          {[
            { label: '有效 GMV', value: money(summary.gmv), desc: `${summary.orders} 个有效订单`, icon: <DollarSign size={14} />, color: '#047857', bg: '#D1FAE5' },
            { label: '平均客单价', value: money(summary.aov), desc: '按有效订单计算', icon: <TrendingUp size={14} />, color: '#1D4ED8', bg: '#DBEAFE' },
            { label: '毛利率', value: pct(summary.margin), desc: `毛利 ${money(summary.gmv - summary.cost)}`, icon: <LineChartIcon size={14} />, color: '#6D28D9', bg: '#EDE9FE' },
            { label: '待履约', value: String(summary.pending), desc: `退款金额 ${money(summary.refund)}`, icon: <PackageCheck size={14} />, color: '#92400E', bg: '#FEF3C7' },
          ].map(item => (
            <div key={item.label} className="secondary-stat-item p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-muted">{item.label}</span>
                <span className="flex h-7 w-7 items-center justify-center text-accent">{item.icon}</span>
              </div>
              <p className="text-2xl font-bold font-display text-text-primary">{item.value}</p>
              <p className="mt-1 text-xs text-text-muted">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="card !rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">GMV 趋势</p>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-text-muted">当前筛选</span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend} margin={{ top: 8, right: 16, bottom: 0, left: -6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" tickFormatter={(value: number | string) => `$${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE} formatter={(value: unknown, name: unknown) => [name === 'gmv' ? money(tooltipNumber(value)) : tooltipNumber(value), name === 'gmv' ? 'GMV' : '订单']} />
                  <Line type="monotone" dataKey="gmv" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3, fill: '#16a34a' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card !rounded-xl p-4">
            <p className="text-sm font-semibold text-text-primary">市场贡献</p>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={marketBars} layout="vertical" margin={{ top: 6, right: 16, bottom: 0, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={56} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE} formatter={(value: unknown) => [money(tooltipNumber(value)), 'GMV']} />
                  <Bar dataKey="value" fill="#22c55e" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="mb-5 rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <Plus size={15} className="text-green-700" />
            <p className="text-sm font-semibold text-text-primary">新增订单记录</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-6">
            <input aria-label="客户名称" value={draft.buyer} onChange={e => setDraft(s => ({ ...s, buyer: e.target.value }))} placeholder="客户名称" className={smallInput} />
            <input aria-label="商品 / SKU" value={draft.product} onChange={e => setDraft(s => ({ ...s, product: e.target.value }))} placeholder="商品 / SKU" className={smallInput} />
            <select aria-label="市场" value={draft.market} onChange={e => setDraft(s => ({ ...s, market: e.target.value }))} className={smallInput}>
              {markets.filter(x => x !== '全部').map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <select aria-label="渠道" value={draft.channel} onChange={e => setDraft(s => ({ ...s, channel: e.target.value }))} className={smallInput}>
              {channels.filter(x => x !== '全部').map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input aria-label="数量" type="number" min={1} value={draft.quantity} onChange={e => setDraft(s => ({ ...s, quantity: Number(e.target.value) }))} placeholder="数量" className={smallInput} />
            <input aria-label="订单日期" type="date" value={draft.orderDate} onChange={e => setDraft(s => ({ ...s, orderDate: e.target.value }))} className={smallInput} />
            <input aria-label="GMV / 美元" type="number" min={0} value={draft.amount || ''} onChange={e => setDraft(s => ({ ...s, amount: Number(e.target.value) }))} placeholder="GMV / 美元" className={smallInput} />
            <input aria-label="成本 / 美元" type="number" min={0} value={draft.cost || ''} onChange={e => setDraft(s => ({ ...s, cost: Number(e.target.value) }))} placeholder="成本 / 美元" className={smallInput} />
            <select aria-label="订单状态" value={draft.status} onChange={e => setDraft(s => ({ ...s, status: e.target.value as OrderStatus }))} className={smallInput}>
              {statusList.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input aria-label="来源内容 ID" value={draft.sourcePostId || ''} onChange={e => setDraft(s => ({ ...s, sourcePostId: e.target.value }))} placeholder="来源内容 ID（可选，用于成交归因）" className={smallInput} />
            <input aria-label="付款或来源凭证" value={draft.sourceRef || ''} onChange={e => setDraft(s => ({ ...s, sourceRef: e.target.value }))} placeholder="付款或来源凭证" className={smallInput} />
            <input aria-label="负责人" value={draft.owner} onChange={e => setDraft(s => ({ ...s, owner: e.target.value }))} placeholder="负责人" className={smallInput} />
            <button type="button" onClick={addOrder} disabled={!canSave} className="btn-primary flex h-9 items-center justify-center gap-2 !px-3 !py-0 disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-2">
              <Save size={14} />
              保存订单
            </button>
          </div>
        </section>

        <section className="card !rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索订单号、客户、商品、负责人" className={`${input} w-full pl-9`} />
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Filter size={13} />
              筛选
            </div>
            <select aria-label="筛选市场" value={market} onChange={e => setMarket(e.target.value)} className={input}>{markets.map(x => <option key={x} value={x}>{x === '全部' ? '全部市场' : x}</option>)}</select>
            <select aria-label="筛选渠道" value={channel} onChange={e => setChannel(e.target.value)} className={input}>{channels.map(x => <option key={x} value={x}>{x === '全部渠道' ? x : x}</option>)}</select>
            <select aria-label="筛选状态" value={status} onChange={e => setStatus(e.target.value as '全部' | OrderStatus)} className={input}>
              <option value="全部">全部状态</option>
              {statusList.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr>
                  {['订单号', '客户 / 商品', '市场', '渠道', '数量', 'GMV', '毛利率', '状态', '日期', '负责人', '操作'].map(head => (
                    <th key={head} className="px-4 py-2.5 font-semibold whitespace-nowrap">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(order => {
                  const margin = order.amount ? (order.amount - order.cost) / order.amount * 100 : 0;
                  const style = STATUS_STYLE[order.status];
                  return (
                    <tr key={`${order.id}:${order.status}`} className="hover:bg-surface-2/70">
                      <td className="px-4 py-3 font-mono text-[11px] text-text-secondary">{order.orderNo}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-text-primary">{order.buyer}</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">{order.product}</p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{order.market}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        <span className="inline-flex items-center gap-1.5">
                          {normalizeSocialBrand(order.channel) && <SocialPlatformIcon platform={order.channel} size={15} />}
                          {order.channel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{order.quantity.toLocaleString()}</td>
                      <td className="px-4 py-3 font-semibold text-text-primary">{money(order.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={margin < 25 ? 'font-semibold text-amber' : 'font-semibold text-green'}>
                          {pct(margin)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span aria-live="polite" className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: style.bg, color: style.fg }}>{order.status}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{order.orderDate}</td>
                      <td className="px-4 py-3 text-text-secondary">{order.owner}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                        <select aria-label={`${order.orderNo} 订单状态：${order.status}`} value={order.status} onChange={e => setOrderStatus(order.id, e.target.value as OrderStatus)} className="rounded-md border border-border bg-white px-2 py-1 text-[11px] outline-none">
                          {[order.status, ...orderTransitions[order.status]].map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                        <button type="button" onClick={() => void handleAfterSales(order)} className="ml-2 text-xs text-emerald-700">{order.afterSales?.status === 'open' ? '处理售后' : '登记售后'}</button>
                        {order.afterSales && <span className="block text-xs text-slate-500">{order.afterSales.reason}{order.afterSales.resolution ? ` · ${order.afterSales.resolution}` : ' · 待处理'}</span>}
                        <button type="button" disabled={order.status !== '待付款' || Boolean(order.customerId) || Boolean(order.audit?.length)} onClick={() => void removeOrder(order)} aria-label={`删除订单 ${order.orderNo}`} title="删除误录订单" className="rounded-md border border-red-100 p-1.5 text-red-600 hover:bg-red-50">
                          <Trash2 size={13} />
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-text-muted">
                      <div className="flex items-center justify-center gap-2">
                        <AlertTriangle size={14} />
                        {loading ? '正在读取真实订单数据…' : '暂无真实订单记录，请先在企业中心导入 CSV 或手工录入订单'}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
          <CheckCircle2 size={12} />
          订单仅展示当前企业空间已导入或手工录入的真实记录；后续可继续接入 Shopify、ERP、支付和履约系统自动同步。
        </div>
        </div>
      </div>
    </div>
  );
}
