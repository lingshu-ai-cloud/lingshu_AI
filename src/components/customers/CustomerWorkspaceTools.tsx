import LocalCustomerSimulation from './LocalCustomerSimulation';
import { isLocalForeignTradeMockEnabled } from '../../mocks/foreignTradeOperations';
import {BasicInfoWidget} from './widgets/BasicInfoWidget';
import {TagsWidget} from './widgets/TagsWidget';
import {OrderHistoryWidget} from './widgets/OrderHistoryWidget';
import type {CustomerProfile} from '../../types/customer';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Select, Space, Spin, Tabs } from 'antd';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { digitalEmployeeApi, buildTaskDeepLink, type DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import CustomerWorkflowPanel from '../CustomerWorkflowPanel';
import { customerWorkspaceTasks } from './customerWorkspaceTasks';
const WeComCustomerServicePage = lazy(() => import('../WeComCustomerServicePage'));

export default function CustomerWorkspaceTools({ customers,selectedCustomer,onCustomerPatch,onToast }: { customers: Array<{ id: string; name: string }>;selectedCustomer:CustomerProfile|null;onCustomerPatch:(patch:Partial<CustomerProfile>)=>void;onToast:(message:string)=>void }) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState('batch');
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [goalId, setGoalId] = useState(''), [taskId, setTaskId] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const clear = () => { setOpen(false); setOverview(null); setGoalId(''); setTaskId(''); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, clear); window.addEventListener('storage', clear);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, clear); window.removeEventListener('storage', clear); };
  }, []);
  useEffect(() => {
    if (!open || tab !== 'batch') return;
    let active = true; const authorization = authHeader().Authorization;
    setLoading(true); setError(''); setOverview(null); setTaskId('');
    void digitalEmployeeApi.overview(goalId).then(data => {
      if (active && authorization === authHeader().Authorization) setOverview(data);
    }).catch(e => { if (active && authorization === authHeader().Authorization) setError(e instanceof Error ? e.message : '客服任务读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, tab, goalId, refresh]);
  const simulationAvailable = selectedCustomer?.isMock && isLocalForeignTradeMockEnabled() && import.meta.env.VITE_LINGSHU_LOCAL_PREVIEW === '1';
  const tasks = customerWorkspaceTasks(overview), task = tasks.find(t => t.id === taskId);
  const link = task && overview?.run ? buildTaskDeepLink(task, undefined, overview.run.id) : null;
  return <div className="flex shrink-0 flex-wrap justify-end gap-2 border-b border-border px-4 py-2">
    <Button disabled={!selectedCustomer} onClick={() => { setTab('profile'); setOpen(true); }}>客户资料与订单</Button>
    <Button onClick={() => { setTab('batch'); setOpen(true); }}>批量跟进与模板审批</Button>
    <Button onClick={() => { setTab('wecom'); setOpen(true); }}>微信客服</Button>
    {simulationAvailable && <Button onClick={() => { setTab('simulation'); setOpen(true); }}>本地模拟链路</Button>}
    <Drawer title="客服工作区" open={open} onClose={() => setOpen(false)} size="large" destroyOnHidden>
      <Tabs activeKey={tab} onChange={setTab} items={[
        ...(simulationAvailable && selectedCustomer ? [{key:'simulation',label:'本地模拟',children:tab==='simulation'?<LocalCustomerSimulation key={selectedCustomer.id} customer={selectedCustomer} onPatch={onCustomerPatch}/>:null}] : []),
        {key:'profile',label:'客户资料',children:!selectedCustomer||selectedCustomer.isHistorical||selectedCustomer.readOnly?<Empty description="当前客户仅供查阅会话"/>:<Space key={selectedCustomer.id} orientation="vertical" className="w-full"><BasicInfoWidget customer={selectedCustomer} onCustomerPatch={selectedCustomer.isMock||selectedCustomer.source==='messenger'||selectedCustomer.source==='instagram'?onCustomerPatch:undefined}/><TagsWidget customer={selectedCustomer} onCustomerPatch={onCustomerPatch} onToast={onToast}/><OrderHistoryWidget customer={selectedCustomer}/></Space>},
        { key: 'batch', label: '批量跟进', children: <Space orientation="vertical" className="w-full">
          <Alert type="info" showIcon title="按原周计划筛选客户、修订草稿、配置模板和审批跟进。" />
          {error && <Alert type="error" showIcon title={error} />}
          <Button disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新客服任务</Button>
          {loading ? <Spin /> : <>
            {!!overview?.goals.length && <Select aria-label="客服周计划" placeholder="选择周计划" value={goalId || overview.goal?.id} className="w-full"
              options={overview.goals.map(goal => ({ value: goal.id, label: `${goal.startsAt.slice(0, 10)} · ${goal.status}` }))}
              onChange={value => { setGoalId(value); setTaskId(''); }} />}
            {!tasks.length ? <Empty description="当前周计划没有可查看的客服任务。" /> : <>
              <Select aria-label="客服任务" placeholder="选择分层、草稿、审批或执行任务" value={taskId || undefined} className="w-full"
                options={tasks.map(t => ({ value: t.id, label: `${t.title} · ${t.status}` }))} onChange={setTaskId} />
              {link?.page === 'conversion' && <CustomerWorkflowPanel key={`${link.runId}:${link.taskId}`} handoff={link} customers={customers} />}
            </>}
          </>}
        </Space> },
        { key: 'wecom', label: '微信客服', children: tab === 'wecom' ? <Suspense fallback={<Spin />}><WeComCustomerServicePage /></Suspense> : null },
      ]} />
    </Drawer>
  </div>;
}
