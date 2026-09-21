/// <reference path="../pb_data/types.d.ts" />

// Forward repair for development databases that applied the first backend-file
// migration with a PocketBase runtime where fields.getByName() returned null
// instead of throwing. Fresh databases already have this field and are left
// unchanged.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_files")
  if (!collection.fields.getByName("backend_file")) {
    collection.fields.addAt(collection.fields.length, new Field({
      help: "",
      hidden: false,
      id: "file1790380800",
      name: "backend_file",
      type: "file",
      presentable: false,
      protected: false,
      required: false,
      system: false,
      maxSelect: 1,
      maxSize: 115343360,
      thumbs: null,
      mimeTypes: [
        "video/mp4", "video/quicktime", "video/webm",
        "image/jpeg", "image/png", "image/webp", "image/gif",
        "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4",
        "application/pdf", "text/plain", "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ]
    }))
  }
  return app.save(collection)
}, (app) => {
  // The original migration owns the field. Rolling this repair back must not
  // remove a field that a fresh install created before this migration ran.
})
