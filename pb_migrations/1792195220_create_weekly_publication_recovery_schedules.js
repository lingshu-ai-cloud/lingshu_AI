/// <reference path="../pb_data/types.d.ts" />

migrate(app => app.save(new Collection({
  name: 'social_weekly_publication_recovery_schedules',
  type: 'base',
  system: false,
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
  fields: [
    { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
    ...['tenant_id', 'program_id', 'package_id', 'publication_task_id', 'content_hash'].map(name => ({ name, type: 'text', required: true })),
    { name: 'package_version', type: 'number', required: true, onlyInt: true, min: 1 },
    { name: 'revision', type: 'number', required: true, onlyInt: true, min: 1 },
    { name: 'payload', type: 'json', required: true, maxSize: 1048576 },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_weekly_publication_recovery_schedule_revision ON social_weekly_publication_recovery_schedules (tenant_id, program_id, package_id, package_version, publication_task_id, revision)',
    'CREATE INDEX idx_weekly_publication_recovery_schedule_latest ON social_weekly_publication_recovery_schedules (tenant_id, program_id, package_id, package_version, publication_task_id)',
  ],
})), app => app.delete(app.findCollectionByNameOrId('social_weekly_publication_recovery_schedules')));
