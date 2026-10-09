import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, LayoutDashboard } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
import { socialProgramApi } from '../../lib/socialProgramApi';
import type { WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import SocialProgramPageFrame, { SOCIAL_STAGE_LABELS } from './SocialProgramPageFrame';
import WeeklyOperatingWorkbench from './WeeklyOperatingWorkbench';

const READINESS_LABELS = {
  foundationConfirmed: '基础资料',
  accountImportConfirmed: '已有账号录入',
  diagnosisComplete: '账号诊断',
  benchmarkRoundComplete: '对标账号试采',
  conversionRouteConfirmed: '获客路径',
  accountPlaybooksConfirmed: '账号规则',
  monthlyPlanActive: '活动月计划',
  weeklyPlanActive: '活动周计划',
  productionInProgress: '内容生产',
  reviewDue: '复盘到期',
} as const;

export default function SocialWorkspacePage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { activeProgram, programs, accounts, loading, accountsLoading, selectProgram } = useSocialProgram();
  const [weeklyPackage, setWeeklyPackage] = useState<WeeklyOperatingPackage | null>(null);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageError, setPackageError] = useState('');
  const query = new URLSearchParams(window.location.search);
  const linkedProgramId = query.get('programId');
  const linkedPackageId = query.get('packageId');
  const linkedVersion = Number(query.get('version'));
  const linkedTaskId = query.get('taskId');

  useEffect(() => {
    if (linkedProgramId && programs.some(item => item.programId === linkedProgramId) && activeProgram?.programId !== linkedProgramId) selectProgram(linkedProgramId);
  }, [activeProgram?.programId, linkedProgramId, programs, selectProgram]);

  const refreshPackage = useCallback(async () => {
    if (!activeProgram) { setWeeklyPackage(null); return; }
    setPackageLoading(true);
    setPackageError('');
    try {
      const items = await socialProgramApi.listOperatingPackages(activeProgram.programId);
      const selected = linkedPackageId
        ? items.find(item => item.packageId === linkedPackageId && (!Number.isInteger(linkedVersion) || linkedVersion <= 0 || item.version === linkedVersion))
        : items.find(item => item.packageId === activeProgram.activeWeeklyOperatingPackageRef?.id && item.version === activeProgram.activeWeeklyOperatingPackageRef?.version)
          || items.find(item => item.status === 'active') || items[0];
      setWeeklyPackage(selected || null);
      if (linkedPackageId && !selected) setPackageError('深链指定的周包版本不存在，未使用其他版本替代。');
    } catch (cause) {
      setWeeklyPackage(null);
      setPackageError(cause instanceof Error ? cause.message : '周工作台读取失败。');
    } finally { setPackageLoading(false); }
  }, [activeProgram, linkedPackageId, linkedVersion]);

  useEffect(() => { void refreshPackage(); }, [refreshPackage]);
  if (!activeProgram) {
    return (
      <SocialProgramPageFrame title="执行与复盘" description="完成前三步后，在这里推进内容、发布和复盘。" currentPage="socialWorkspace" onNavigate={onNavigate}>
        <section className="rounded-xl border border-dashed border-border-bright bg-white px-6 py-14 text-center">
          <LayoutDashboard size={32} className="mx-auto text-accent" />
          <h2 className="mt-4 text-lg font-bold text-text-primary">{loading ? '正在读取经营项目' : programs.length ? '请选择一个经营项目' : '还没有社媒经营项目'}</h2>
          {!loading && !programs.length && <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-muted">先确认品牌、市场、目标受众和经营路线。系统不会用示例账号替代真实配置。</p>}
          {!loading && <button type="button" onClick={() => onNavigate('socialSetup')} className="btn-primary mt-5 inline-flex items-center gap-2">开始搭建<ArrowRight size={15} /></button>}
        </section>
      </SocialProgramPageFrame>
    );
  }

  const readiness = Object.entries(activeProgram.readiness) as Array<[keyof typeof READINESS_LABELS, boolean]>;
  const completed = readiness.filter(([, ready]) => ready).length;
  const nextAction: { page: Page; label: string; detail: string } = !activeProgram.readiness.foundationConfirmed
    ? { page: 'socialSetup', label: '下一步：确认项目方向', detail: '市场、受众与经营路线还没确认' }
    : !accountsLoading && accounts.length === 0
      ? { page: 'socialAccounts', label: '下一步：添加账号矩阵', detail: '至少定义一个真实执行账号' }
      : !activeProgram.activeMonthlyPlanRef
        ? { page: 'socialPlanning', label: '下一步：制定月周计划', detail: '为账号安排目标、节奏与预算' }
        : { page: 'smartAssets', label: '下一步：制作本周内容', detail: `${accounts.length} 个账号已进入执行准备` };

  return (
    <SocialProgramPageFrame title="执行与复盘" description="看当前状态，只处理下一件最重要的事。" currentPage="socialWorkspace" onNavigate={onNavigate}>
      <section className="flex flex-col gap-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div><p className="text-[11px] font-black text-emerald-700">当前项目 · {SOCIAL_STAGE_LABELS[activeProgram.stage]}</p><h2 className="mt-1 text-lg font-bold text-text-primary">{nextAction.detail}</h2><p className="mt-1 text-xs text-text-muted">系统只推荐一个主动作；其他步骤仍可从上方步骤条进入。</p></div>
        <button type="button" onClick={() => onNavigate(nextAction.page)} className="btn-primary inline-flex shrink-0 items-center justify-center gap-2">{nextAction.label}<ArrowRight size={15} /></button>
      </section>

      <WeeklyOperatingWorkbench pkg={weeklyPackage} programRoute={activeProgram.route} onRevision={next => {
        const url = new URL(window.location.href);
        url.searchParams.set('packageId', next.packageId);
        url.searchParams.set('version', String(next.version));
        url.searchParams.delete('taskId');
        window.history.replaceState(window.history.state, '', url);
        setWeeklyPackage(next);
      }} loading={packageLoading} error={packageError} selectedTaskId={linkedTaskId} onRefresh={() => void refreshPackage()} />

      <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-bold text-text-primary">经营就绪度</h2><p className="mt-1 text-sm text-text-muted">状态来自项目服务端记录，不根据页面浏览行为自动标记完成。</p></div>
          <p className="text-sm font-bold text-accent">{completed}/{readiness.length}</p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${Math.round(completed / readiness.length * 100)}%` }} /></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {readiness.map(([key, ready]) => (
            <div key={key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              {ready ? <CheckCircle2 size={16} className="shrink-0 text-accent" /> : <Circle size={16} className="shrink-0 text-text-muted" />}
              <span className={ready ? 'font-medium text-text-primary' : 'text-text-muted'}>{READINESS_LABELS[key]}</span>
            </div>
          ))}
        </div>
      </section>
    </SocialProgramPageFrame>
  );
}
