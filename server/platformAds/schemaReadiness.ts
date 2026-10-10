/**
 * Read-only PocketBase schema preflight. No environment loading, credentials,
 * store fallback, migrations, records, or network access at import time.
 * Integration: await auditAdSchema((path, init) => adminFetch(path, init));
 * The caller must separately authorize the exact target. Do not call an ensure
 * function from a readiness check. `ready` says nothing about provider access.
 */
type Field = { name: string; type: string; values?: readonly string[] };
const fields = (type: string, names: string): Field[] => names.split(' ').map(name => ({ name, type }));
export const AD_SCHEMA_REQUIREMENTS: Readonly<Record<string, readonly Field[]>> = {
  platform_ad_tasks: [
    ...fields('text', 'tenant_id created_by name video goal market createdAt updatedAt creationSource managementMode'),
    ...fields('number', 'version budget'),
    ...fields('json', 'authorization proposal sourceContext managementHistory configuration channels'),
    { name: 'currency', type: 'select', values: ['USD', 'CNY'] },
    { name: 'status', type: 'select', values: ['draft', 'paused', 'active', 'error', 'unknown'] },
    ...fields('autodate', 'created updated'),
  ],
  platform_ad_connections: fields('text', 'tenant_id provider accountId name currency tokenCipher status updatedAt'),
  platform_ad_launches: [
    ...fields('text', 'tenant_id taskId connectionId status createdAt updatedAt error'),
    ...fields('number', 'taskVersion'), ...fields('json', 'meta receipt'),
    { name: 'launchMode', type: 'select', values: ['create_paused', 'create_and_activate'] },
  ],
  platform_ad_approvals: [...fields('text', 'tenant_id taskId status createdBy decidedBy createdAt expiresAt updatedAt error'), ...fields('number', 'taskVersion'), ...fields('json', 'payload receipt')],
  platform_ad_executions: [...fields('text', 'tenant_id taskId requestId action connectionId resourceId status createdAt error'), ...fields('number', 'expectedDailyBudget'), ...fields('json', 'result')],
  platform_ad_oauth_states: [...fields('text', 'tenant_id userId stateHash expiresAt status tokenCipher'), ...fields('json', 'accounts')],
  platform_ad_automation_rules: [...fields('text', 'tenant_id taskId connectionId resourceId updatedAt'), ...fields('number', 'targetCpc minClicks cooldownMinutes maxMetricAgeMinutes'), ...fields('bool', 'enabled')],
  platform_ad_automation_runs: [...fields('text', 'tenant_id taskId ruleId status reason createdAt'), ...fields('json', 'metrics receipt decision')],
  platform_ad_handoffs: [...fields('text', 'tenant_id goalId adTaskId objective evidence expectedOutcome createdAt createdBy'), ...fields('json', 'constraints')],
  platform_ad_worker_health: [...fields('text', 'tenant_id workerId state lastStartedAt lastCompletedAt lastFailedAt nextCheckAt updatedAt')],
  platform_ad_metric_snapshots: [...fields('text', 'tenant_id provider accountId campaignId date currency metricDefinition metricLabel reportedAt reportTimezone updatedAt'), ...fields('json', 'values taskIds')],
  platform_ad_creatives: [...fields('text', 'tenant_id taskId sourceTaskId artifactId fileRef sha256 mimeType name connectionId provider platformVideoId status createdAt updatedAt attemptId uploadError uploadStartedAt'), ...fields('number', 'size taskVersion'), ...fields('json', 'uploadReceipt')],
  platform_ad_imports: [...fields('text', 'tenant_id provider accountId connectionId campaignId taskId status capability createdAt updatedAt'), ...fields('json', 'providerSnapshot')],
};

export type AdSchemaIssue = {
  collection: string;
  code: 'missing_collection' | 'missing_field' | 'field_type_mismatch' | 'missing_select_values' | 'schema_unreadable' | 'schema_read_failed';
  field?: string;
  expectedType?: string;
  missingValues?: string[];
};
type SchemaField = { name?: unknown; type?: unknown; values?: unknown; options?: { values?: unknown } };
export function inspectAdCollectionSchema(name: string, schema: unknown): AdSchemaIssue[] {
  const expected = AD_SCHEMA_REQUIREMENTS[name];
  if (!expected) throw new Error('Not an advertising collection');
  if (schema === null) return [{ collection: name, code: 'missing_collection' }];
  const document = schema as { fields?: unknown; schema?: unknown } | undefined;
  const actual = document?.fields ?? document?.schema;
  if (!Array.isArray(actual)) return [{ collection: name, code: 'schema_unreadable' }];
  const issues: AdSchemaIssue[] = [];
  for (const field of expected) {
    const current = actual.find((entry: SchemaField | null) => entry?.name === field.name) as SchemaField | undefined;
    if (!current) { issues.push({ collection: name, code: 'missing_field', field: field.name }); continue; }
    if (current.type !== field.type) { issues.push({ collection: name, code: 'field_type_mismatch', field: field.name, expectedType: field.type }); continue; }
    if (field.values) {
      const currentValues = current.values ?? current.options?.values;
      const missingValues = field.values.filter(value => !Array.isArray(currentValues) || !currentValues.includes(value));
      if (missingValues.length) issues.push({ collection: name, code: 'missing_select_values', field: field.name, missingValues });
    }
  }
  return issues;
}

/** Only fixed collection-metadata GETs; no record or provider requests. Error
 * bodies/unknown schema values are never copied into the returned safe report. */
export async function auditAdSchema(read: (path: string, init: { method: 'GET' }) => Promise<Pick<Response, 'status' | 'ok' | 'json'>>) {
  const issues: AdSchemaIssue[] = [];
  for (const collection of Object.keys(AD_SCHEMA_REQUIREMENTS)) {
    try {
      const response = await read(`/api/collections/${collection}`, { method: 'GET' });
      if (response.status === 404) { issues.push({ collection, code: 'missing_collection' }); continue; }
      if (!response.ok) { issues.push({ collection, code: 'schema_read_failed' }); continue; }
      issues.push(...inspectAdCollectionSchema(collection, await response.json()));
    } catch { issues.push({ collection, code: 'schema_read_failed' }); }
  }
  return { ready: issues.length === 0, checkedCollections: Object.keys(AD_SCHEMA_REQUIREMENTS), issues, scope: 'advertising_schema_only' as const, mutated: false as const };
}
