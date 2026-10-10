import type {
  VersionedSocialRef,
  WeeklyOperatingPackage,
  WeeklyOperatingWorkflowKind,
  WeeklyWorkflowTask,
} from '../../../shared/contracts/socialProgram';
import type { Page } from '../../pageRegistry';

export type WorkbenchEvidenceKind = 'authoritative' | 'real_receipt' | 'suggestion' | 'mock';

export interface WeeklyWorkbenchTaskRow {
  task: WeeklyWorkflowTask;
  blockerText: string[];
  evidence: Array<VersionedSocialRef & { evidenceKind: WorkbenchEvidenceKind }>;
  page: Page;
  href: string;
}

export interface WeeklyWorkbenchLane {
  kind: WeeklyOperatingWorkflowKind;
  status: WeeklyOperatingPackage['workflows'][number]['status'];
  blockingReasons: string[];
  tasks: WeeklyWorkbenchTaskRow[];
}

const DESTINATION: Record<WeeklyOperatingWorkflowKind, Page> = {
  readiness: 'socialSetup',
  discovery: 'socialInspiration',
  directing: 'smartAssets',
  content: 'smartAssets',
  publishing: 'traffic',
  engagement: 'socialMonitoring',
  review: 'socialWorkspace',
};

export function classifyWorkbenchEvidence(ref: VersionedSocialRef): WorkbenchEvidenceKind {
  const type = ref.type.toLowerCase();
  if (/(mock|demo|fixture|synthetic)/.test(type)) return 'mock';
  if (/(suggestion|recommendation|candidate)/.test(type)) return 'suggestion';
  if (/^(platform_|publication_)?receipt$/.test(type) || /provider_receipt/.test(type)) return 'real_receipt';
  return 'authoritative';
}

function taskHref(pkg: WeeklyOperatingPackage, task: WeeklyWorkflowTask, page: Page): string {
  return `/?${new URLSearchParams({
    page,
    programId: pkg.programId,
    packageId: pkg.packageId,
    version: String(pkg.version),
    taskId: task.taskId,
  }).toString()}`;
}

export function projectWeeklyWorkbench(pkg: WeeklyOperatingPackage): WeeklyWorkbenchLane[] {
  const byId = new Map(pkg.workflowTasks.map(task => [task.taskId, task]));
  return pkg.workflows.map(workflow => ({
    kind: workflow.kind,
    status: workflow.status,
    blockingReasons: workflow.blockingReasons,
    tasks: pkg.workflowTasks.filter(task => task.kind === workflow.kind).map(task => {
      const inherited = task.inheritedBlockingTaskIds.map(id => {
        const upstream = byId.get(id);
        return upstream ? `上游 ${upstream.kind} 任务 ${id} 阻塞` : `上游任务 ${id} 阻塞`;
      });
      const page = DESTINATION[task.kind];
      return {
        task,
        blockerText: [...task.ownBlockingReasons, ...inherited],
        evidence: [task.taskRef, ...task.subjectRefs].map(ref => ({ ...ref, evidenceKind: classifyWorkbenchEvidence(ref) })),
        page,
        href: taskHref(pkg, task, page),
      };
    }),
  }));
}
