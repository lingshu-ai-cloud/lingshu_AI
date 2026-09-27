/// <reference path="../pb_data/types.d.ts" />
// Schema artifact; production application requires explicit deployment authorization. Tests do not apply migrations.
migrate((app) => {
  try { app.findCollectionByNameOrId('platform_ad_creatives'); return; } catch {}
  app.save(new Collection({
    name: 'platform_ad_creatives', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
      ...['tenant_id', 'taskId', 'sourceTaskId', 'artifactId', 'fileRef', 'sha256', 'mimeType', 'name', 'connectionId', 'provider', 'platformVideoId', 'status', 'createdAt', 'updatedAt', 'attemptId', 'uploadError', 'uploadStartedAt'].map(name => ({ name, type: 'text' })),
      ...['size', 'taskVersion'].map(name => ({ name, type: 'number' })),
      { name: 'uploadReceipt', type: 'json' },
    ],
    indexes: [],
  }));
}, (app) => { app.delete(app.findCollectionByNameOrId('platform_ad_creatives')); });
