/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = new Collection({
    name: "agent_notifications", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "notification_id", type: "text", required: true },
      { name: "tenant_id", type: "text", required: true },
      { name: "event_key", type: "text", required: true },
      { name: "type", type: "text", required: true },
      { name: "severity", type: "text", required: true },
      { name: "title", type: "text", required: true },
      { name: "summary", type: "text", required: true },
      { name: "source_agent", type: "text", required: true },
      { name: "entity_type", type: "text" },
      { name: "entity_id", type: "text" },
      { name: "changes", type: "json", maxSize: 1048576 },
      { name: "action", type: "json", maxSize: 65536 },
      { name: "read_by", type: "json", maxSize: 1048576 },
      { name: "created_at", type: "text", required: true },
      { name: "updated_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_agent_notification_event ON agent_notifications (tenant_id, event_key)",
      "CREATE INDEX idx_agent_notification_feed ON agent_notifications (tenant_id, created_at)",
      "CREATE UNIQUE INDEX idx_agent_notification_public_id ON agent_notifications (notification_id)"
    ]
  })
  return app.save(collection)
}, (app) => app.delete(app.findCollectionByNameOrId("agent_notifications")))

