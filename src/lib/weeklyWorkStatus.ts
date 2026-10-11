import type { DigitalEmployeeOverview, WorkflowTask } from './digitalEmployees';

export type WeeklyWorkPhase = 'preparing' | 'queued' | 'running' | 'blocked' | 'paused' | 'finished' | 'unknown';
export type WeeklyWorkOutcome = 'succeeded' | 'failed' | 'cancelled' | null;

export type WeeklyWorkStatus = {
  phase: WeeklyWorkPhase;
  outcome: WeeklyWorkOutcome;
  runId: string;
  title: string;
  description: string;
  currentTaskId: string;
  currentTaskTitle: string;
  controller: string;
  completedTasks: number;
  totalTasks: number;
  startedAt: string;
  blocker: string;
};

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const QUEUED_RUN_STATUSES = new Set(['initializing', 'planning', 'queued', 'pending']);
const BLOCKED_RUN_STATUSES = new Set(['blocked', 'waiting_approval', 'waiting_human']);
const BLOCKED_TASK_STATUSES = new Set(['blocked', 'failed', 'waiting_approval', 'waiting_human', 'handed_off']);
const RUNNING_TASK_STATUSES = new Set(['running', 'planning']);
const EXTERNAL_TASK_STATUSES = new Set(['waiting_external']);
const COMPLETED_TASK_STATUSES = new Set(['succeeded', 'completed']);

function firstTask(tasks: WorkflowTask[], statuses: Set<string>): WorkflowTask | undefined {
  return [...tasks]
    .sort((left, right) => left.sequence - right.sequence)
    .find((task) => statuses.has(task.status));
}

function preparationStatus(data: DigitalEmployeeOverview): WeeklyWorkStatus {
  const detail = data.plan?.businessPackage?.detailGeneration;
  const ready = detail?.status === 'ready';
  const readyCount = Number(detail?.readyCount || 0);
  const blockedCount = Number(detail?.blockedCount || 0);
  return {
    phase: 'preparing',
    outcome: null,
    runId: '',
    title: ready ? '制作准备已完成，尚未开始生产' : '周计划尚未开始生产',
    description: ready
      ? `${readyCount} 条母版的内容准备已完成${blockedCount ? `，另有 ${blockedCount} 条仍需补齐资料` : ''}；点击“开始周任务”后才会建立真实运行，实际生成还需生产服务可用。`
      : detail?.status === 'blocked'
        ? `可以开始周任务；${blockedCount || '若干'} 条内容的缺失项将在各自制作步骤提示，不阻止其他内容推进。`
        : '点击“开始周任务”后，系统依次完成脚本分析、素材匹配、生成与合成；正式发布前再验收和授权。',
    currentTaskId: '',
    currentTaskTitle: '',
    controller: '',
    completedTasks: 0,
    totalTasks: 0,
    startedAt: '',
    blocker: '',
  };
}

export function weeklyWorkStatus(data: DigitalEmployeeOverview): WeeklyWorkStatus | null {
  if (!data.goal) return null;
  const run = data.run;
  if (!run) return preparationStatus(data);

  const tasks = data.tasks.filter((task) => task.run_id === run.id);
  const blockedTask = firstTask(tasks, BLOCKED_TASK_STATUSES);
  const runningTask = firstTask(tasks, RUNNING_TASK_STATUSES);
  const externalTask = firstTask(tasks, EXTERNAL_TASK_STATUSES);
  const pendingTask = [...tasks]
    .sort((left, right) => left.sequence - right.sequence)
    .find((task) => ['pending', 'queued'].includes(task.status));
  const completedTasks = tasks.filter((task) => COMPLETED_TASK_STATUSES.has(task.status)).length;
  const blocker = blockedTask?.blocked_reason || run.pause_reason || '';

  if (run.goal_id !== data.goal.id) {
    return {
      phase: 'unknown',
      outcome: null,
      runId: run.id,
      title: '运行归属待确认',
      description: '当前运行与页面周目标不一致，未将它显示为本轮生产；请刷新后核对真实运行。',
      currentTaskId: '',
      currentTaskTitle: '',
      controller: run.current_controller || '',
      completedTasks,
      totalTasks: tasks.length,
      startedAt: run.started_at || '',
      blocker: '',
    };
  }

  let phase: WeeklyWorkPhase;
  if (TERMINAL_RUN_STATUSES.has(run.status)) phase = 'finished';
  else if (run.status === 'paused') phase = 'paused';
  else if (run.status === 'waiting_external' || (!runningTask && externalTask)) phase = 'queued';
  else if (BLOCKED_RUN_STATUSES.has(run.status) || (blockedTask && !runningTask)) phase = 'blocked';
  else if (QUEUED_RUN_STATUSES.has(run.status) || (!runningTask && pendingTask)) phase = 'queued';
  else if (run.status === 'running') phase = 'running';
  else phase = 'unknown';

  const currentTask = phase === 'blocked'
    ? blockedTask || runningTask || externalTask || pendingTask
    : runningTask || externalTask || pendingTask || blockedTask;

  const outcome = TERMINAL_RUN_STATUSES.has(run.status)
    ? run.status as Exclude<WeeklyWorkOutcome, null>
    : null;
  const copy = phase === 'unknown'
    ? {
        title: '运行状态待确认',
        description: `系统返回了未识别的运行状态“${run.status || '空'}”；未将它显示为正在生产，请刷新后核对。`,
      }
    : phase === 'queued' && (run.status === 'waiting_external' || (!runningTask && externalTask))
      ? {
          title: '本周任务已启动，等待外部服务',
          description: blocker || (currentTask ? `${currentTask.title}正在等待真实业务回写。` : '运行正在等待外部服务或真实业务回写。'),
        }
      : phase === 'queued'
    ? {
        title: run.status === 'initializing' ? '本周任务已建立，正在初始化' : '本周任务已建立，正在排队准备',
        description: tasks.length === 0
          ? '真实运行已经建立，任务清单仍在初始化；生产结果尚未确认。'
          : currentTask
          ? `当前等待：${currentTask.title}。系统已有真实运行，生产节点会按依赖顺序开始。`
          : '系统已有真实运行，正在编排首个生产节点。',
      }
    : phase === 'running'
      ? {
          title: '本周任务正在生产',
          description: tasks.length === 0
            ? '运行已建立，但任务清单尚未同步；请查看进度或刷新后核对。'
            : currentTask
            ? `当前节点：${currentTask.title}；已完成 ${completedTasks}/${tasks.length} 项。`
            : `数字员工正在执行；已完成 ${completedTasks}/${tasks.length} 项。`,
        }
      : phase === 'blocked'
        ? {
            title: '本周任务等待处理',
            description: blocker || (currentTask ? `${currentTask.title} 需要处理后才能继续。` : '当前运行存在待处理卡点。'),
          }
        : phase === 'paused'
          ? {
              title: '本周任务已暂停',
              description: run.pause_reason || '运行与已有结果已保留，可从当前节点继续。',
            }
          : outcome === 'succeeded'
            ? { title: '本周任务已完成', description: `共 ${tasks.length} 项任务，结果已进入对应业务页面。` }
            : outcome === 'failed'
              ? { title: '本周任务执行失败', description: blocker || '运行已停止；请查看生产现场中的失败节点和可恢复操作。' }
              : { title: '本周任务已取消', description: '运行已结束，已有结果仍保留在对应业务页面。' };

  return {
    phase,
    outcome,
    runId: run.id,
    title: copy.title,
    description: copy.description,
    currentTaskId: currentTask?.id || '',
    currentTaskTitle: currentTask?.title || '',
    controller: run.current_controller || currentTask?.agent_role || '',
    completedTasks,
    totalTasks: tasks.length,
    startedAt: run.started_at || '',
    blocker,
  };
}
