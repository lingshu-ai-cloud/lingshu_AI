/// <reference path="../pb_data/types.d.ts" />

// Compatibility repair for installations that applied the original rules.
// PocketBase 0.39.5 rejects `@request.auth.id != '' && false`; a null rule is
// the equivalent locked (superuser-only) API rule. Starting gap tasks must
// allow zero budget/spend and empty evidence arrays while remaining server-only.
migrate((app) => {
  const immutable = [
    "social_weekly_review_snapshots",
    "social_weekly_promotion_decisions",
    "social_weekly_quota_references",
    "social_business_content_goals",
    "social_operating_decisions",
    "social_candidate_evidence",
    "social_reference_selections",
  ]
  for (const name of immutable) {
    const collection = app.findCollectionByNameOrId(name)
    collection.updateRule = null
    collection.deleteRule = null
    app.save(collection)
  }
  const gaps = app.findCollectionByNameOrId("social_discovery_gap_tasks")
  gaps.deleteRule = null
  for (const name of ["budgetLimitCny", "spentCny", "runRefs", "selectedEvidenceRefs"]) {
    gaps.fields.getByName(name).required = false
  }
  return app.save(gaps)
}, (app) => {
  // Reverting an access-control repair would reintroduce invalid rules.
})
