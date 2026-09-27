import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, CalendarRange, CheckCircle2, Loader2 } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import { monthlyPlanActivationIssues, type SocialMonthlyPlan } from '../../../shared/contracts/socialProgram';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
import { socialProgramApi } from '../../lib/socialProgramApi';
import type { OperatingPlanningResolution, SocialOperatingConstraints } from '../../../shared/contracts/socialOperatingDecision';
import SocialProgramPageFrame from './SocialProgramPageFrame';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export default function SocialPlanningPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { activeProgram, accounts, accountsLoading, mutating, saveMonthlyPlan } = useSocialProgram();
  const [month, setMonth] = useState(currentMonth);
  const [objective, setObjective] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [lastSaved, setLastSaved] = useState<SocialMonthlyPlan | null>(null);
  const [notice, setNotice] = useState('');
  const [constraints, setConstraints] = useState<SocialOperatingConstraints | null>(null);
  const [operatingBusy, setOperatingBusy] = useState(false);
  const [operatingError, setOperatingError] = useState('');
  const [resolution, setResolution] = useState<OperatingPlanningResolution | null>(null);
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [limits, setLimits] = useState({ weeklyBudgetCny: 1000, costPerOriginalCny: 50, costPerAdaptationCny: 20, materialUnitsPerOriginal: 1, productionItemsPerDay: 5, interactionItemsPerWeek: 260, salesLeadsPerWeek: 52, expectedInteractionsPerPublication: 10, expectedLeadsPerPublication: 2 });

  useEffect(() => {
    setSelectedAccounts([]);
    setLastSaved(null);
    setNotice('');
    setResolution(null);
    setOperatingError('');
  }, [activeProgram?.programId]);

  useEffect(() => {
    if (!activeProgram) { setConstraints(null); return; }
    void socialProgramApi.getOperatingConstraints(activeProgram.programId).then(item => {
      setConstraints(item);
      if (item) setLimits({ weeklyBudgetCny: item.weeklyBudgetCny, costPerOriginalCny: item.costPerOriginalCny, costPerAdaptationCny: item.costPerAdaptationCny, materialUnitsPerOriginal: item.materialUnitsPerOriginal, productionItemsPerDay: item.productionItemsPerDay, interactionItemsPerWeek: item.interactionItemsPerWeek, salesLeadsPerWeek: item.salesLeadsPerWeek, expectedInteractionsPerPublication: item.expectedInteractionsPerPublication, expectedLeadsPerPublication: item.expectedLeadsPerPublication });
    }).catch(error => setOperatingError(error instanceof Error ? error.message : '经营约束读取失败。'));
  }, [activeProgram?.programId]);

  const saveConstraints = async () => {
    if (!activeProgram) return;
    setOperatingBusy(true); setOperatingError('');
    try {
      const item = await socialProgramApi.saveOperatingConstraints(activeProgram.programId, {
        ...limits, expectedVersion: constraints?.version ?? 0,
        accountWeeklyPublicationCapacity: Object.fromEntries(accounts.map(account => [account.accountId, 5])),
      });
      setConstraints(item); setNotice('经营约束已保存为服务端版本化事实。');
    } catch (error) { setOperatingError(error instanceof Error ? error.message : '经营约束保存失败。'); }
    finally { setOperatingBusy(false); }
  };

  const resolveOperatingPlan = async () => {
    if (!activeProgram) return;
    setOperatingBusy(true); setOperatingError('');
    try {
      const result = await socialProgramApi.resolveOperatingPlan(activeProgram.programId, { weekStart, ...(resolution ? { expectedSnapshotVersion: resolution.snapshot.version } : {}), requestedReferenceMode: 'auto' });
      setResolution(result.item); setNotice('已从企业事实、真实账号、转化入口和能力状态生成权威快照。');
    } catch (error) { setOperatingError(error instanceof Error ? error.message : '经营编排失败。'); }
    finally { setOperatingBusy(false); }
  };

  const activationIssues = useMemo(() => activeProgram ? monthlyPlanActivationIssues(activeProgram) : [], [activeProgram]);
  const toggleAccount = (accountId: string) => setSelectedAccounts(current => current.includes(accountId)
    ? current.filter(item => item !== accountId)
    : [...current, accountId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeProgram) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const activate = submitter?.value === 'activate';
    setNotice('');
    try {
      const saved = await saveMonthlyPlan({
        expectedProgramVersion: activeProgram.version,
        month,
        objective,
        accountIds: selectedAccounts,
        priorityProductRefs: activeProgram.productMarketingProfileRefs,
        audiencePriorities: [],
        contentMix: [],
        experimentVariables: [],
        budgetLimitCny: null,
        successCriteria: successCriteria.split(/[\n,，]/).map(item => item.trim()).filter(Boolean),
        sourceRefs: [
          ...(activeProgram.enterpriseProfileRef ? [activeProgram.enterpriseProfileRef] : []),
          ...activeProgram.productMarketingProfileRefs,
        ],
        activate,
      });
      setLastSaved(saved);
      setNotice(activate ? '月计划已激活，最新项目状态已重新读取。' : '月计划草稿已保存到服务端。');
    } catch { /* context shows the server error */ }
  };

  if (!activeProgram) {
    return <SocialProgramPageFrame title="月周计划" description="把账号方向变成执行节奏。" currentPage="socialPlanning" onNavigate={onNavigate}><section className="rounded-xl border border-dashed border-border-bright bg-white px-6 py-14 text-center"><CalendarRange size={32} className="mx-auto text-accent" /><h2 className="mt-4 text-lg font-bold">请先创建经营项目</h2><button type="button" onClick={() => onNavigate('socialSetup')} className="btn-primary mt-5">上一步：项目方向</button></section></SocialProgramPageFrame>;
  }

  return (
    <SocialProgramPageFrame title="月周计划" description="确认本月目标、执行账号与每周节奏。" currentPage="socialPlanning" onNavigate={onNavigate}>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-white p-5 sm:p-6"><h2 className="text-lg font-bold">当前计划状态</h2><dl className="mt-5 grid gap-4 text-sm"><div><dt className="text-text-muted">活动月计划</dt><dd className="mt-1 font-semibold text-text-primary">{activeProgram.activeMonthlyPlanRef ? `${activeProgram.activeMonthlyPlanRef.id} · v${activeProgram.activeMonthlyPlanRef.version}` : '尚无'}</dd></div><div><dt className="text-text-muted">活动周计划</dt><dd className="mt-1 font-semibold text-text-primary">{activeProgram.activeWeeklyPlanRef ? `${activeProgram.activeWeeklyPlanRef.id} · v${activeProgram.activeWeeklyPlanRef.version}` : '尚无'}</dd></div></dl></div>
        <div className="rounded-xl border border-border bg-white p-5 sm:p-6"><h2 className="text-lg font-bold">月计划激活门槛</h2>{activationIssues.length ? <ul className="mt-4 space-y-2">{activationIssues.map(issue => <li key={issue.code} className="flex items-start gap-2 text-sm text-amber-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{issue.message}</li>)}</ul> : <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-accent"><CheckCircle2 size={16} />服务端前置条件已满足，可提交活动月计划。</p>}</div>
      </section>

      <form onSubmit={submit} className="rounded-xl border border-border bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold">月计划</h2>
        <p className="mt-1 text-sm text-text-muted">草稿和激活都会真实写入 API；由于当前接口尚未提供计划列表，页面仅展示本次保存结果和活动版本引用。</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-text-secondary">月份<input type="month" required value={month} onChange={event => setMonth(event.target.value)} className="ui-field" /></label>
          <label className="space-y-1.5 text-sm font-medium text-text-secondary">成功标准<input required value={successCriteria} onChange={event => setSuccessCriteria(event.target.value)} className="ui-field" placeholder="可用逗号分隔多个标准" /></label>
          <label className="space-y-1.5 text-sm font-medium text-text-secondary sm:col-span-2">本月目标<textarea required value={objective} onChange={event => setObjective(event.target.value)} className="ui-field" placeholder="填写可验证的经营目标" /></label>
        </div>
        <fieldset className="mt-5"><legend className="text-sm font-bold text-text-primary">执行账号</legend>{accountsLoading ? <p className="mt-3 text-sm text-text-muted">正在读取账号……</p> : accounts.length ? <div className="mt-3 flex flex-wrap gap-2">{accounts.map(account => <label key={account.accountId} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${selectedAccounts.includes(account.accountId) ? 'border-accent bg-emerald-50 text-accent' : 'border-border text-text-secondary'}`}><input type="checkbox" checked={selectedAccounts.includes(account.accountId)} onChange={() => toggleAccount(account.accountId)} className="mr-2" />{account.displayName}</label>)}</div> : <p className="mt-3 text-sm text-amber-800">当前项目没有真实账号定义。请先前往账号矩阵。</p>}</fieldset>
        {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-accent">{notice}</p>}
        {lastSaved && <p className="mt-3 text-xs text-text-muted">最近保存：{lastSaved.month} · {lastSaved.status === 'active' ? '活动版本' : '草稿'} · v{lastSaved.version}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="submit" value="draft" disabled={mutating || !selectedAccounts.length || !objective.trim() || !successCriteria.trim()} className="btn-ghost inline-flex items-center gap-2 disabled:opacity-50">{mutating ? <Loader2 size={15} className="animate-spin" /> : null}保存草稿</button>
          <button type="submit" value="activate" disabled={mutating || activationIssues.length > 0 || !selectedAccounts.length || !objective.trim() || !successCriteria.trim()} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">{mutating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}保存并激活</button>
          <button type="button" onClick={() => onNavigate('socialAccounts')} className="btn-ghost">返回账号矩阵</button>
          <button type="button" onClick={() => onNavigate('socialWorkspace')} className="btn-primary inline-flex items-center gap-2">下一步：执行与复盘<ArrowRight size={15} /></button>
        </div>
      </form>

      <details className="rounded-xl border border-border bg-white p-5 sm:p-6">
        <summary className="cursor-pointer list-none text-sm font-bold text-text-secondary">高级经营约束 <span className="ml-2 text-xs font-medium text-text-muted">预算、产能与自动化边界</span></summary>
        <p className="mt-3 text-sm text-text-muted">仅在需要精细控制预算和承接上限时调整。</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {Object.entries(limits).map(([key, value]) => <label key={key} className="space-y-1 text-xs font-medium text-text-secondary">{key}<input type="number" min="0" step="any" value={value} onChange={event => setLimits(current => ({ ...current, [key]: Number(event.target.value) }))} className="ui-field" /></label>)}
          <label className="space-y-1 text-xs font-medium text-text-secondary">周起始日<input type="date" value={weekStart} onChange={event => setWeekStart(event.target.value)} className="ui-field" /></label>
        </div>
        {operatingError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{operatingError}</p>}
        <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => void saveConstraints()} disabled={operatingBusy || !accounts.length} className="btn-ghost">保存容量事实</button><button type="button" onClick={() => void resolveOperatingPlan()} disabled={operatingBusy || !constraints} className="btn-primary">{operatingBusy ? '编排中…' : '生成权威规划快照'}</button></div>
        {resolution && <div className="mt-5 rounded-lg bg-surface-2 p-4 text-sm"><p className="font-bold">快照 v{resolution.snapshot.version} · {resolution.snapshot.status}</p><p className="mt-2 text-text-secondary">目标 {resolution.goal.status} · 产能 {resolution.capacityPlan.status} / {resolution.capacityPlan.publicationQuota} 条 · 自动化 {resolution.automationPolicy.status} · 参考模式 {resolution.referenceMode.status}</p><p className="mt-2 break-all text-xs text-text-muted">周包应引用 operating_authority_snapshot:{resolution.snapshot.snapshotId}:v{resolution.snapshot.version}</p>{resolution.snapshot.invalidations.length > 0 && <p className="mt-2 text-amber-800">需处理 {resolution.snapshot.invalidations.length} 条旧快照/周包失效信息。</p>}</div>}
      </details>

      <section className="rounded-xl border border-dashed border-border-bright bg-white p-5 sm:p-6"><h2 className="text-lg font-bold">周计划</h2><p className="mt-2 text-sm leading-6 text-text-muted">周内容任务必须绑定当前活动月计划、真实账号、CTA、产品营销档案和事实来源。当前页面不会在这些输入缺失时生成占位任务；周计划编辑器将在后续里程碑接入。</p></section>
    </SocialProgramPageFrame>
  );
}
