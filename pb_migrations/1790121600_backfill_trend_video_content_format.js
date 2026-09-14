/// <reference path="../pb_data/types.d.ts" />

// Historical rows predate the indexed contentFormat field. Classify them once
// inside PocketBase's migration transaction so normal application replicas do
// not race a runtime backfill. Explicit existing values are never overwritten.
migrate((app) => {
  while (true) {
    const records = app.findRecordsByFilter(
      "trend_videos",
      'contentFormat = ""',
      "id",
      200,
      0
    )
    if (!records.length) break

    for (const record of records) {
      let analysis = record.get("aiAnalysis")
      if (typeof analysis === "string" && analysis) {
        try { analysis = JSON.parse(analysis) } catch { analysis = {} }
      }
      const contentFormat = analysis
        && typeof analysis === "object"
        && analysis.contentFormat === "image"
        ? "image"
        : "video"
      record.set("contentFormat", contentFormat)
      app.save(record)
    }
  }
}, (_app) => {
  // Forward-only data classification. Clearing values on rollback would also
  // erase legitimate writes made after this migration and is therefore unsafe.
})
