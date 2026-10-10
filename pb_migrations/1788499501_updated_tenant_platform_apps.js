/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_tenant_platform_apps")

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text3714783024",
    "max": 0,
    "min": 0,
    "name": "wa_public_number",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2603590227",
    "max": 0,
    "min": 0,
    "name": "wecom_encoding_aes_key",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_tenant_platform_apps")

  // remove field
  collection.fields.removeById("text3714783024")

  // remove field
  collection.fields.removeById("text2603590227")

  return app.save(collection)
})
