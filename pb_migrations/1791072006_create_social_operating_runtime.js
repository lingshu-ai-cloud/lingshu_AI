/// <reference path="../pb_data/types.d.ts" />

// Runtime-only worker evidence. Business objects remain in their versioned
// collections; this table exists so a web replica can prove that at least one
// worker has recently completed startup instead of guessing from configuration.
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  })
  const text = (name, required = false) => ({ name, type: "text", required, max: 0 })
  const json = (name, required = false) => ({ name, type: "json", required, maxSize: 262144 })
  return app.save(new Collection({
    name: "social_operating_worker_heartbeats", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      id(), text("instance_id", true), text("role", true), text("state", true),
      text("started_at", true), text("last_seen_at", true), json("details")
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_operating_worker_instance ON social_operating_worker_heartbeats (instance_id)",
      "CREATE INDEX idx_social_operating_worker_latest ON social_operating_worker_heartbeats (state, last_seen_at)"
    ]
  }))
}, (app) => app.delete(app.findCollectionByNameOrId("social_operating_worker_heartbeats")))
