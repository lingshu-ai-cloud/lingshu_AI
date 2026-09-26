/// <reference path="../pb_data/types.d.ts" />

// Immutable, tenant-scoped inputs and outputs for the formal social operating
// orchestration entry point. Runtime code never repairs these collections.
migrate((app) => {
  const id = () => ({ name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" })
  const text = (name, required = false) => ({ name, type: "text", required, max: 0 })
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true })
  const json = (name, required = false) => ({ name, type: "json", required, maxSize: 8388608 })
  const immutable = (name, fields, indexes) => new Collection({
    name, type: "base", system: false, listRule: null, viewRule: null, createRule: null,
    updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  })

  app.save(immutable("social_operating_constraints", [
    text("tenant_id", true), text("program_id", true), text("constraints_id", true), number("version", true),
    json("payload", true), text("created_by", true), text("created_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_operating_constraints_version ON social_operating_constraints (tenant_id, program_id, constraints_id, version)",
    "CREATE INDEX idx_social_operating_constraints_latest ON social_operating_constraints (tenant_id, program_id, version)"
  ]))
  return app.save(immutable("social_operating_authority_snapshots", [
    text("tenant_id", true), text("program_id", true), text("snapshot_id", true), number("version", true),
    text("status", true), text("input_fingerprint", true), json("payload", true), text("created_by", true), text("created_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_operating_snapshot_version ON social_operating_authority_snapshots (tenant_id, program_id, snapshot_id, version)",
    "CREATE INDEX idx_social_operating_snapshot_latest ON social_operating_authority_snapshots (tenant_id, program_id, version)"
  ]))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_operating_authority_snapshots"))
  return app.delete(app.findCollectionByNameOrId("social_operating_constraints"))
})
