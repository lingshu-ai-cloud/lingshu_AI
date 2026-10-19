/// <reference path="../pb_data/types.d.ts" />

migrate(app => app.save(new Collection({
  name: 'weekly_production_runtime_probes', type: 'base', system: false,
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields: [
    { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
    ...['probe_id', 'status', 'challenge_hash', 'web_build_sha', 'worker_build_sha', 'enqueued_at', 'claimed_at', 'completed_at']
      .map(name => ({ name, type: 'text', required: name !== 'worker_build_sha' && name !== 'claimed_at' && name !== 'completed_at', max: 0 })),
    { name: 'checkpoint', type: 'json', required: false, maxSize: 16384 },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_weekly_production_runtime_probe_id ON weekly_production_runtime_probes (probe_id)',
    'CREATE INDEX idx_weekly_production_runtime_probe_queue ON weekly_production_runtime_probes (status, enqueued_at)',
  ],
})), app => app.delete(app.findCollectionByNameOrId('weekly_production_runtime_probes')));
