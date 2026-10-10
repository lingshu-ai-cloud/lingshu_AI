/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    name: 'assistant_decision_memories', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'id', type: 'text', system: true, required: true, primaryKey: true, autogeneratePattern: '[a-z0-9]{15}', min: 15, max: 15, pattern: '^[a-z0-9]+$' },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'memory_id', type: 'text', required: true },
      { name: 'version', type: 'number', required: true, min: 1, onlyInt: true },
      { name: 'content', type: 'text', required: true, max: 2000 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['confirmed', 'revoked'] },
      { name: 'source_message_id', type: 'text', required: true },
      { name: 'confirmed_at', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'expires_at', type: 'text', required: false },
      { name: 'schema_version', type: 'text', required: true }
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_assistant_decision_revision ON assistant_decision_memories (tenant_id, user_id, memory_id, version)',
      'CREATE INDEX idx_assistant_decision_recent ON assistant_decision_memories (tenant_id, user_id, created_at)'
    ]
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId('assistant_decision_memories')));
