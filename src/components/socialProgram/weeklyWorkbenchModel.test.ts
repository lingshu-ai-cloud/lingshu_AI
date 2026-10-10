import assert from 'node:assert/strict';
import type { WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import { classifyWorkbenchEvidence, projectWeeklyWorkbench } from './weeklyWorkbenchModel';

const kinds = ['readiness', 'discovery', 'directing', 'content', 'publishing', 'engagement', 'review'] as const;
const tasks = kinds.map((kind, index) => ({
  taskId: `task-${kind}`, kind, taskRef: { type: index === 4 ? 'provider_receipt' : 'weekly_workflow_task', id: `ref-${kind}`, version: 1 },
  dependsOnTaskIds: index ? [`task-${kinds[index - 1]}`] : [], subjectRefs: kind === 'content' ? [{ type: 'mock_asset', id: 'mock-1', version: 1 }, { type: 'recommendation', id: 'suggestion-1', version: 2 }] : [],
  status: kind === 'content' ? 'blocked' as const : 'planned' as const, ownBlockingReasons: kind === 'content' ? ['asset_missing'] : [],
  inheritedBlockingTaskIds: kind === 'publishing' ? ['task-content'] : [], carriedFromTaskId: null,
}));
const pkg = {
  packageId: 'package-1', programId: 'program-1', version: 3,
  workflows: kinds.map(kind => ({ kind, status: kind === 'content' || kind === 'publishing' ? 'blocked' as const : 'planned' as const, taskRefs: [], blockingReasons: kind === 'content' ? ['asset_missing'] : [] })),
  workflowTasks: tasks,
} as unknown as WeeklyOperatingPackage;

const lanes = projectWeeklyWorkbench(pkg);
assert.equal(lanes.length, 7, 'all seven authoritative workflow kinds must be present');
assert.deepEqual(lanes.find(item => item.kind === 'content')?.tasks[0]?.blockerText, ['asset_missing']);
assert.match(lanes.find(item => item.kind === 'publishing')?.tasks[0]?.blockerText[0] || '', /task-content/);
assert.equal(lanes.find(item => item.kind === 'publishing')?.tasks[0]?.evidence[0]?.evidenceKind, 'real_receipt');
assert.equal(lanes.find(item => item.kind === 'content')?.tasks[0]?.evidence[1]?.evidenceKind, 'mock');
assert.equal(lanes.find(item => item.kind === 'content')?.tasks[0]?.evidence[2]?.evidenceKind, 'suggestion');
assert.equal(classifyWorkbenchEvidence({ type: 'publication_assignment', id: 'a', version: 1 }), 'authoritative', 'an assignment must not masquerade as a real receipt');
assert.equal(lanes[0]?.tasks[0]?.href, '/?page=socialSetup&programId=program-1&packageId=package-1&version=3&taskId=task-readiness');
console.log('weekly workbench projection tests passed');
