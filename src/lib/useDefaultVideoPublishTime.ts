import { useEffect, useState } from 'react';
import { nextDefaultVideoPublishTime } from '../../shared/contracts/weeklyPublishSchedule';
import { socialContentApi } from './socialContentApi';
import { creationTaskIntake } from './creationTaskWorkspace';
import { productionNavigationIdentity } from './productionNavigation';
import { digitalEmployeeApi } from './digitalEmployeeApi';

/** Suggest a free slot from persisted content tasks; never writes or replaces an explicit choice. */
export function useDefaultVideoPublishTime(enabled: boolean, after?: string): string {
  const [suggestion, setSuggestion] = useState('');
  useEffect(() => {
    setSuggestion('');
    if (!enabled) return;
    let active = true;
    const identity = productionNavigationIdentity();
    const read = async () => {
      const [first, overview] = await Promise.all([socialContentApi.listTasks(1, 100), digitalEmployeeApi.overview()]);
      const tasks = [...first.items];
      for (let page = 2; page <= first.totalPages; page += 1) tasks.push(...(await socialContentApi.listTasks(page, 100)).items);
      const occupied = tasks.filter(task => !['cancelled', 'cancelling'].includes(task.status)).flatMap(task => {
        const value = creationTaskIntake(task)?.plannedPublishAt;
        return value ? [value] : [];
      }).concat((overview.contentQueue?.items || []).flatMap(item => {
        const value = item.contentPlan?.publishAt;
        return value && value.length > 10 ? [value] : [];
      }));
      const minimum = after && Number.isFinite(Date.parse(`${after}+08:00`))
        ? new Date(Math.max(Date.now(), Date.parse(`${after}+08:00`))) : new Date();
      if (active && identity === productionNavigationIdentity()) setSuggestion(nextDefaultVideoPublishTime(minimum, occupied));
    };
    void read().catch(() => { if (active && identity === productionNavigationIdentity()) setSuggestion(''); });
    return () => { active = false; };
  }, [enabled, after]);
  return suggestion;
}
