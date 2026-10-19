/// <reference path="../pb_data/types.d.ts" />

// Production schema authority for licensed, manifest-driven material imports.
// Existing records remain valid; only the importer requires the complete
// provenance envelope before it creates a new shared/editable material.
const materialProvenanceFields = [
  { id: "text_mat_product_id", name: "productId", type: "text", required: false },
  { id: "text_mat_product_name", name: "productName", type: "text", required: false },
  { id: "text_mat_source_url", name: "sourceUrl", type: "text", required: false },
  { id: "text_mat_license_evidence", name: "licenseEvidence", type: "text", required: false },
  { id: "json_mat_visual_obs", name: "visualObservations", type: "json", required: false, maxSize: 200000 },
  { id: "text_mat_analysis_rev", name: "analysisSourceRevision", type: "text", required: false },
  { id: "text_mat_segment_status", name: "segmentAnalysisStatus", type: "text", required: false },
  { id: "text_mat_segment_error", name: "segmentAnalysisError", type: "text", required: false },
  { id: "json_mat_segments", name: "segments", type: "json", required: false, maxSize: 2000000 },
  { id: "text_mat_source_provider", name: "sourceProvider", type: "text", required: false },
  { id: "text_mat_source_creator", name: "sourceCreator", type: "text", required: false },
  { id: "text_mat_license_name", name: "licenseName", type: "text", required: false },
  { id: "text_mat_license_url", name: "licenseUrl", type: "text", required: false },
  { id: "text_mat_attribution", name: "attributionText", type: "text", required: false },
  { id: "text_mat_license_at", name: "licenseEvidenceCapturedAt", type: "text", required: false },
  { id: "text_mat_license_sha", name: "licenseEvidenceTextSha256", type: "text", required: false },
  { id: "text_mat_import_batch", name: "importBatchId", type: "text", required: false },
  { id: "text_mat_manifest_sha", name: "manifestSha256", type: "text", required: false },
  { id: "text_mat_imported_at", name: "importedAt", type: "text", required: false },
  { id: "bool_mat_commercial", name: "commercialUseApproved", type: "bool", required: false },
  { id: "bool_mat_derivatives", name: "derivativesApproved", type: "bool", required: false },
  { id: "bool_mat_raw_library", name: "rawLibraryUseApproved", type: "bool", required: false },
  { id: "json_mat_provenance", name: "provenance", type: "json", required: false, maxSize: 500000 },
]

migrate((app) => {
  const collection = app.findCollectionByNameOrId("materials")
  for (const definition of materialProvenanceFields) {
    let existing
    try { existing = collection.fields.getByName(definition.name) } catch {}
    if (!existing) {
      collection.fields.addAt(collection.fields.length, new Field(definition))
    }
  }

  const indexes = collection.indexes || []
  const indexName = (index) => index.match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z0-9_]+)/i)?.[1] || ""
  const requiredIndexes = [
    "CREATE INDEX idx_materials_tenant_scope_sha256 ON materials (tenantId, scope, sha256)",
    "CREATE INDEX idx_materials_import_batch ON materials (importBatchId)",
  ]
  const existingNames = new Set(indexes.map(indexName))
  collection.indexes = [...indexes, ...requiredIndexes.filter(index => !existingNames.has(indexName(index)))]
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("materials")
  for (const definition of materialProvenanceFields) {
    try {
      const field = collection.fields.getByName(definition.name)
      // Preserve fields that predated this migration (for example a manually
      // repaired development database) and only remove fields owned by it.
      if (field.id === definition.id) collection.fields.removeById(field.id)
    } catch {}
  }
  const indexName = (index) => index.match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z0-9_]+)/i)?.[1] || ""
  collection.indexes = (collection.indexes || []).filter(index => ![
    "idx_materials_tenant_scope_sha256",
    "idx_materials_import_batch",
  ].includes(indexName(index)))
  return app.save(collection)
})
