/// <reference path="../pb_data/types.d.ts" />
// Schema artifact only; do not apply to production without deployment authorization.
migrate((app) => {
  const specs = [
    { name: 'platform_ad_worker_health', fields: 'tenant_id workerId state lastStartedAt lastCompletedAt lastFailedAt nextCheckAt updatedAt'.split(' ').map(name => ({ name, type: 'text' })) },
    { name: 'platform_ad_metric_snapshots', fields: [...'tenant_id provider accountId campaignId date currency metricDefinition metricLabel reportedAt reportTimezone updatedAt'.split(' ').map(name => ({ name, type: 'text' })), { name: 'values', type: 'json' }, { name: 'taskIds', type: 'json' }] },
    { name: 'platform_ad_automation_runs', fields: [{ name: 'decision', type: 'json' }] },
  ];
  for (const spec of specs) {
    let collection;
    try { collection = app.findCollectionByNameOrId(spec.name); } catch {}
    if (!collection) {
      collection = new Collection({ name: spec.name, type: 'base', system: false, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [{ name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' }, ...spec.fields], indexes: [] });
    } else {
      for (const field of spec.fields) {
        let previous; try { previous = collection.fields.getByName(field.name); } catch {}
        if (previous?.type === field.type) continue;
        collection.fields.addAt(collection.fields.length, new Field({ ...field, ...(previous?.id ? { id: previous.id } : {}) }));
      }
    }
    app.save(collection);
  }
}, (app) => {
  for (const name of ['platform_ad_metric_snapshots', 'platform_ad_worker_health']) app.delete(app.findCollectionByNameOrId(name));
  const runs = app.findCollectionByNameOrId('platform_ad_automation_runs');
  const field = runs.fields.getByName('decision');
  runs.fields.removeById(field.id);
  app.save(runs);
});
