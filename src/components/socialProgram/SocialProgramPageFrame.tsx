import { AlertCircle, ArrowRight, Loader2, RefreshCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Page } from '../../pageRegistry';
import { useSocialProgram } from '../../contexts/SocialProgramContext';

export const SOCIAL_STAGE_LABELS = {
  needs_route: '待选择经营路线',
  needs_foundation: '待确认基础资料',
  needs_account_import: '待录入已有账号',
  diagnosing: '账号诊断中',
  needs_benchmarks: '待完成对标试采',
  needs_acquisition_route: '待确认获客路径',
  needs_account_playbook: '待确认账号规则',
  needs_month_plan: '待制定月计划',
  ready_for_week: '可制定周计划',
  executing: '执行中',
  reviewing: '待复盘',
} as const;

const PROGRAM_STEPS: Array<{ page: Page; label: string; next: string }> = [
  { page: 'socialSetup', label: '项目方向', next: '确定市场与路线' },
  { page: 'socialAccounts', label: '账号矩阵', next: '明确每个账号职责' },
  { page: 'socialPlanning', label: '月周计划', next: '安排目标与节奏' },
  { page: 'socialWorkspace', label: '执行复盘', next: '制作、发布并看结果' },
];

export default function SocialProgramPageFrame({
  title,
  description,
  currentPage,
  onNavigate,
  children,
  action,
}: {
  title: string;
  description: string;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { programs, activeProgram, activeProgramId, loading, error, selectProgram, refreshPrograms } = useSocialProgram();
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        <nav aria-label="社媒矩阵经营步骤" className="overflow-x-auto rounded-xl border border-border bg-white p-2">
          <ol className="grid min-w-[680px] grid-cols-4 gap-1">
            {PROGRAM_STEPS.map((step, index) => {
              const active = step.page === currentPage;
              return <li key={step.page}><button type="button" aria-current={active ? 'step' : undefined} onClick={() => onNavigate(step.page)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition ${active ? 'bg-[#173d31] text-white' : 'text-text-secondary hover:bg-surface-2'}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${active ? 'bg-white text-[#173d31]' : 'bg-surface-2 text-text-muted'}`}>{index + 1}</span><span className="min-w-0"><strong className="block text-xs">{step.label}</strong><span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-emerald-100' : 'text-text-muted'}`}>{step.next}</span></span>{index < PROGRAM_STEPS.length - 1 && <ArrowRight size={12} className={`ml-auto shrink-0 ${active ? 'text-emerald-200' : 'text-text-muted'}`} />}</button></li>;
            })}
          </ol>
        </nav>
        <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
              <p className="mt-1 text-sm leading-6 text-text-muted">{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {programs.length > 0 && (
                <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
                  当前项目
                  <select
                    aria-label="当前社媒经营项目"
                    value={activeProgramId || ''}
                    onChange={event => selectProgram(event.target.value)}
                    className="ui-field ui-select min-w-48"
                  >
                    {programs.map(program => <option key={program.programId} value={program.programId}>{program.brandName} · {program.market}</option>)}
                  </select>
                </label>
              )}
              <button type="button" onClick={() => void refreshPrograms()} className="btn-ghost inline-flex items-center gap-2 px-3 py-2" disabled={loading}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}刷新
              </button>
              {action}
            </div>
          </div>
          {activeProgram && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-text-muted">
              <span className="tag">{SOCIAL_STAGE_LABELS[activeProgram.stage]}</span>
              <span>{activeProgram.route === 'cold_start' ? '从零搭建' : activeProgram.route === 'account_repair' ? '已有账号修复' : '路线未选择'}</span>
              <span aria-hidden="true">·</span>
              <span>版本 {activeProgram.version}</span>
              <span aria-hidden="true">·</span>
              <span>更新于 {new Date(activeProgram.updatedAt).toLocaleString('zh-CN')}</span>
            </div>
          )}
          {error && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
            </div>
          )}
        </section>
        {children}
      </main>
    </div>
  );
}
