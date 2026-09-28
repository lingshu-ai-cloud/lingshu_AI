import { AlertCircle, Loader2, RefreshCcw } from 'lucide-react';
import type { ReactNode } from 'react';
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

export default function SocialProgramPageFrame({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { programs, activeProgramId, loading, error, selectProgram, refreshPrograms } = useSocialProgram();
  return (
    <div className="bg-[#f6f8f5]">
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-5 sm:px-8 sm:py-7">
        <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-text-muted">{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {programs.length > 0 && (
                <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
                  业务背景
                  <select
                    aria-label="当前经营背景"
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
