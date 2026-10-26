import type { DataStore } from '../storage/datastore.js';
/** Persistence shared with the Studio save route; callers perform their own admission and never promote an unreviewed draft. */
export async function insertStudioProjectRecord(data: DataStore, record: {
  id?: string; tenant_id: string; title: string; status: string; spec: Record<string, unknown>; thumb_seed: string; created_at: string; updated_at: string;
}) {
  return data.create('studio_projects', record);
}
