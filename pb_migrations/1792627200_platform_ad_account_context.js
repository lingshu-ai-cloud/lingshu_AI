/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("platform_ad_connections");
  const definitions = [
    { name: "businessName", type: "text" },
    { name: "accountStatus", type: "number" },
    { name: "timezoneId", type: "number" },
    { name: "timezoneName", type: "text" },
    { name: "timezoneOffsetHoursUtc", type: "number" },
    { name: "resourceSyncRunId", type: "text" },
    { name: "resourceSyncedAt", type: "text" },
  ];
  for (const [index, definition] of definitions.entries()) {
    try { collection.fields.getByName(definition.name); }
    catch {
      collection.fields.addAt(collection.fields.length, new Field({
        id: `pad_ctx_${String(index).padStart(2, "0")}`,
        required: false,
        ...definition,
      }));
    }
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("platform_ad_connections");
  for (const name of ["businessName", "accountStatus", "timezoneId", "timezoneName", "timezoneOffsetHoursUtc", "resourceSyncRunId", "resourceSyncedAt"]) {
    try { collection.fields.removeById(collection.fields.getByName(name).id); } catch {}
  }
  return app.save(collection);
});
