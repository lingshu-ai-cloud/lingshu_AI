import assert from 'node:assert/strict';
import { AgentBrowserSessions } from './browserSessions.js';

// An already running task must replay its frame without reloading the workspace.
const manager = new AgentBrowserSessions();
const scope = { tenantId: 'loading-test', runId: 'run', taskId: 'task', dataAuthority: 'pocketbase' as const };
const frame = { type: 'frame', image: 'existing-frame', sequence: 7 };
const session: any = { listeners: new Set(), frame, executing: false, touchedAt: 0 };
(manager as any).sessions.set(JSON.stringify(Object.values(scope)), Promise.resolve(session));
let reads = 0;
const read = async (): Promise<any> => { reads++; return {}; };
const packets: unknown[] = [];
try {
  const stopSmall = await manager.watch(scope, read, packet => packets.push(packet));
  const timer = session.watchTimer;
  const stopFocused = await manager.watch(scope, read, packet => packets.push(packet));
  assert.equal(reads, 0, 'opening another viewer must not reread or navigate the task');
  assert.equal(packets.filter(packet => packet === frame).length, 2, 'both viewers receive the cached real frame immediately');
  assert.equal(session.watchTimer, timer, 'viewers share one refresh timer');
  stopSmall();
  assert.equal(session.watchTimer, timer, 'remaining viewer keeps refreshing');
  stopFocused();
  assert.equal(session.watchTimer, undefined, 'last viewer releases the refresh timer');
} finally {
  (manager as any).sessions.clear();
  await manager.close();
}
console.log('Browser loading regression passed');
