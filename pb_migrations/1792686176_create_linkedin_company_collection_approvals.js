/// <reference path="../pb_data/types.d.ts" />
// Admin-only approval and revocation records. This migration grants no paid permit.
migrate(app => {
  for (const [name, fields, index] of [
    ['social_linkedin_company_collection_approvals', ['tenant_id', 'run_id', 'company_url', 'record_hash'],
      'CREATE UNIQUE INDEX idx_linkedin_company_collection_run ON social_linkedin_company_collection_approvals (tenant_id, run_id, company_url)'],
    ['social_linkedin_company_collection_revocations', ['tenant_id', 'approval_id', 'record_hash'],
      'CREATE UNIQUE INDEX idx_linkedin_company_collection_revocation ON social_linkedin_company_collection_revocations (tenant_id, approval_id)'],
  ]) app.save(new Collection({ name, type: 'base', listRule: null, viewRule: null,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [{ name: 'id', type: 'text', system: true, required: true, primaryKey: true,
      autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
    ...fields.map(field => ({ name: field, type: 'text', required: true })),
    { name: 'payload', type: 'json', required: true, maxSize: 1048576 }], indexes: [index] }));
}, app => {
  app.delete(app.findCollectionByNameOrId('social_linkedin_company_collection_revocations'));
  app.delete(app.findCollectionByNameOrId('social_linkedin_company_collection_approvals'));
});
