import type { DigitalEmployeeOverview } from './digitalEmployees';
import { buildWeeklyContentProgress, type WeeklyContentProgressProject } from './weeklyContentProgress';

/** One read-only snapshot. Never reconcile, retry, start work, or infer progress. */
export async function readWeeklyContentProgressSnapshot(input: {
  data: DigitalEmployeeOverview;
  contentId: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<{ data: DigitalEmployeeOverview; projects: WeeklyContentProgressProject[]; receivedAt: string }> {
  const goalId = input.data.goal?.id;
  const planId = input.data.plan?.id;
  if (!goalId || !planId) throw new Error('当前内容缺少周目标或计划关联，请同步当前计划。');
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error('制作进度读取超时')), input.timeoutMs ?? 15_000);
  const fetcher = input.fetcher ?? fetch;
  const read = async (url: string) => {
    const response = await fetcher(url, { method: 'GET', headers: input.headers, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`制作进度读取失败（${response.status}）`);
    return response.json();
  };
  try {
    const [data, projects] = await Promise.all([
      read(`/api/overseas/digital-employees/overview?${new URLSearchParams({ goalId })}`),
      read('/api/overseas/studio/projects'),
    ]) as [DigitalEmployeeOverview, WeeklyContentProgressProject[]];
    const run = data?.run;
    if (data?.goal?.id !== goalId || data?.plan?.id !== planId
      || (input.data.run?.id && run?.id !== input.data.run.id)
      || (run && (run.goal_id !== goalId || run.plan_id !== planId))
      || !Array.isArray(data?.tasks) || !Array.isArray(projects)) {
      throw new Error('制作记录的目标、计划或运行已变化，请同步当前计划。');
    }
    // A newly created project can be discovered even if the previous snapshot had none.
    const ids = new Set(buildWeeklyContentProgress(data, input.contentId).projectIds);
    return { data, projects: projects.filter(project => ids.has(project.id)), receivedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
