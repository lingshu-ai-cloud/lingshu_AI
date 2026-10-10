import assert from 'node:assert/strict';
import { agentCalendarDemo as tasks } from './agentCalendarDemo';
const ids = new Set(tasks.map(task => task.id));
assert.equal(ids.size, tasks.length);
for (const prefix of ['M','S']) {
 for (let index = 1; index <= (prefix === 'M' ? 8 : 9); index++) assert(tasks.some(task => task.chain === `Z-${prefix}${index}`));
}
for (const task of tasks) {
 assert(task.output && task.title && task.agent);
 for (const id of task.dependsOn || []) {
  assert(ids.has(id), `Missing dependency ${id}`);
  const parent = tasks.find(item => item.id === id)!;
  assert(parent.date <= task.date, `Dependency scheduled after ${task.id}`);
 }
}
const visited = new Set<string>();
function check(id: string, stack = new Set<string>()) {
 assert(!stack.has(id), 'Dependency cycle');
 if (visited.has(id)) return;
 const next = new Set(stack).add(id);
 for (const parent of tasks.find(task => task.id === id)!.dependsOn || []) check(parent, next);
 visited.add(id);
}
for (const task of tasks) check(task.id);
assert.equal(new Set(tasks.map(task => task.date)).size, 7);
assert(tasks.some(task => task.agent === 'human' && task.submission === 'missing' && task.dueAt));
// The fixture must follow the same finish-before-publish contract as real weekly scheduling.
const instant = (id: string) => {
 const task = tasks.find(item => item.id === id)!;
 return Date.parse(`${task.date}T${task.time}:00+08:00`);
};
for (const [productionId, publicationId] of [['task-14','task-16'],['task-15','task-16'],['task-27','task-36'],['task-28','task-36']]) {
 assert(instant(publicationId!) - instant(productionId!) >= 24 * 60 * 60 * 1000,
  `${publicationId} must publish at least 24 hours after ${productionId} finishes`);
}
assert(instant('task-19') > instant('task-16'), 'Inquiry handling starts after the first publication');
console.log(`${tasks.length} cards: eight main stages, nine side flows, seven days and dependency graph verified`);
