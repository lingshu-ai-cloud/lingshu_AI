import type { DigitalEmployeeDeepLink, DigitalEmployeeOverview } from './digitalEmployees';
import { buildWeeklyContentProgress, isWeeklyContentProgressProjectInScope, type WeeklyContentProgressProject } from './weeklyContentProgress';

/** Use only the selected content's verified projects, never the first shared task ref. */
export function weeklyProductionStudioLinks(data: DigitalEmployeeOverview, contentId: string, projects: readonly WeeklyContentProgressProject[]): Array<{ projectId: string; language: string; link: DigitalEmployeeDeepLink }> {
  const progress = buildWeeklyContentProgress(data, contentId);
  const run = data.run;
  const items = (data.contentQueue?.items || []).filter(item => item.id === progress.queueItemId);
  const item = items.length === 1 ? items[0] : undefined;
  if (!run || !item || !progress.taskId || item.taskId !== progress.taskId) return [];
  const task = data.tasks.find(candidate => candidate.id === progress.taskId && candidate.run_id === run.id);
  if (!task) return [];
  return [...new Map(projects.filter(project => isWeeklyContentProgressProjectInScope(project, item, run.id, task.id)).map(project => [project.id, project])).values()].map(project => {
    const spec = project.spec as Record<string, unknown>;
    return {
      projectId: project.id,
      language: typeof spec.lang === 'string' ? spec.lang : typeof spec.language === 'string' ? spec.language : '',
      link: {
        page: 'smartAssets', view: 'create', studioPanel: 'projects', runId: run.id, taskId: task.id,
        businessRef: {
          taskKey: task.task_key, entityId: project.id, deliveryId: `studio_project:${project.id}`,
          contentId, resources: [{ type: 'studio_project', id: project.id }],
          businessDomain: task.business_domain, capabilityKey: task.capability_key,
          taskVersion: task.task_version, correctionVersion: task.correction_version,
        },
      },
    };
  });
}
