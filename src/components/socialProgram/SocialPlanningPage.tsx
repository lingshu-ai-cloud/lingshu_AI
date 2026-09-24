import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, Loader2 } from 'lucide-react';
import type { Page } from '../../pageRegistry';
import { monthlyPlanActivationIssues, type SocialMonthlyPlan } from '../../../shared/contracts/socialProgram';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
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

  useEffect(() => {
    setSelectedAccounts([]);
    setLastSaved(null);
    setNotice('');
  }, [activeProgram?.programId]);

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
    return <SocialProgramPageFrame title="月周经营计划" description="把账号定位转成可执行、可复盘的月计划和周内容任务。"><section className="rounded-xl border border-dashed border-border-bright bg-white px-6 py-14 text-center"><CalendarRange size={32} className="mx-auto text-accent" /><h2 className="mt-4 text-lg font-bold">请先创建经营项目</h2><button type="button" onClick={() => onNavigate('socialSetup')} className="btn-primary mt-5">前往项目搭建</button></section></SocialProgramPageFrame>;
  }

  return (
    <SocialProgramPageFrame title="月周经营计划" description="计划激活遵循服务端前置条件；缺少对标、获客路径或账号规则时不会绕过门槛。">
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
        </div>
      </form>

      <section className="rounded-xl border border-dashed border-border-bright bg-white p-5 sm:p-6"><h2 className="text-lg font-bold">周计划</h2><p className="mt-2 text-sm leading-6 text-text-muted">周内容任务必须绑定当前活动月计划、真实账号、CTA、产品营销档案和事实来源。当前页面不会在这些输入缺失时生成占位任务；周计划编辑器将在后续里程碑接入。</p></section>
    </SocialProgramPageFrame>
  );
}
