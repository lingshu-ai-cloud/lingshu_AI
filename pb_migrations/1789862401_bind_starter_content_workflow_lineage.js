/// <reference path="../pb_data/types.d.ts" />

// Adds an indexed projection of the immutable workflow lineage already stored
// in managed studio project specs. Historical rows are deliberately not
// backfilled: only a trusted production write may attest and bind them.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("studio_projects");
  const addField = (id, name) => {
    try { if (collection.fields.getByName(name)) return; } catch {}
    collection.fields.addAt(collection.fields.length, new Field({
      id, name, type: "text", required: false
    }));
  };
  const addIndex = (index) => {
    const name = index.match(/INDEX\s+(\S+)/i)?.[1] || "";
    if (!collection.indexes.some(current => current.includes(name))) {
      collection.indexes = [...collection.indexes, index];
    }
  };

  addField("text_sp_workflow_run_id", "workflow_run_id");
  addField("text_sp_workflow_task_id", "workflow_task_id");
  addField("text_sp_workflow_task_key", "workflow_task_key");
  addField("text_sp_workflow_lineage_hash", "workflow_lineage_hash");
  addIndex("CREATE INDEX idx_studio_project_workflow_status ON studio_projects (tenant_id, workflow_run_id, workflow_task_id, status)");
  addIndex("CREATE INDEX idx_studio_project_workflow_lineage ON studio_projects (tenant_id, workflow_lineage_hash, status)");
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("studio_projects");
  collection.indexes = collection.indexes.filter(index => ![
    "idx_studio_project_workflow_status",
    "idx_studio_project_workflow_lineage"
  ].some(name => index.includes(name)));
  for (const name of [
    "workflow_run_id", "workflow_task_id", "workflow_task_key", "workflow_lineage_hash"
  ]) {
    try { collection.fields.removeById(collection.fields.getByName(name).id); } catch {}
  }
  return app.save(collection);
});
