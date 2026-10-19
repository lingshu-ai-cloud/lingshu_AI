/// <reference path="../pb_data/types.d.ts" />
// Admin-only originals for independently signed exact-analysis authority and provider audit evidence.
migrate(app => {
  const make = (name, fields, indexes = []) => app.save(new Collection({
    name, type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name: 'id', type: 'text', system: true, required: true, primaryKey: true,
        autogeneratePattern: '[a-z0-9]{15}', min: 1, max: 64, pattern: '^[A-Za-z0-9_-]+$'},
      ...fields.map(name => ({name, type: 'text', required: true})),
      {name: 'payload', type: 'json', required: true, maxSize: 1048576},
    ], indexes,
  }));
  make('social_weekly_candidate_exact_authorities', ['tenant_id','program_id','package_id','package_version','job_id','run_id','record_hash'], [
    'CREATE UNIQUE INDEX idx_weekly_exact_authority_scope ON social_weekly_candidate_exact_authorities (tenant_id,program_id,package_id,package_version,job_id,run_id)',
  ]);
  make('social_weekly_candidate_exact_trusted_issuers', ['tenant_id','status','record_hash'], [
    'CREATE UNIQUE INDEX idx_weekly_exact_issuer_identity ON social_weekly_candidate_exact_trusted_issuers (tenant_id,id)',
  ]);
  make('social_weekly_candidate_exact_audit_records', ['tenant_id','request_id','record_hash'], [
    'CREATE UNIQUE INDEX idx_weekly_exact_audit_request ON social_weekly_candidate_exact_audit_records (tenant_id,request_id)',
  ]);
  make('social_weekly_candidate_exact_revocations', ['tenant_id','authorization_id','record_hash'], [
    'CREATE UNIQUE INDEX idx_weekly_exact_revocation_authorization ON social_weekly_candidate_exact_revocations (tenant_id,authorization_id)',
  ]);
}, app => {
  for (const name of ['social_weekly_candidate_exact_revocations','social_weekly_candidate_exact_audit_records','social_weekly_candidate_exact_trusted_issuers','social_weekly_candidate_exact_authorities'])
    app.delete(app.findCollectionByNameOrId(name));
});
