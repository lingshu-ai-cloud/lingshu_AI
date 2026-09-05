/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_tenant_platform_apps")

  // add field
  collection.fields.addAt(21, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text3343851925",
    "max": 0,
    "min": 0,
    "name": "refresh_token",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1040942922",
    "max": 0,
    "min": 0,
    "name": "last_checked_at",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(23, new Field({
    "help": "",
    "hidden": false,
    "id": "json1138897116",
    "maxSize": 0,
    "name": "test_results",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(24, new Field({
    "help": "",
    "hidden": false,
    "id": "json403448253",
    "maxSize": 0,
    "name": "delivery_checklist",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_tenant_platform_apps")

  // remove field
  collection.fields.removeById("text3343851925")

  // remove field
  collection.fields.removeById("text1040942922")

  // remove field
  collection.fields.removeById("json1138897116")

  // remove field
  collection.fields.removeById("json403448253")

  return app.save(collection)
})
