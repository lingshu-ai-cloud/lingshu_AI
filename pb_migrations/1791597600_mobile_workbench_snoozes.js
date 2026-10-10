/// <reference path="../pb_data/types.d.ts" />
// Per-account mobile queue preferences; workflow status remains authoritative in workflow tables.
migrate((app) => {
  app.save(new Collection({
    name: 'mobile_workbench_snoozes', type: 'base',
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'id', type: 'text', system: true, primaryKey: true, required: true, min: 15, max: 15, pattern: '^[a-z0-9]+$', autogeneratePattern: '[a-z0-9]{15}' },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'matter_id', type: 'text', required: true },
      { name: 'until', type: 'number', min: 0, onlyInt: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_mobile_workbench_snooze_scope ON mobile_workbench_snoozes (tenant_id, user_id, matter_id)'],
  }));
}, (app) => app.delete(app.findCollectionByNameOrId('mobile_workbench_snoozes')));
