import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile } from '../../../types/customer';
import { authHeader } from '../../../lib/auth';
import { orderTransitions, paidOrder, type OrderStatus } from '../../../../shared/orderLifecycle';

type CustomerOrder = { customerSyncStatus?: string; id: string; orderNo: string; customerId?: string; product: string; quantity: number; amount: number; orderDate: string; status: OrderStatus };

export function OrderHistoryWidget({ customer }: { customer: CustomerProfile; onCustomerPatch?: (patch: Partial<CustomerProfile>) => void }) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ idempotencyKey: crypto.randomUUID(), orderNo: '', product: '', amount: '', orderDate: new Date().toISOString().slice(0, 10) });
  useEffect(() => {
    let active = true;
    setOrders([]); setError('');
    fetch('/api/overseas/enterprise/orders', { headers: authHeader() }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取订单失败');
      if (active) setOrders((data.items || []).filter((order: CustomerOrder) => order.customerId === customer.id));
    }).catch(error => { if (active) setError(String(error.message)); });
    return () => { active = false; };
  }, [customer.id]);
  const legacy = customer.orders.filter(order => !orders.some(item => item.orderNo === order.id));
  const save = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/overseas/enterprise/orders', {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, orderNo: draft.orderNo || undefined, amount: Number(draft.amount), buyer: customer.name, customerId: customer.id, sourcePostId: customer.sourcePostId, channel: 'WhatsApp', status: '待付款', quantity: 1 }),
      });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error || '保存失败');
      setOrders(current => [order, ...current]); setFormOpen(false);
      setDraft({ idempotencyKey: crypto.randomUUID(), orderNo: '', product: '', amount: '', orderDate: new Date().toISOString().slice(0, 10) });
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const changeStatus = async (order: CustomerOrder, status: OrderStatus) => {
    const evidence = ['已付款', '退款'].includes(status) ? window.prompt('填写已完成付款或退款的凭证；仅登记，不执行资金交易') : '';
    if (evidence === null) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/overseas/enterprise/orders/${encodeURIComponent(order.id)}/status`, {
        method: 'PATCH', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status, evidence }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || '更新失败');
      setOrders(current => current.map(item => item.id === order.id ? updated : item));
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const retrySync = async (order: CustomerOrder) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/overseas/enterprise/orders/${encodeURIComponent(order.id)}/sync-customer`, { method: 'POST', headers: authHeader() });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || '补写失败');
      setOrders(current => current.map(item => item.id === order.id ? updated : item));
      if (updated.customerSyncStatus !== 'done') setError('订单已保存，客户摘要补写仍待恢复');
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <Card>
    <CardHeader><div className="flex items-center justify-between"><p className="text-xs font-bold">订单历史</p>{customer.isReal && <button onClick={() => setFormOpen(!formOpen)} className="text-xs">添加订单</button>}</div></CardHeader>
    <CardContent><div className="space-y-3 text-xs">
      <p className="text-text-muted">订单台账 · 已付款净额 ${orders.filter(paidOrder).reduce((sum, order) => sum + order.amount, 0).toFixed(2)}</p>
      {orders.map(order => <div key={order.id} className="rounded-lg bg-surface-2 p-3"><p className="font-bold">{order.orderNo} · ${order.amount.toFixed(2)}</p><p>{order.product} · {order.orderDate}</p><select disabled={busy} aria-label={`${order.orderNo} 状态`} value={order.status} onChange={event => void changeStatus(order, event.target.value as OrderStatus)}>{[order.status, ...orderTransitions[order.status]].map(status => <option key={status}>{status}</option>)}</select>{order.customerSyncStatus && order.customerSyncStatus !== 'done' && <button disabled={busy} onClick={() => void retrySync(order)}>订单已保存 · 重试客户摘要补写</button>}</div>)}
      {legacy.length > 0 && <div className="rounded-lg border p-3"><p className="text-text-muted">历史客户备注（未导入订单台账，不计入经营成交）</p>{legacy.map(order => <p key={order.id}>{order.id} · {order.total} · {order.status}</p>)}</div>}
      {!orders.length && !legacy.length && <p>暂无订单记录</p>}
      {formOpen && <div className="grid gap-2">
        <input aria-label="订单号" placeholder="订单号（留空自动生成）" value={draft.orderNo} onChange={event => setDraft({ ...draft, orderNo: event.target.value })} />
        <input aria-label="商品名称" placeholder="商品名称" value={draft.product} onChange={event => setDraft({ ...draft, product: event.target.value })} />
        <input aria-label="订单金额" type="number" min="0.01" step="0.01" placeholder="订单金额 USD" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} />
        <input aria-label="订单日期" type="date" value={draft.orderDate} onChange={event => setDraft({ ...draft, orderDate: event.target.value })} />
        <button disabled={busy || !draft.product.trim() || !(Number(draft.amount) > 0)} onClick={() => void save()}>保存待付款订单</button>
      </div>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div></CardContent>
  </Card>;
}
