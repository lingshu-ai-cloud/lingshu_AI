/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = name => ({ name, type: 'text', required: true });
  const common = () => [
    { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
    ...['tenant_id', 'program_id', 'package_id', 'publication_id', 'binding_hash'].map(text),
    { name: 'package_version', type: 'number', required: true, onlyInt: true, min: 1 },
    { name: 'payload', type: 'json', required: true, maxSize: 1048576 },
  ];
  app.save(new Collection({ name: 'social_weekly_reception_bindings', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [...common(), text('bound_by'), text('bound_at')],
    indexes: ['CREATE UNIQUE INDEX idx_weekly_reception_hash ON social_weekly_reception_bindings (binding_hash)', 'CREATE INDEX idx_weekly_reception_scope ON social_weekly_reception_bindings (tenant_id, program_id, package_id, package_version, publication_id)'],
  }));
  app.save(new Collection({ name: 'social_weekly_reception_checks', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [...common(), text('binding_id'), text('checked_at'), text('status')],
    indexes: ['CREATE INDEX idx_weekly_reception_checks ON social_weekly_reception_checks (tenant_id, binding_id, checked_at)'],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId('social_weekly_reception_checks'));
  app.delete(app.findCollectionByNameOrId('social_weekly_reception_bindings'));
});
