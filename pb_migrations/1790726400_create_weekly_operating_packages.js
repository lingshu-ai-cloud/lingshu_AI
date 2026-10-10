/// <reference path="../pb_data/types.d.ts" />

// Immutable versions of the authoritative weekly operating package. The
// content-production/publication subpackage is persisted inside payload so a
// consumer can never combine parent and child versions accidentally.
migrate((app) => {
  const collection = new Collection({
    name: "social_weekly_operating_packages",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
      },
      { name: "tenant_id", type: "text", required: true },
      { name: "program_id", type: "text", required: true },
      { name: "package_id", type: "text", required: true },
      { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "week_start", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "payload", type: "json", required: true, maxSize: 4194304 },
      { name: "created_by", type: "text", required: true },
      { name: "created_at", type: "text", required: true },
      { name: "updated_by", type: "text" },
      { name: "updated_at", type: "text", required: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_weekly_operating_package_version ON social_weekly_operating_packages (tenant_id, package_id, version)",
      "CREATE UNIQUE INDEX idx_weekly_operating_package_active ON social_weekly_operating_packages (tenant_id, program_id, week_start) WHERE status = 'active'",
      "CREATE INDEX idx_weekly_operating_package_program ON social_weekly_operating_packages (tenant_id, program_id, week_start, version)"
    ]
  })
  return app.save(collection)
}, (app) => {
  return app.delete(app.findCollectionByNameOrId("social_weekly_operating_packages"))
})
