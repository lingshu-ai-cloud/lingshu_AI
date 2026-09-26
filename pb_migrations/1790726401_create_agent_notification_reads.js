/// <reference path="../pb_data/types.d.ts" />

// Per-user read receipts are separate durable objects. The legacy read_by
// field remains on notifications for forward-migration compatibility but is
// no longer written by the application.
migrate((app) => {
  const collection = new Collection({
    name: "agent_notification_reads", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "read_id", type: "text", required: true },
      { name: "tenant_id", type: "text", required: true },
      { name: "notification_id", type: "text", required: true },
      { name: "user_id", type: "text", required: true },
      { name: "read_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_agent_notification_read ON agent_notification_reads (tenant_id, notification_id, user_id)",
      "CREATE INDEX idx_agent_notification_user_reads ON agent_notification_reads (tenant_id, user_id, read_at)",
      "CREATE UNIQUE INDEX idx_agent_notification_read_public_id ON agent_notification_reads (read_id)"
    ]
  })
  return app.save(collection)
}, (app) => app.delete(app.findCollectionByNameOrId("agent_notification_reads")))
