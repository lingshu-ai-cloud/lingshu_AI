import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask, SocialWeeklyPublicationTask } from '../../shared/contracts/socialProgram.js';
import { applyPublicationDeadlines, publicationInstant } from './publicationDeadlines.js';
function task(id: string, step: string, parents: string[], publicationTaskId: string | null = null): WeeklyExecutionTask {
 return { taskId:id, publicationTaskId, dependsOnTaskIds:parents, schedule:{stepKind:step, estimatedDurationMinutes:60, estimatedStartAt:'2026-10-03T00:00:00Z',estimatedFinishAt:'2026-10-03T01:00:00Z'} } as WeeklyExecutionTask;
}
const pub = (id:string, window:string) => ({publicationTaskId:id,publishWindow:window}) as SocialWeeklyPublicationTask;
test('invalid dates and non-executable dependency graphs fail explicitly', () => {
 assert.equal(publicationInstant('2026-02-30T10:00:00+08:00'),null);
 assert.equal(publicationInstant('2026-10-05T24:00:00Z'),null);
 assert.equal(publicationInstant('2026-10-05T10:60:00Z'),null);
 assert.equal(publicationInstant('2026-10-05T10:00:60Z'),null);
 assert.equal(publicationInstant('2028-02-29T10:00:00+08:00'),Date.parse('2028-02-29T10:00:00+08:00'));
 assert.throws(()=>applyPublicationDeadlines([task('a','script',['b']),task('b','storyboard',['a'])],[]), /循环依赖/);
 assert.throws(()=>applyPublicationDeadlines([task('a','script',['missing'])],[]), /不存在/);
 assert.throws(()=>applyPublicationDeadlines([task('a','script',[]),task('a','script',[])],[]), /重复任务/);
});
test('shared predecessor follows earliest publication and retains forward estimates', () => {
 const tasks=[task('shared','asset_generation',[]),task('a','user_approval',['shared']),task('b','user_approval',['shared']),task('pa','publishing',['a'],'p1'),task('pb','publishing',['b'],'p2')];
 const result=applyPublicationDeadlines(tasks.reverse(),[pub('p1','2026-10-05T10:00:00+08:00'),pub('p2','2026-10-06T10:00:00+08:00')]);
 assert.equal(result.find(t=>t.taskId==='a')!.schedule.latestFinishAt,'2026-10-04T02:00:00.000Z');
 assert.equal(result.find(t=>t.taskId==='shared')!.schedule.latestFinishAt,'2026-10-04T01:00:00.000Z');
 assert.equal(result.find(t=>t.taskId==='shared')!.schedule.estimatedFinishAt,'2026-10-03T01:00:00Z');
});
test('ambiguous publication flags its prerequisites without hiding another valid deadline', () => {
 const result=applyPublicationDeadlines([task('shared','asset_generation',[]),task('a','user_approval',['shared']),task('pa','publishing',['a'],'p1'),task('pb','publishing',['shared'],'p2')],[pub('p1','2026-10-05/2026-10-11'),pub('p2','2026-10-06T10:00:00+08:00')]);
 assert(result.find(t=>t.taskId==='a')!.schedule.planningRisks!.includes('precise_publish_time_required'));
 const shared=result.find(t=>t.taskId==='shared')!;
 assert(shared.schedule.planningRisks!.includes('precise_publish_time_required'));
 assert.equal(shared.schedule.latestFinishAt,'2026-10-05T02:00:00.000Z');
 assert.deepEqual(result.find(t=>t.taskId==='pb')!.schedule.planningRisks,[]);
});
test('late plan flags risk and ambiguous publish window is not silently parsed', () => {
 const result=applyPublicationDeadlines([task('a','user_approval',[]),task('p','publishing',['a'],'p1')],[pub('p1','2026-10-03T02:00:00Z')]);
 assert(result[0].schedule.planningRisks!.includes('publication_deadline_at_risk'));
 const invalid=applyPublicationDeadlines([task('p','publishing',[],'p1')],[pub('p1','2026-10-05/2026-10-11')]);
 assert.deepEqual(invalid[0].schedule.planningRisks,['precise_publish_time_required']);
 assert.equal(invalid[0].schedule.latestFinishAt,null);
});
