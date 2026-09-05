/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_393524316")

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "select3102592935",
    "maxSelect": 0,
    "name": "contentFormat",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "video",
      "image"
    ]
  }))

  // update field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2970110664",
    "max": 1000000,
    "min": 0,
    "name": "aiAnalysis",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_393524316")

  // remove field
  collection.fields.removeById("select3102592935")

  // update field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2970110664",
    "max": 0,
    "min": 0,
    "name": "aiAnalysis",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
