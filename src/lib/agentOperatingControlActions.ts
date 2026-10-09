import type { SocialWeeklyPublicationTask, WeeklyExecutionTask, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram';
import type { WeeklyRecoveryScenario } from '../components/socialProgram/WeeklyRecoveryPanel';
import { socialProgramApi } from './socialProgramApi';

export function createAgentOperatingControlActions(pkg: WeeklyOperatingPackage, tasks: WeeklyExecutionTask[], api = socialProgramApi) {
  const scoped = tasks.filter(task => task.programId === pkg.programId && task.packageId === pkg.packageId && task.packageVersion === pkg.version);
  return {
    async saveReception(publicationTasks: SocialWeeklyPublicationTask[]) {
      const ids = pkg.socialContentPackage.publicationTasks.map(item => item.publicationTaskId);
      if (publicationTasks.length !== ids.length || new Set(publicationTasks.map(item => item.publicationTaskId)).size !== ids.length || publicationTasks.some(item => !ids.includes(item.publicationTaskId))) throw Error('承接配置与当前冻结发布任务不一致，请重新加载。');
      const next = await api.reviseOperatingPackage(pkg.programId, pkg.packageId, { expectedVersion: pkg.version, publicationTasks, changeReason: '在智能经营任务日历明确逐视频发布承接要求' });
      if (next.programId !== pkg.programId || next.packageId !== pkg.packageId || next.version !== pkg.version + 1 || next.status !== 'draft') throw Error('修订返回身份或状态异常，请重新读取真实周包；不会自动启动。');
      return next;
    },
    async assessRecovery(input: WeeklyRecoveryScenario) {
      if (input.changedTaskIds.some(id => !scoped.some(task => task.taskId === id)) || Object.keys(input.constraints).some(id => !scoped.some(task => task.taskId === id))) throw Error('补救评估包含其它项目或版本任务，请重新选择。');
      return api.assessRecovery(pkg.programId, pkg.packageId, pkg.version, input);
    },
  };
}
