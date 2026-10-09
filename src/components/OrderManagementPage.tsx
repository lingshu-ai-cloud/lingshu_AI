import { PAGE_REGISTRY } from "../pageRegistry";
import { orderStatuses, orderTransitions, paidOrder, transitionOrder, updateAfterSales, type OrderStatus, type AfterSales, type OrderAudit } from '../../shared/orderLifecycle';
import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Statistic, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import LsDataChart from './ui/LsDataChart';
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
import { authHeader } from '../lib/auth';
import { normalizeSocialBrand, SocialPlatformIcon } from './SocialPlatformIcon';
import { createForeignTradeMockOrders, isForeignTradeMockId, isLocalForeignTradeMockEnabled } from '../mocks/foreignTradeOperations';



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
  audit?: OrderAudit[];
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

function withLocalMockOrders(items: OrderRecord[]): OrderRecord[] {
  if (!isLocalForeignTradeMockEnabled()) return items;
  const realIds = new Set(items.map(item => item.id));
  return [...items, ...createForeignTradeMockOrders().filter(item => !realIds.has(item.id))];
}

function loadOrders(): OrderRecord[] { return withLocalMockOrders([]); }


export default function OrderManagementPage() {
  const { modal } = App.useApp();
  const [orders, setOrders] = useState<OrderRecord[]>(loadOrders);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftOrder>(() => ({ ...EMPTY_DRAFT, idempotencyKey: crypto.randomUUID() }));
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('全部');
  const [channel, setChannel] = useState('全部');
  const [status, setStatus] = useState<'全部' | OrderStatus>('全部');
  const [feedback, setFeedback] = useState('');
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [promptInput, setPromptInput] = useState('');
  const [promptRequest, setPromptRequest] = useState<{ title: string; resolve: (value: string | null) => void } | null>(null);
  const askText = (title: string) => new Promise<string | null>(resolve => { setPromptInput(''); setPromptRequest({ title, resolve }); });
  const closePrompt = (value: string | null) => { promptRequest?.resolve(value); setPromptRequest(null); };

  useEffect(() => {
    fetch('/api/overseas/enterprise/orders', { headers: authHeader() })
      .then(async r => { if (!r.ok) throw new Error('订单数据读取失败，请稍后刷新'); return r.json(); })
      .then((data: { items?: OrderRecord[] }) => setOrders(withLocalMockOrders(Array.isArray(data.items) ? data.items : [])))
      .catch(error => setLoadError(error instanceof Error ? error.message : '订单数据读取失败'))
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
      const day = order.orderDate;
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
    if (!canSave || saving) return;
    setSaving(true);
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
    setCreateOpen(false);
    setFeedback('订单已保存');
    } catch (error) { setFeedback((error as Error).message); }
    finally { setSaving(false); }
  };

  const setOrderStatus = async (id: string, nextStatus: OrderStatus) => {
    const evidence = ['已付款', '退款'].includes(nextStatus) ? await askText('填写付款/退款凭证（仅登记已发生的交易，不会扣款或退款）') : '';
    if (evidence === null) return;
    if (isForeignTradeMockId(id)) {
      try {
        setOrders(prev => prev.map(order => order.id === id ? transitionOrder(order, nextStatus, evidence || '本地演示状态更新') as OrderRecord : order));
        setFeedback('本地模拟订单状态已更新');
      } catch (error) { setFeedback((error as Error).message); }
      return;
    }
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
    const text = await askText(status === 'open' ? '填写售后原因' : '填写售后处理结果（退款需另行登记凭证）');
    if (!text?.trim()) return;
    if (isForeignTradeMockId(order.id)) {
      try {
        setOrders(prev => prev.map(item => item.id === order.id ? updateAfterSales(item, status, text) as OrderRecord : item));
        setFeedback(status === 'open' ? '已登记本地模拟售后' : '已保存本地模拟售后结果');
      } catch (error) { setFeedback((error as Error).message); }
      return;
    }
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
    if (!await modal.confirm({ title: `删除误录订单 ${order.orderNo}？`, content: '删除后无法恢复。已关联客户或有审计记录的订单不可删除。', okText: '删除订单', cancelText: '取消', okButtonProps: { danger: true }, icon: <AlertTriangle size={20}/> })) return;
    if (isForeignTradeMockId(order.id)) {
      setOrders(prev => prev.filter(item => item.id !== order.id));
      setFeedback(`已从当前预览移除模拟订单 ${order.orderNo}`);
      return;
    }
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

  const hasDemo = filtered.some(order => isForeignTradeMockId(order.id));
  const statusColor = (value: OrderStatus) => value === '退款' ? 'error' : value === '已完成' || value === '已发货' ? 'success' : value === '待付款' ? 'warning' : value === '已取消' ? 'default' : 'processing';
  return <div className="h-full overflow-y-auto bg-surface-2" data-lingshu-guide="orders-workbench">
    <div className="mx-auto max-w-[1440px] space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap justify-end gap-2"><h1 className="sr-only">{PAGE_REGISTRY.orders.canonicalTitle}</h1><Button icon={<Download size={15}/>} onClick={exportCsv}>导出 CSV</Button><Button type="primary" icon={<Plus size={15}/>} onClick={() => setCreateOpen(true)}>新增订单</Button></header>
      {isLocalForeignTradeMockEnabled() && <Alert type="info" showIcon title="本地演示订单" description="当前展示真实订单与外贸工厂演示订单；明细持续标记来源，含演示数据的指标仅用于预览。"/>}
      {loadError && <Alert type="error" showIcon title={loadError} description="已保留当前记录；刷新页面重新读取。"/>}
      {feedback && <Alert type="info" showIcon title={feedback} closable onClose={() => setFeedback('')}/>}
      <div className="grid rounded-lg border border-border bg-white sm:grid-cols-2 xl:grid-cols-4">{[
        { label: '有效成交额', value: money(summary.gmv), note: `${summary.orders} 个有效订单` },
        { label: '平均客单价', value: money(summary.aov), note: '按有效订单计算' },
        { label: '毛利率', value: pct(summary.margin), note: `毛利 ${money(summary.gmv - summary.cost)}` },
        { label: '待履约', value: summary.pending, note: `退款金额 ${money(summary.refund)}` },
      ].map(item => <div key={item.label} className="border-border p-5 sm:border-r last:border-r-0"><Statistic title={<span>{item.label} {hasDemo && <Tag>含演示数据</Tag>}</span>} value={item.value}/><p className="mt-2 text-xs text-text-secondary">{item.note}</p></div>)}</div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <LsDataChart title="成交额趋势" description="单位：美元；按当前筛选订单的完整订单日期汇总，仅计有效订单。包含演示订单时仅供预览。" kind="line" labels={dailyTrend.map(item => item.day)} series={[{ label: hasDemo ? '成交额（含演示）' : '成交额', values: dailyTrend.map(item => item.gmv) }]} unit="美元" demo={hasDemo} loading={loading && !orders.length}/>
        <LsDataChart title="市场贡献" description="单位：美元；当前筛选的有效订单成交额，最多展示 10 个市场。" kind="bar" horizontal labels={marketBars.slice(0, 10).map(item => item.name)} series={[{ label: hasDemo ? '成交额（含演示）' : '成交额', values: marketBars.slice(0, 10).map(item => item.value) }]} unit="美元" demo={hasDemo} loading={loading && !orders.length}/>
      </div>
      <section className="rounded-lg border border-border bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-3"><Input className="!w-full sm:!w-80" aria-label="搜索订单" value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={15}/>} placeholder="搜索订单号、客户、商品、负责人" allowClear/>
          <Select className="min-w-32" aria-label="筛选市场" value={market} onChange={setMarket} options={markets.map(value => ({ value, label: value === '全部' ? '全部市场' : value }))}/>
          <Select className="min-w-36" aria-label="筛选渠道" value={channel} onChange={setChannel} options={channels.map(value => ({ value, label: value === '全部' ? '全部渠道' : value }))}/>
          <Select className="min-w-32" aria-label="筛选状态" value={status} onChange={setStatus} options={['全部', ...statusList].map(value => ({ value, label: value === '全部' ? '全部状态' : value }))}/>
        </div><p className="mb-3 text-xs text-text-secondary">共 {filtered.length} 条订单 · 展开订单可查看来源凭证、负责人和售后记录</p>
        <Table<OrderRecord> rowKey="id" dataSource={filtered} loading={loading && !orders.length} pagination={{ pageSize: 10, showSizeChanger: false }} columns={[
          { title: '客户 / 商品', key: 'buyer', render: (_, order) => <div><p className="font-medium">{order.buyer}</p><p className="mt-1 text-xs text-text-secondary">{order.product} · {order.orderNo}</p>{isForeignTradeMockId(order.id) && <Tag>演示订单</Tag>}<p className="mt-1 text-xs text-text-secondary sm:hidden">{order.status} · {money(order.amount)}</p></div> },
          { title: '市场 / 渠道', key: 'market', responsive: ['lg'], render: (_, order) => <div>{order.market}<p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">{normalizeSocialBrand(order.channel) && <SocialPlatformIcon platform={order.channel} size={14}/>} {order.channel}</p></div> },
          { title: '成交额', dataIndex: 'amount', align: 'right', responsive: ['sm'], sorter: (a, b) => a.amount - b.amount, render: value => money(value) },
          { title: '日期', dataIndex: 'orderDate', responsive: ['xl'], sorter: (a, b) => a.orderDate.localeCompare(b.orderDate) },
          { title: '状态', key: 'status', responsive: ['sm'], render: (_, order) => <Tag color={statusColor(order.status)}>{order.status}</Tag> },
          { title: '操作', key: 'actions', render: (_, order) => <div className="flex flex-wrap items-center gap-2"><Select aria-label={`${order.orderNo} 订单状态：${order.status}`} value={order.status} className="min-w-28" onChange={value => void setOrderStatus(order.id, value)} options={[order.status, ...orderTransitions[order.status]].map(value => ({ value, label: value }))}/><Button type="text" onClick={() => void handleAfterSales(order)}>{order.afterSales?.status === 'open' ? '处理售后' : '登记售后'}</Button><Button danger type="text" disabled={order.status !== '待付款' || Boolean(order.customerId) || Boolean(order.audit?.length)} onClick={() => void removeOrder(order)} aria-label={`删除订单 ${order.orderNo}`} title="仅待付款、未关联客户且无审计记录的误录订单可删除" icon={<Trash2 size={15}/>}/></div> },
        ]} expandable={{ expandedRowRender: order => <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{[
          ['数量', order.quantity.toLocaleString()], ['成本', money(order.cost)], ['毛利率', pct(order.amount ? (order.amount - order.cost) / order.amount * 100 : 0)], ['负责人', order.owner], ['来源', order.source || '手工录入'], ['来源凭证', order.sourceRef || '未登记'], ['来源内容', order.sourcePostId || '未关联'], ['日期', order.orderDate], ['售后', order.afterSales ? `${order.afterSales.reason} · ${order.afterSales.resolution || '待处理'}` : '暂无售后'],
        ].map(([label, content]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 break-words">{content}</dd></div>)}</dl> }}/>
      </section>
    </div>
    <Modal open={createOpen} title="新增订单记录" onCancel={() => !saving && setCreateOpen(false)} mask={{ closable: false }} width={720} footer={<div className="flex justify-end gap-2"><Button disabled={saving} onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" loading={saving} disabled={!canSave} icon={<Save size={15}/>} onClick={() => void addOrder()}>保存订单</Button></div>}>
      <Form layout="vertical" className="!mt-5"><div className="grid gap-x-4 sm:grid-cols-2">
        <Form.Item label="客户名称" required><Input aria-label="客户名称" value={draft.buyer} onChange={event => setDraft(value => ({ ...value, buyer: event.target.value }))}/></Form.Item>
        <Form.Item label="商品 / SKU" required><Input aria-label="商品 / SKU" value={draft.product} onChange={event => setDraft(value => ({ ...value, product: event.target.value }))}/></Form.Item>
        <Form.Item label="市场"><Select aria-label="市场" value={draft.market} onChange={market => setDraft(value => ({ ...value, market }))} options={markets.filter(item => item !== '全部').map(value => ({ value, label: value }))}/></Form.Item>
        <Form.Item label="渠道"><Select aria-label="渠道" value={draft.channel} onChange={channel => setDraft(value => ({ ...value, channel }))} options={channels.filter(item => item !== '全部').map(value => ({ value, label: value }))}/></Form.Item>
        <Form.Item label="数量"><InputNumber aria-label="数量" className="!w-full" min={1} value={draft.quantity} onChange={quantity => setDraft(value => ({ ...value, quantity: quantity ?? 1 }))}/></Form.Item>
        <Form.Item label="订单日期"><DatePicker aria-label="订单日期" className="!w-full" value={dayjs(draft.orderDate)} allowClear={false} onChange={date => setDraft(value => ({ ...value, orderDate: date ? date.format('YYYY-MM-DD') : today }))}/></Form.Item>
        <Form.Item label="成交额（美元）" required><InputNumber aria-label="成交额（美元）" className="!w-full" min={0} value={draft.amount} onChange={amount => setDraft(value => ({ ...value, amount: amount ?? 0 }))}/></Form.Item>
        <Form.Item label="成本（美元）"><InputNumber aria-label="成本（美元）" className="!w-full" min={0} value={draft.cost} onChange={cost => setDraft(value => ({ ...value, cost: cost ?? 0 }))}/></Form.Item>
        <Form.Item label="订单状态"><Select aria-label="订单状态" value={draft.status} onChange={status => setDraft(value => ({ ...value, status }))} options={statusList.map(value => ({ value, label: value }))}/></Form.Item>
        <Form.Item label="负责人"><Input aria-label="负责人" value={draft.owner} onChange={event => setDraft(value => ({ ...value, owner: event.target.value }))}/></Form.Item>
        <Form.Item label="来源内容 ID"><Input aria-label="来源内容 ID" value={draft.sourcePostId || ''} onChange={event => setDraft(value => ({ ...value, sourcePostId: event.target.value }))}/></Form.Item>
        <Form.Item label="付款或来源凭证"><Input aria-label="付款或来源凭证" value={draft.sourceRef || ''} onChange={event => setDraft(value => ({ ...value, sourceRef: event.target.value }))}/></Form.Item>
      </div></Form>
      {feedback && <Alert type="info" title={feedback}/>}
    </Modal>
    <Modal open={Boolean(promptRequest)} title={promptRequest?.title || '补充订单信息'} onCancel={() => closePrompt(null)} onOk={() => closePrompt(promptInput.trim())} okText="确认记录" cancelText="取消" mask={{ closable: false }} okButtonProps={{ disabled: !promptInput.trim() }}><Input.TextArea autoFocus aria-label={promptRequest?.title || '补充订单信息'} value={promptInput} onChange={event => setPromptInput(event.target.value)} rows={4}/></Modal>
  </div>;
}
