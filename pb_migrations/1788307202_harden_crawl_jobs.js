/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 84c09d4f263f99bd307afc4ff0e6ce1bcf6817002a1892c235dd20f0bc7687c8
migrate((app) => {
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const number = (name, required = false) => ({ name, type: "number", required });
  const fields = [
    text("tenantId", true), text("requestedBy"), text("platform", true), text("mode", true),
    text("keyword"), text("accountUrl"), text("accountName"), number("limit"), text("status", true),
    text("workerId"), number("attempts"), text("resultJson", false, 2000000), text("error", false, 2000000),
    text("createdAt"), text("updatedAt"), text("leasedUntil"), text("finishedAt"), text("leaseToken"), number("revision")
  ];
  const indexes = [
    "CREATE INDEX idx_crawl_jobs_status_created ON crawl_jobs (status, createdAt)",
    "CREATE INDEX idx_crawl_jobs_status_lease ON crawl_jobs (status, leasedUntil, createdAt)",
    "CREATE INDEX idx_crawl_jobs_tenant_created ON crawl_jobs (tenantId, createdAt)"
  ];
  let collection;
  try { collection = app.findCollectionByNameOrId("crawl_jobs"); } catch {}
  if (!collection) {
    app.save(new Collection({
      id: "lscrawljobs0001", name: "crawl_jobs", type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [idField(), ...fields], indexes
    }));
    return;
  }
  for (const definition of fields) {
    if (!collection.fields.getByName(definition.name)) {
      // Existing queues may already contain records, so newly introduced
      // fencing fields remain optional and are interpreted as empty/zero.
      collection.fields.addAt(collection.fields.length, new Field({ ...definition, required: false }));
    }
  }
  collection.indexes = (collection.indexes || [])
    .filter((value) => !value.includes("idx_crawl_jobs_claim")
      && !value.includes("idx_crawl_jobs_status_created")
      && !value.includes("idx_crawl_jobs_status_lease")
      && !value.includes("idx_crawl_jobs_tenant_created"))
    .concat(indexes);
  app.save(collection);
}, (app) => {
  let collection;
  try { collection = app.findCollectionByNameOrId("crawl_jobs"); } catch { return; }
  if (collection.id === "lscrawljobs0001") {
    app.delete(collection);
    return;
  }
  for (const name of ["leaseToken", "revision"]) {
    try { collection.fields.removeById(collection.fields.getByName(name).id); } catch {}
  }
  collection.indexes = (collection.indexes || [])
    .filter((value) => !value.includes("idx_crawl_jobs_claim")
      && !value.includes("idx_crawl_jobs_status_created")
      && !value.includes("idx_crawl_jobs_status_lease")
      && !value.includes("idx_crawl_jobs_tenant_created"));
  app.save(collection);
});
