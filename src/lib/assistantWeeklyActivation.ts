import { getToken } from './auth';
import { socialProgramApi } from './socialProgramApi';
import type { AssistantWeeklyNavigation } from './assistantWeeklyNavigation';

/** Only an explicit confirmation invokes this; navigation never activates. */
export async function activateAssistantWeeklyPackage(target: AssistantWeeklyNavigation, stillCurrent: () => boolean, authorizePublishing = false) {
  const token = getToken();
  if (!token) throw new Error('请登录后确认启动。');
  const [pkg, program] = await Promise.all([socialProgramApi.getOperatingPackage(target.programId, target.packageId), socialProgramApi.get(target.programId)]);
  const assertCurrent = () => {
    if (getToken() !== token || !stillCurrent()) throw new Error('当前身份或周任务已变化，请重新读取后确认。');
  };
  assertCurrent();
  if (pkg.programId !== target.programId || pkg.packageId !== target.packageId || pkg.version !== target.packageVersion || program.programId !== target.programId) throw new Error('周任务版本已变化，请重新读取，不会启动其他版本。');
  if (pkg.status === 'active') return { pkg, alreadyActive: true };
  if (pkg.status !== 'draft' || pkg.agentPlanning?.status !== 'dispatched' || !pkg.agentPlanning.dispatch || !pkg.agentPlanning.userConfirmation) throw new Error('请先完成编导分析、详细计划确认和经营派单，再启动周任务。');
  const activated = await socialProgramApi.activateOperatingPackage(target.programId, target.packageId, {
    expectedVersion: pkg.version, expectedProgramVersion: program.version, authorizePublishing,
  });
  assertCurrent();
  if (activated.status !== 'active' || activated.programId !== target.programId || activated.packageId !== target.packageId || activated.version !== target.packageVersion) throw new Error('尚未取得本周启动回执，请刷新查看真实状态，勿重复启动。');
  return { pkg: activated, alreadyActive: false };
}
