/// <reference path="../pb_data/types.d.ts" />

// Generated social videos and covers belong to the backend record. The
// application may render in the operating-system temp directory, but it must
// never retain a durable copy under its checkout or data directory.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("starter_social_content_files")
  const existing = collection.fields.getByName("backend_file")
  if (!existing) {
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
  const collection = app.findCollectionByNameOrId("starter_social_content_files")
  try {
    collection.fields.removeById(collection.fields.getByName("backend_file").id)
  } catch {}
  return app.save(collection)
})
