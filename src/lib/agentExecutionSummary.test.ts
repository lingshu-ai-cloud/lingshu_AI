import assert from 'node:assert/strict';
import { agentExecutionSummary } from './agentExecutionSummary';
import type { DigitalEmployeeOverview, WorkflowTask } from './digitalEmployees';

type Input = Parameters<typeof agentExecutionSummary>[0];
const task = (id: string, status: string, extra = {}): WorkflowTask => ({ id, run_id: 'run', title: id, status, ...extra } as WorkflowTask);
const input = (status: string, tasks: WorkflowTask[]): Input => ({ run: { id: 'run', status } as DigitalEmployeeOverview['run'], tasks, approvals: [] });
assert.equal(agentExecutionSummary({run:null,tasks:[],approvals:[]}).running, false);
const running = agentExecutionSummary(input('running', [task('done','succeeded'),task('work','running'),task('old','succeeded',{run_id:'old'})]));
assert.equal(running.label, '智能体任务执行中');
assert.equal(running.taskId, 'work');
assert.equal(running.completed, 1);
assert.equal(running.total, 2);
for (const status of ['paused','failed','succeeded','cancelled']) {
 assert.equal(agentExecutionSummary(input(status,[task('stale','running')])).running,false,`${status} overrides stale running task`);
}
assert.equal(agentExecutionSummary(input('running',[task('next','pending')])).label,'智能体任务已排队');
assert.equal(agentExecutionSummary(input('running',[task('approval','waiting_approval')])).label,'智能体等待审批');
assert.equal(agentExecutionSummary(input('running',[task('manual','waiting_external',{output:{waitState:{kind:'input',message:'补充资料',requiresAttention:true}}})])).label,'智能体需要你处理');
assert.equal(agentExecutionSummary(input('running',[task('schedule','waiting_external',{output:{waitState:{kind:'scheduled',message:'等待明日',requiresAttention:false}}})])).running,false);
assert.equal(agentExecutionSummary(input('running',[task('render','waiting_external',{output:{waitState:{kind:'processing',message:'视频渲染中',requiresAttention:false}}})])).running,true);
assert.match(agentExecutionSummary(input('running',[task('work','running'),task('approval','waiting_approval')])).detail,/另有任务待你处理/);
console.log('Agent execution state tests passed');
