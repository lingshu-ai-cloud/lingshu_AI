/// <reference path="../pb_data/types.d.ts" />

// PocketBase ignores unknown fields even on a successful PATCH. These existing
// application projections must survive the strict write/read verification.
// Additive only: do not invent reference evidence or backfill business orders.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks");
  for (const name of ["reference_video_analysis", "replication_script", "shot_material_map", "content_order"]) {
    if (!collection.fields.getByName(name)) {
      collection.fields.add(new JSONField({name, required: false, maxSize: 2097152}));
    }
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks");
  for (const name of ["reference_video_analysis", "replication_script", "shot_material_map", "content_order"]) {
    const field = collection.fields.getByName(name);
    if (field) collection.fields.removeById(field.id);
  }
  return app.save(collection);
});
