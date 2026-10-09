import { useEffect, useState } from 'react';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import { useOptionalSocialProgram } from '../../contexts/SocialProgramContext';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { projectExecutionCalendar } from '../socialProgram/weeklyExecutionCalendar';
import { STEP_LABEL } from '../socialProgram/weeklyExecutionLabels';
import AgentWeeklyCalendar from './AgentWeeklyCalendar';

const identity = (pkg: WeeklyOperatingPackage) => JSON.stringify([pkg.packageId, pkg.version]);
export default function ConnectedAgentCalendar() {
  const context = useOptionalSocialProgram();
  const program = context?.activeProgram;
  const [packages, setPackages] = useState<WeeklyOperatingPackage[]>([]);
  const [selected, setSelected] = useState('');
  const [tasks, setTasks] = useState<WeeklyExecutionTask[]>([]);
  const [error, setError] = useState('');
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const loading = packagesLoading || tasksLoading;
  useEffect(() => {
    let cancelled = false;
    setPackages([]); setSelected(''); setTasks([]); setError(''); setPackagesLoading(false);
    if (!program) return;
    setPackagesLoading(true);
    void socialProgramApi.listOperatingPackages(program.programId).then(items => {
      if (cancelled) return;
      setPackages(items);
      const ref = program.activeWeeklyOperatingPackageRef;
      const active = ref ? items.find(item => item.programId === program.programId && item.packageId === ref.id && item.version === ref.version) : undefined;
      if (active) setSelected(identity(active));
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '周任务包读取失败'); })
      .finally(() => { if (!cancelled) setPackagesLoading(false); });
    return () => { cancelled = true; };
  }, [program?.programId, program?.activeWeeklyOperatingPackageRef?.id, program?.activeWeeklyOperatingPackageRef?.version]);
  const pkg = packages.find(item => item.programId === program?.programId && identity(item) === selected);
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    setTasks([]); setError(''); setTasksLoading(false);
    if (!pkg || !program || pkg.programId !== program.programId) return;
    setTasksLoading(true);
    const read = async () => {
      if (cancelled || reading) return;
      reading = true;
      try {
        const items = await socialProgramApi.listExecutionTasks(pkg.programId, pkg.packageId, pkg.version);
        if (items.some(item => item.programId !== pkg.programId || item.packageId !== pkg.packageId || item.packageVersion !== pkg.version)) throw new Error('执行任务与所选周包版本不一致，请刷新后重试。');
        if (!cancelled) { setTasks(items); setError(''); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : '执行排期读取失败'); }
      finally { reading = false; if (!cancelled) setTasksLoading(false); }
    };
    void read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 10_000);
    const visible = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [pkg?.programId, pkg?.packageId, pkg?.version]);
  if (!program) return <p className="p-6 text-sm text-slate-500">请先选择社媒经营项目，再查看真实 Agent 周任务排期。</p>;
  return <div>
    <div className="flex flex-wrap items-center gap-3 px-6 pt-5 text-xs">
      <span className="font-bold text-slate-700">经营项目：{program.brandName}</span>
      <select aria-label="查看周任务包版本" value={selected} onChange={event => setSelected(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <option value="">请选择周任务包</option>
        {packages.map(item => <option key={identity(item)} value={identity(item)}>{item.weekStart} · v{item.version} · {item.objective}</option>)}
      </select>
      {pkg?.referenceSourcePolicy && <span>自有 {pkg.referenceSourcePolicy.ownedPercent}% / 外部 {pkg.referenceSourcePolicy.externalPercent}% · 按母版</span>}
    </div>
    {loading && <p className="p-6 text-xs text-slate-500">正在读取真实执行排期…</p>}
    {error && <p role="alert" className="m-6 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {!loading && !error && pkg && <AgentWeeklyCalendar startsAt={pkg.weekStart} tasks={projectExecutionCalendar(tasks.filter(item => item.programId === pkg.programId && item.packageId === pkg.packageId && item.packageVersion === pkg.version), STEP_LABEL)} onOpenProduction={task => {
      if (!task.productionTaskId) return;
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', socialContentTaskId: task.productionTaskId, socialContentPage: 'smartAssets', socialContentView: 'managed' } }));
    }} />}
    {!loading && !error && !pkg && <p className="p-6 text-xs text-slate-500">选择已有周包查看排期；无周包时需先生成经营周计划。</p>}
  </div>;
}
