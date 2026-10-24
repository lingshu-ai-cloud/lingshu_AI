import { useEffect, useRef } from 'react';
import { Button } from 'antd';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import ConnectedAgentCalendar from '../smartBusiness/ConnectedAgentCalendar';
import { projectIndependentContentCalendar } from '../smartBusiness/independentContentCalendar';
import { projectAccountBindingCalendar } from '../smartBusiness/accountBindingCalendar';

type Props = { data: DigitalEmployeeOverview; onBack: () => void; onRefresh: () => void };

/** Reuse the original persisted execution graph, selectors, node details and business routes. */
export default function EmployeeExecutionView({ data, onBack, onRefresh }: Props) {
  const runId = data.run?.id;
  const runTasks = runId ? data.tasks.filter(task => task.run_id === runId) : [];
  const runTaskIds = new Set(runTasks.map(task => task.id));
  const items = (data.contentQueue?.items || []).filter(item => !runId || !item.taskId || runTaskIds.has(item.taskId));
  const bindingTasks = [...projectAccountBindingCalendar(items, (data.config?.publishingTargets || []).map(account => ({ ...account, connected: true }))), ...projectIndependentContentCalendar(runTasks, runId || '')];
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return <section aria-label="数字员工执行现场" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<ArrowLeft size={16}/>} onClick={onBack}>返回目标与成片</Button>
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-text-primary">数字员工执行现场</h3>
      </div>
      <Button icon={<RefreshCw size={15}/>} onClick={() => { onRefresh(); window.dispatchEvent(new Event('lingshu:agent-business-refresh')); }}>刷新进展</Button>
    </header>
    <p className="text-xs leading-5 text-text-secondary">沿用数字员工任务日历的真实周包与执行任务。点击具体节点，查看冻结输入、实际输出和原任务工作区；未派生节点不会补画。</p>
    <ConnectedAgentCalendar executionView startsAt={data.goal?.startsAt} currentRunId={runId} accountBindingTasks={bindingTasks}/>
  </section>;
}
