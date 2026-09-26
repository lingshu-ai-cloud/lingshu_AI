/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const id = () => ({ name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" })
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, max })
  const json = (name, required = false) => ({ name, type: "json", required, maxSize: 2097152 })
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true })
  const collection = (name, fields, indexes) => new Collection({ name, type: "base", system: false, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [id(), ...fields], indexes })

  app.save(collection("social_interaction_writebacks", [
    text("tenant_id", true), text("event_key", true), text("kind", true), text("platform", true),
    text("providerEventId", true), text("accountId", true), text("contentId"), text("body", true, 10000),
    text("occurredAt", true), text("actorRef"), text("entryRef", false, 500), text("ctaRef", false, 300),
    text("businessDirectionRef", false, 300), text("respondedAt"), json("qualificationFields"), json("raw"),
    text("source_confidence", true), text("qualification_status", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_interaction_event ON social_interaction_writebacks (tenant_id, event_key)",
    "CREATE INDEX idx_social_interaction_content ON social_interaction_writebacks (tenant_id, accountId, contentId, occurredAt)",
    "CREATE INDEX idx_social_interaction_kind ON social_interaction_writebacks (tenant_id, kind, occurredAt)"
  ]))
  app.save(collection("social_sales_qualifications", [
    text("tenant_id", true), text("interaction_id", true), text("status", true), text("authority", true),
    text("actor_id", true), text("reason", true, 2000), json("bant"), text("confirmed_at", true)
  ], ["CREATE UNIQUE INDEX idx_social_sales_qualification ON social_sales_qualifications (tenant_id, interaction_id)"]))
  return app.save(collection("social_creative_learnings", [
    text("tenant_id", true), text("learning_id", true), number("version", true), text("evidence_kind", true), json("scope", true),
    text("observation", true, 4000), json("evidence_refs", true), json("sample", true), json("boundaries", true),
    text("next_action", true, 2000), text("created_by", true), text("created_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_creative_learning_version ON social_creative_learnings (tenant_id, learning_id, version)",
    "CREATE INDEX idx_social_creative_learning_created ON social_creative_learnings (tenant_id, created_at)"
  ]))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_creative_learnings"))
  app.delete(app.findCollectionByNameOrId("social_sales_qualifications"))
  return app.delete(app.findCollectionByNameOrId("social_interaction_writebacks"))
})
