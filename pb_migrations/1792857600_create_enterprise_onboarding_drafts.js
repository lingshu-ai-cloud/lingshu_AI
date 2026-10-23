/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = (name, required = true) => ({ name, type: 'text', required });
  const collection = new Collection({
    name: 'enterprise_onboarding_drafts',
    type: 'base',
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: 'id', type: 'text', system: true, required: true, primaryKey: true,
        autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$',
      },
      text('tenant_id'), text('user_id'), text('schema_version'),
      { name: 'revision', type: 'number', required: true, onlyInt: true, min: 1 },
      { name: 'current_step', type: 'number', required: true, onlyInt: true, min: 1, max: 4 },
      text('base_fact_version'), text('confirmation_id'), text('confirmation_state', false), text('claim_token', false),
      { name: 'payload', type: 'json', required: true, maxSize: 8 * 1024 * 1024 },
      text('updated_at'), text('updated_by'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_enterprise_onboarding_draft_owner ON enterprise_onboarding_drafts (tenant_id, user_id)',
    ],
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId('enterprise_onboarding_drafts')));
