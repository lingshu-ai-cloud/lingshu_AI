/// <reference path="../pb_data/types.d.ts" />

// Gap-V1 forward-only persistence for the T1/T4 authoritative objects. These
// collections are deliberately server-only and version rows are immutable.
migrate((app) => {
  const id = () => ({ name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" })
  const text = (name, required = false) => ({ name, type: "text", required, max: 0 })
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true })
  const decimal = (name, required = false) => ({ name, type: "number", required })
  const json = (name, required = false) => ({ name, type: "json", required, maxSize: 8388608 })
  const immutable = (name, fields, indexes) => new Collection({
    name, type: "base", system: false, listRule: null, viewRule: null, createRule: null,
    updateRule: "@request.auth.id != '' && false", deleteRule: "@request.auth.id != '' && false",
    fields: [id(), ...fields], indexes
  })

  app.save(immutable("social_business_content_goals", [
    text("tenant_id", true), text("program_id", true), text("goal_id", true), number("version", true),
    text("input_fingerprint", true), text("status", true), json("payload", true), text("created_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_business_goal_version ON social_business_content_goals (tenant_id, program_id, goal_id, version)",
    "CREATE UNIQUE INDEX idx_social_business_goal_input ON social_business_content_goals (tenant_id, program_id, input_fingerprint)",
    "CREATE INDEX idx_social_business_goal_latest ON social_business_content_goals (tenant_id, program_id, version)"
  ]))
  app.save(immutable("social_operating_decisions", [
    text("tenant_id", true), text("program_id", true), text("decision_id", true), text("subject_id", true),
    number("subject_version", true), text("outcome", true), text("input_fingerprint", true), json("payload", true), text("decided_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_operating_decision_id ON social_operating_decisions (tenant_id, program_id, decision_id)",
    "CREATE INDEX idx_social_operating_decision_subject ON social_operating_decisions (tenant_id, program_id, subject_id, subject_version)"
  ]))
  app.save(immutable("social_candidate_evidence", [
    text("tenant_id", true), text("candidateId", true), text("evidenceId", true), number("version", true),
    text("inputFingerprint", true), text("completeness", true), json("evidence", true), json("g1", true),
    text("supersedesEvidenceId"), text("createdAt", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_candidate_evidence_version ON social_candidate_evidence (tenant_id, candidateId, version)",
    "CREATE UNIQUE INDEX idx_social_candidate_evidence_id ON social_candidate_evidence (tenant_id, evidenceId)",
    "CREATE INDEX idx_social_candidate_evidence_latest ON social_candidate_evidence (tenant_id, candidateId, version)"
  ]))
  app.save(immutable("social_reference_selections", [
    text("tenant_id", true), text("upstreamTaskRef", true), text("selectionId", true), number("version", true),
    text("status", true), json("selected", true), text("reason", true), json("evidenceVersionRefs", true),
    text("supersedesSelectionId"), text("createdAt", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_reference_selection_version ON social_reference_selections (tenant_id, upstreamTaskRef, version)",
    "CREATE UNIQUE INDEX idx_social_reference_selection_id ON social_reference_selections (tenant_id, selectionId)"
  ]))
  return app.save(new Collection({
    name: "social_discovery_gap_tasks", type: "base", system: false, listRule: null, viewRule: null,
    createRule: null, updateRule: null, deleteRule: "@request.auth.id != '' && false",
    fields: [id(), text("tenant_id", true), text("gapTaskId", true), text("upstreamTaskRef", true),
      text("status", true), text("stopReason"), decimal("budgetLimitCny", true), decimal("spentCny", true),
      json("runRefs", true), json("selectedEvidenceRefs", true), text("productionGap", true), text("createdAt", true), text("updatedAt", true)],
    indexes: [
      "CREATE UNIQUE INDEX idx_social_discovery_gap_task ON social_discovery_gap_tasks (tenant_id, gapTaskId)",
      "CREATE INDEX idx_social_discovery_gap_upstream ON social_discovery_gap_tasks (tenant_id, upstreamTaskRef, status)"
    ]
  }))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_discovery_gap_tasks"))
  app.delete(app.findCollectionByNameOrId("social_reference_selections"))
  app.delete(app.findCollectionByNameOrId("social_candidate_evidence"))
  app.delete(app.findCollectionByNameOrId("social_operating_decisions"))
  return app.delete(app.findCollectionByNameOrId("social_business_content_goals"))
})
