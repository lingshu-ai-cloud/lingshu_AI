import { creationReplySchema, type CreationTurn } from '../../shared/contracts/contentCreationDialogue';
import { authHeader } from './auth';
export async function readScenePlan(turn: CreationTurn) {
  const response = await fetch('/api/overseas/strategy/creation-dialogue', { method:'POST', headers:{...authHeader(),'Content-Type':'application/json'}, body:JSON.stringify(turn), signal:AbortSignal.timeout(45000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.code || '方案核验失败，请重试。');
  return creationReplySchema.parse(body);
}
export async function submitScenePlan(plan: ReturnType<typeof creationReplySchema.parse>) {
  if (!plan.guided || plan.guided.blockers.length) throw new Error('请先补齐方案中的待确认项。');
  const response = await fetch('/api/overseas/starter-198/social-content/guided-creation/submit', {method:'POST',headers:{...authHeader(),'Content-Type':'application/json','Idempotency-Key':`scene:${plan.guided.fingerprint}`},body:JSON.stringify({selection:plan.selection,fingerprint:plan.guided.fingerprint}),signal:AbortSignal.timeout(45000)});
  const body = await response.json();
  if (!response.ok || typeof body.taskId !== 'string') throw new Error(body.message || body.code || '提交结果待核验，请保留当前方案重试。');
  return {taskId:body.taskId as string,executionState:body.receipt?.started?'running' as const:body.receipt?.queued?'queued' as const:body.receipt?.blockedReason?'blocked' as const:'saved' as const};
}
