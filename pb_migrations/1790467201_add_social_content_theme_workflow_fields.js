/// <reference path="../pb_data/types.d.ts" />

// Persist the theme-first workflow and frozen script/director inputs used by
// social-content tasks. These fields were introduced by the application flow
// after the original task collection migration and must exist before a real
// PocketBase-backed task can be created.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks")
  const fields = [
    { id: "fld179046720101", name: "workflow_version", type: "text" },
    { id: "fld179046720102", name: "task_mode", type: "text" },
    { id: "fld179046720103", name: "weekly_plan_id", type: "text" },
    { id: "fld179046720104", name: "theme_selection", type: "json", maxSize: 262144 },
    { id: "fld179046720105", name: "formula_reference", type: "json", maxSize: 65536 },
    { id: "fld179046720106", name: "script_baseline", type: "json", maxSize: 2097152 },
    { id: "fld179046720107", name: "material_requirements", type: "json", maxSize: 2097152 },
    { id: "fld179046720108", name: "legacy_creation_route", type: "text" },
  ]
  for (const field of fields) {
    if (!collection.fields.getByName(field.name)) {
      collection.fields.addAt(collection.fields.length, new Field({
        ...field,
        required: false,
      }))
    }
  }
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_tasks")
  for (const name of [
    "workflow_version",
    "task_mode",
    "weekly_plan_id",
    "theme_selection",
    "formula_reference",
    "script_baseline",
    "material_requirements",
    "legacy_creation_route",
  ]) {
    const field = collection.fields.getByName(name)
    if (field) collection.fields.removeById(field.id)
  }
  return app.save(collection)
})
