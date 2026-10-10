/// <reference path="../pb_data/types.d.ts" />
// Forward-only stage intent. It never changes prior jobs or their provider receipts.
migrate(app => {
  const collection = app.findCollectionByNameOrId('content_execution_jobs');
  if (!collection.fields.getByName('checkpoint')) {
    collection.fields.add(new Field({name: 'checkpoint', type: 'json', required: false, maxSize: 2097152}));
    app.save(collection);
  }
}, () => { throw new Error('weekly production stage checkpoints are durable execution evidence; rollback requires an explicitly reviewed forward migration'); });
