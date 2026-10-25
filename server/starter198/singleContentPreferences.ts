import path from 'node:path';
import type { DataStore } from '../storage/datastore.js';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import { contentPreferencesSchema, DEFAULT_CONTENT_PREFERENCES, type ContentPreferences } from '../../shared/contracts/singleContentCreation.js';
import { EMPTY_DEFAULTS } from '../../src/lib/shotProduction.js';
import { socialJson, socialObject, socialRequestHash, SocialContentWorkflowError } from './socialContentValidation.js';

/** Shares the existing enterprise production-default aggregate and its lock. */
export async function readContentPreferences(store: DataStore, tenantId: string) {
  const rows = await store.list<Record<string, unknown> & { id: string }>('studio_production_defaults', {
    where: { tenant_id: tenantId }, perPage: 2,
  });
  if (rows.totalItems > 1 || rows.items.some(row => row.tenant_id !== tenantId)) {
    throw new SocialContentWorkflowError('content_preferences_scope_invalid', 503);
  }
  const row = rows.items[0];
  const payload = socialObject(socialJson(row?.payload)) || {};
  const parsed = contentPreferencesSchema.safeParse(payload.contentTaskPreferences);
  if (payload.contentTaskPreferences !== undefined && !parsed.success) {
    throw new SocialContentWorkflowError('content_preferences_corrupt', 503);
  }
  const preferences = parsed.success ? parsed.data : { ...DEFAULT_CONTENT_PREFERENCES };
  return { row, payload, preferences, saved: payload.contentTaskPreferences !== undefined,
    version: socialRequestHash({ preferences, defaultPresenterId: payload.defaultPresenterId || '', saved: payload.contentTaskPreferences !== undefined }) };
}

export async function saveContentPreferences(store: DataStore, tenantId: string, input: {
  preferences: ContentPreferences; expectedVersion: string; defaultPresenterId?: string;
}) {
  const preferences = contentPreferencesSchema.parse(input.preferences);
  return withPaidOperationLock(path.resolve(process.cwd(), 'data/studio-production-locks'), `defaults:${tenantId}`, async () => {
    const current = await readContentPreferences(store, tenantId);
    if (current.version !== input.expectedVersion) throw new SocialContentWorkflowError('content_preferences_changed', 409);
    if (input.defaultPresenterId && input.defaultPresenterId !== current.payload.defaultPresenterId && !(Array.isArray(current.payload.presenters) && current.payload.presenters.some((row: { id?: string; authorized?: boolean }) => row.id === input.defaultPresenterId && row.authorized))) throw new SocialContentWorkflowError('content_default_presenter_invalid', 422);
    const payload = { ...EMPTY_DEFAULTS, ...current.payload, contentTaskPreferences: preferences, ...(input.defaultPresenterId !== undefined ? { defaultPresenterId: input.defaultPresenterId } : {}) };
    const saved = current.row
      ? await store.update('studio_production_defaults', current.row.id, { payload })
      : await store.create('studio_production_defaults', { tenant_id: tenantId, payload });
    if (!saved) throw new SocialContentWorkflowError('content_preferences_save_failed', 503);
    return readContentPreferences(store, tenantId);
  });
}
