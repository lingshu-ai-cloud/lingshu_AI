import { BriefcaseBusiness, Home } from 'lucide-react';
import { useMemo } from 'react';
import type { Page } from '../../App';
import { readSocialContentNavigationTaskId } from '../../lib/socialContentContext';
import {
  parseSocialTaskNavigationContext,
  resolveSocialTaskPresentation,
  type SocialTaskContextPage,
  type SocialTaskView,
} from '../../lib/socialTaskContext';
import { useStarterWorkspace } from './useStarterWorkspace';
import { useSocialContentTaskContext } from './useSocialContentTaskContext';

export default function SocialTaskContextBar({
  page,
  view,
  onNavigate,
}: {
  page: SocialTaskContextPage;
  view?: SocialTaskView;
  onNavigate: (page: Page) => void;
}) {
  const state = useStarterWorkspace();
  const socialTaskId = useMemo(
    () => readSocialContentNavigationTaskId(page, window.history.state),
    [page, view],
  );
  const { socialTask, socialTaskResolved } = useSocialContentTaskContext(socialTaskId);

  const navigation = useMemo(() => parseSocialTaskNavigationContext(
    page,
    window.history.state,
    window.__agentProductionTarget,
  ), [page, view]);
  const context = useMemo(() => resolveSocialTaskPresentation({
    page,
    view,
    socialTask,
    workspace: socialTaskId && !socialTaskResolved ? null : state.workspace,
    navigation,
  }), [navigation, page, socialTask, socialTaskId, socialTaskResolved, state.workspace, view]);

  if (!context) return null;

  return (
    <section data-social-task-context aria-label="当前社媒任务" className="shrink-0 border-b border-emerald-100 bg-[#f6faf7] px-4 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <BriefcaseBusiness size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-text-muted">当前社媒任务</p>
          <p className="truncate text-sm font-bold text-text-primary">{context.taskName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="rounded-full border border-border bg-white px-2.5 py-1 text-text-secondary">{context.pageStage}</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-accent">{context.ownerName}</span>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-text-secondary">{context.statusLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('digitalEmployees')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-bold text-accent transition hover:bg-emerald-50"
        >
          <Home size={12} aria-hidden="true" />
          返回灵小枢
        </button>
      </div>
    </section>
  );
}
