import { onFollowupWorkerEvent } from './followupDispatchWorker.js';
import { type Response } from 'express';
import { store } from '../storage/index.js';
import { publicEventPayload } from './overviewProjection.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, type EventRecord, type StoredRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createWorkflowEvents(deps: Pick<DigitalEmployeeApplicationPorts, 'requiredCreate' | 'appendAudit'>) {
  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  const streamClients = new Map<string, Set<Response>>();

  const eventAppendQueues = new Map<string, Promise<void>>();

  function sendEvent(response: Response, event: EventRecord): void {
    response.write(`id: ${event.sequence}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  async function appendEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    type: string;
    level?: 'info' | 'warning' | 'error' | 'success';
    summary: string;
    payload?: Record<string, unknown>;
  }): Promise<EventRecord> {
    const queueKey = `${input.tenantId}:${input.runId}`;
    const prior = eventAppendQueues.get(queueKey) || Promise.resolve();
    const operation = prior.catch(() => undefined).then(async () => {
      const latest = await store.list<EventRecord>(COLLECTION.events, {
        where: { tenant_id: input.tenantId, run_id: input.runId }, sort: '-sequence', page: 1, perPage: 1,
      });
      const sequence = Number(latest.items[0]?.sequence || 0) + 1;
      const event = await requiredCreate<EventRecord>(COLLECTION.events, {
        tenant_id: input.tenantId,
        run_id: input.runId,
        task_id: input.taskId || '',
        sequence,
        type: input.type,
        level: input.level || 'info',
        summary: input.summary,
        payload: publicEventPayload(input.payload || {}),
        occurred_at: new Date().toISOString(),
      });
      // Persist before broadcasting so reconnecting clients can always replay this sequence.
      for (const client of streamClients.get(input.runId) || []) sendEvent(client, event);
      return event;
    });
    const tail = operation.then(() => undefined, () => undefined);
    eventAppendQueues.set(queueKey, tail);
    try {
      return await operation;
    } finally {
      if (eventAppendQueues.get(queueKey) === tail) eventAppendQueues.delete(queueKey);
    }
  }

  async function appendAuthorizationRequiredEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    reason: 'content_changed' | 'package_adjusted' | 'critical_business_change';
    changedFields?: string[];
  }): Promise<void> {
    await appendEvent({
      ...input,
      type: 'authorization_required',
      level: 'warning',
      summary: '本周预算、产品、市场或发布授权范围已变更，受影响的自动发布已暂停，请查看差异并重新授权。',
      payload: {
        eventType: input.reason === 'critical_business_change' ? 'critical_business_change' : 'weekly_package_adjusted',
        reason: input.reason,
        changedFields: input.changedFields || [],
        action: 'review_weekly_package',
      },
    });
  }

  function registerFollowupWorkerEvents() {
    const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);
    onFollowupWorkerEvent(async event => {
      await appendEvent({
        tenantId: event.tenantId,
        runId: event.runId,
        taskId: event.taskId,
        type: event.type,
        level: event.level,
        summary: event.summary,
        payload: { batchId: event.batchId, itemId: event.itemId, customerId: event.customerId, ...event.payload },
      });
      await appendAudit({
        tenantId: event.tenantId,
        userId: 'followup_worker',
        action: `followup.${event.type}`,
        targetType: event.itemId ? 'followup_batch_item' : 'followup_batch',
        targetId: event.itemId || event.batchId,
        metadata: { runId: event.runId, taskId: event.taskId, batchId: event.batchId, ...event.payload },
      });
    });
  }

  return { registerFollowupWorkerEvents, streamClients, sendEvent, appendEvent, appendAuthorizationRequiredEvent };
}
