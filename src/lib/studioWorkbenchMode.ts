export type StudioWorkbenchMode = 'demo' | 'edit';
export type StudioWorkbenchPage = 0 | 1 | 2;
export type StudioWorkbenchEntry = 'agent_task' | 'content_creation';

export type StudioWorkbenchViewState = {
  schemaVersion: 1;
  taskId: string;
  entry: StudioWorkbenchEntry;
  mode: StudioWorkbenchMode;
  page: StudioWorkbenchPage;
};

export const STUDIO_WORKBENCH_MODE_LABELS: Record<StudioWorkbenchMode, string> = {
  demo: '演示模式',
  edit: '编辑模式',
};

/**
 * The action creates a new delivery version while preserving the Agent task's
 * current result, so the label must describe both the commit and its outcome.
 */
export const STUDIO_CONFIRM_REVISION_LABEL = '确认修改并生成新成片';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function page(value: unknown): StudioWorkbenchPage | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

/**
 * Agent task drill-downs are read-first. Normal creation keeps the established
 * editing behavior. A persisted state is restored only for the exact task.
 */
export function resolveStudioWorkbenchView(input: {
  taskId: string;
  agentTaskEntry: boolean;
  historyState?: unknown;
}): StudioWorkbenchViewState {
  const taskId = input.taskId.trim();
  const root = record(input.historyState);
  const detail = record(root.productionDetail);
  const persisted = record(detail.studioWorkbenchView ?? root.studioWorkbenchView);
  const persistedPage = page(persisted.page);
  if (
    taskId
    && persisted.schemaVersion === 1
    && text(persisted.taskId) === taskId
    && (persisted.entry === 'agent_task' || persisted.entry === 'content_creation')
    && (persisted.mode === 'demo' || persisted.mode === 'edit')
    && persistedPage !== null
  ) {
    return persisted as StudioWorkbenchViewState;
  }
  return {
    schemaVersion: 1,
    taskId,
    entry: input.agentTaskEntry ? 'agent_task' : 'content_creation',
    mode: input.agentTaskEntry ? 'demo' : 'edit',
    page: 0,
  };
}

export function setStudioWorkbenchMode(
  state: StudioWorkbenchViewState,
  mode: StudioWorkbenchMode,
): StudioWorkbenchViewState {
  return { ...state, mode };
}

/** Demo mode is a complete read-only walkthrough, so every populated page is navigable. */
export function setStudioWorkbenchPage(
  state: StudioWorkbenchViewState,
  nextPage: StudioWorkbenchPage,
): StudioWorkbenchViewState {
  return { ...state, page: nextPage };
}

/** Merge into productionDetail so browser Back/Forward restores the same task view. */
export function withStudioWorkbenchView(
  historyState: unknown,
  view: StudioWorkbenchViewState,
): Record<string, unknown> {
  const root = record(historyState);
  return {
    ...root,
    productionDetail: {
      ...record(root.productionDetail),
      studioWorkbenchView: view,
    },
  };
}

