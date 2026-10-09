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
console.log(`${tasks.length} cards: eight main stages, nine side flows, seven days and dependency graph verified`);
