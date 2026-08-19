/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  let collection
  try {
    collection = app.findCollectionByNameOrId("style_memory")
  } catch {
    return
  }

  try {
    collection.fields.getByName("strategy_ids")
    return
  } catch {
    // The field is genuinely missing, so this migration still has work to do.
  }

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "json3540800594",
    "maxSize": 0,
    "name": "strategy_ids",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  let collection
  try {
    collection = app.findCollectionByNameOrId("style_memory")
  } catch {
    return
  }

  let field
  try {
    field = collection.fields.getByName("strategy_ids")
  } catch {
    return
  }

  // remove field
  collection.fields.removeById(field.id)

  return app.save(collection)
})
