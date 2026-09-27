/// <reference path="../pb_data/types.d.ts" />

// Earlier installations may already have this collection from setup-pb.ts.
// Preserve those records and make fresh migration-only installations usable.
migrate((app) => {
  try {
    app.findCollectionByNameOrId("studio_production_defaults")
    return
  } catch (_) {
    // Create only when absent.
  }

  return app.save(new Collection({
    name: "studio_production_defaults", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true, max: 0 },
      { name: "payload", type: "json", required: false, maxSize: 2000000 }
    ],
    indexes: []
  }))
}, (_app) => {
  // Keep this additive migration reversible without deleting an existing
  // setup-pb.ts collection or its user data during a rollback drill.
})
