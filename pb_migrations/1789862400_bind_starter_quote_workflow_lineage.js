/// <reference path="../pb_data/types.d.ts" />

// Adds indexed workflow lineage to new starter quote records. Existing rows
// remain intentionally unbound: there is no trustworthy way to infer which
// historical run owned them, and adapters must keep such rows in waiting.
migrate((app) => {
  const text = (name) => ({ name, type: "text", required: false });
  const addField = (collection, definition) => {
    try { if (collection.fields.getByName(definition.name)) return; } catch {}
    collection.fields.addAt(collection.fields.length, new Field(definition));
  };
  const addIndex = (collection, index) => {
    const name = index.match(/INDEX\s+(\S+)/i)?.[1] || "";
    if (!collection.indexes.some(current => current.includes(name))) {
      collection.indexes = [...collection.indexes, index];
    }
  };

  const inquiries = app.findCollectionByNameOrId("starter_quote_inquiries");
  for (const [id, name] of [
    ["text_sqi_schema_version", "schema_version"],
    ["text_sqi_run_id", "run_id"],
    ["text_sqi_cycle_id", "cycle_id"],
    ["text_sqi_workflow_task_id", "workflow_task_id"],
    ["text_sqi_initialization_id", "initialization_id"],
    ["text_sqi_entitlement_snapshot", "entitlement_snapshot_id"],
    ["text_sqi_lineage_hash", "lineage_hash"],
  ]) addField(inquiries, { id, ...text(name) });
  addIndex(inquiries,
    "CREATE INDEX idx_starter_quote_inquiry_workflow ON starter_quote_inquiries (tenant_id, run_id, cycle_id, workflow_task_id, status)");
  addIndex(inquiries,
    "CREATE UNIQUE INDEX idx_starter_quote_inquiry_lineage ON starter_quote_inquiries (tenant_id, lineage_hash) WHERE lineage_hash != ''");
  app.save(inquiries);

  const drafts = app.findCollectionByNameOrId("quote_drafts");
  for (const [id, name] of [
    ["text_qd_schema_version", "schema_version"],
    ["text_qd_run_id", "run_id"],
    ["text_qd_cycle_id", "cycle_id"],
    ["text_qd_workflow_task_id", "workflow_task_id"],
    ["text_qd_inquiry_task_id", "inquiry_task_id"],
    ["text_qd_initialization_id", "initialization_id"],
    ["text_qd_entitlement_snapshot", "entitlement_snapshot_id"],
    ["text_qd_inquiry_record_id", "inquiry_record_id"],
    ["text_qd_inquiry_request_hash", "inquiry_request_hash"],
    ["text_qd_inquiry_lineage_hash", "inquiry_lineage_hash"],
    ["text_qd_lineage_hash", "lineage_hash"],
  ]) addField(drafts, { id, ...text(name) });
  addIndex(drafts,
    "CREATE INDEX idx_starter_quote_draft_workflow ON quote_drafts (tenant_id, run_id, cycle_id, workflow_task_id, status)");
  addIndex(drafts,
    "CREATE INDEX idx_starter_quote_draft_workflow_inquiry ON quote_drafts (tenant_id, run_id, cycle_id, workflow_task_id, inquiry_id, inquiry_version, status)");
  addIndex(drafts,
    "CREATE UNIQUE INDEX idx_starter_quote_draft_lineage ON quote_drafts (tenant_id, lineage_hash) WHERE lineage_hash != ''");
  return app.save(drafts);
}, (app) => {
  const remove = (collectionName, fields, indexNames) => {
    let collection = null;
    try { collection = app.findCollectionByNameOrId(collectionName); } catch { return; }
    collection.indexes = collection.indexes.filter(index => !indexNames.some(name => index.includes(name)));
    for (const name of fields) {
      try { collection.fields.removeById(collection.fields.getByName(name).id); } catch {}
    }
    app.save(collection);
  };
  remove("quote_drafts", [
    "schema_version", "run_id", "cycle_id", "workflow_task_id", "inquiry_task_id",
    "initialization_id", "entitlement_snapshot_id", "inquiry_record_id",
    "inquiry_request_hash", "inquiry_lineage_hash", "lineage_hash"
  ], ["idx_starter_quote_draft_workflow", "idx_starter_quote_draft_lineage"]);
  remove("starter_quote_inquiries", [
    "schema_version", "run_id", "cycle_id", "workflow_task_id", "initialization_id",
    "entitlement_snapshot_id", "lineage_hash"
  ], ["idx_starter_quote_inquiry_workflow", "idx_starter_quote_inquiry_lineage"]);
});
