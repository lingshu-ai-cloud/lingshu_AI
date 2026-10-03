/// <reference path="../pb_data/types.d.ts" />

// Older local databases may have this collection from manual setup, while a
// fresh versioned install does not. The next migration adds its updated field.
migrate((app) => {
  try {
    app.findCollectionByNameOrId("publishing_schedules");
    return;
  } catch {}

  return app.save(new Collection({
    name: "publishing_schedules", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "id", type: "text", system: true, required: true, primaryKey: true,
        autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" },
      { name: "tenant_id", type: "text", required: true },
      { name: "platform", type: "text", required: true },
      { name: "market", type: "text" },
      { name: "time_zone", type: "text" },
      { name: "utc_offset", type: "number" },
      { name: "preset", type: "text" },
      { name: "slots", type: "json", maxSize: 262144 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_publishing_schedule_tenant_platform ON publishing_schedules (tenant_id, platform)",
    ],
  }));
}, (_app) => {
  // Preserve a manually provisioned collection and its tenant rows on rollback.
});
