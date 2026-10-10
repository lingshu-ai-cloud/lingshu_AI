/// <reference path="../pb_data/types.d.ts" />
// Extend existing threads with explicit user ownership. Legacy unowned history is never auto-assigned.
migrate((app) => {
  const threads = app.findCollectionByNameOrId('assistant_threads');
  threads.fields.add(new TextField({ name: 'userId' }));
  threads.fields.add(new TextField({ name: 'source', max: 40 }));
  threads.fields.add(new TextField({ name: 'title', max: 100 }));
  threads.fields.add(new TextField({ name: 'createdAt' }));
  threads.indexes.push('CREATE INDEX idx_assistant_thread_owner ON assistant_threads (tenantId, userId, source, createdAt)');
  app.save(threads);
  app.save(new Collection({ name: 'mobile_assistant_messages', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'id', type: 'text', system: true, primaryKey: true, required: true, min: 24, max: 24, pattern: '^[a-f0-9]{24}$' },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'session_id', type: 'text', required: true, max: 15 },
      { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['user', 'assistant'] },
      { name: 'text', type: 'text', required: true, max: 12000 },
      { name: 'command_id', type: 'text', max: 128 },
      { name: 'client_message_id', type: 'text', required: true, max: 128 },
      { name: 'request_hash', type: 'text', required: true, min: 64, max: 64 },
    ], indexes: [
      'CREATE UNIQUE INDEX idx_mobile_assistant_message_retry ON mobile_assistant_messages (tenant_id, user_id, session_id, client_message_id)',
      'CREATE INDEX idx_mobile_assistant_message_history ON mobile_assistant_messages (tenant_id, user_id, session_id, created_at)',
    ],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId('mobile_assistant_messages'));
  const threads = app.findCollectionByNameOrId('assistant_threads');
  for (const field of ['userId', 'source', 'title', 'createdAt']) threads.fields.removeByName(field);
  threads.indexes = threads.indexes.filter(index => !index.includes('idx_assistant_thread_owner'));
  app.save(threads);
});
