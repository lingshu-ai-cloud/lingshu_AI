/// <reference path="../pb_data/types.d.ts" />

// Social operating system root objects. Business account definitions remain
// separate from OAuth/channel connections, and plans/playbooks are immutable
// versions so production tasks can keep stable input references.
migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  })
  const text = (name, required = false) => ({ name, type: "text", required })
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true })
  const json = (name, required = false) => ({ name, type: "json", required, maxSize: 2097152 })
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  })

  app.save(collection("social_programs", [
    text("tenant_id", true), text("program_id", true), number("version", true),
    text("status", true), text("stage", true), text("route"), text("brand_name", true),
    text("market", true), json("payload", true), text("created_by", true),
    text("updated_by", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_program_id ON social_programs (tenant_id, program_id)",
    "CREATE UNIQUE INDEX idx_social_program_active_brand_market ON social_programs (tenant_id, brand_name, market) WHERE status = 'active'",
    "CREATE INDEX idx_social_program_stage ON social_programs (tenant_id, stage, updated_at)"
  ]))

  app.save(collection("social_owned_accounts", [
    text("tenant_id", true), text("program_id", true), text("account_id", true),
    text("platform", true), text("status", true), number("version", true), json("payload", true),
    text("created_by", true), text("updated_by", true), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_owned_account_id ON social_owned_accounts (tenant_id, account_id)",
    "CREATE INDEX idx_social_owned_account_program ON social_owned_accounts (tenant_id, program_id, status, created_at)"
  ]))

  app.save(collection("social_playbook_versions", [
    text("tenant_id", true), text("program_id", true), text("account_id", true),
    text("playbook_id", true), number("version", true), text("status", true), json("payload", true),
    text("created_by", true), text("created_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_playbook_version ON social_playbook_versions (tenant_id, playbook_id, version)",
    "CREATE UNIQUE INDEX idx_social_playbook_active ON social_playbook_versions (tenant_id, account_id) WHERE status = 'active'",
    "CREATE INDEX idx_social_playbook_account ON social_playbook_versions (tenant_id, program_id, account_id, version)"
  ]))

  return app.save(collection("social_plan_versions", [
    text("tenant_id", true), text("program_id", true), text("plan_type", true),
    text("plan_id", true), number("version", true), text("status", true), json("payload", true),
    text("created_by", true), text("created_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_social_plan_version ON social_plan_versions (tenant_id, plan_type, plan_id, version)",
    "CREATE UNIQUE INDEX idx_social_plan_one_active ON social_plan_versions (tenant_id, program_id, plan_type) WHERE status = 'active'",
    "CREATE INDEX idx_social_plan_program ON social_plan_versions (tenant_id, program_id, plan_type, created_at)"
  ]))
}, (app) => {
  app.delete(app.findCollectionByNameOrId("social_plan_versions"))
  app.delete(app.findCollectionByNameOrId("social_playbook_versions"))
  app.delete(app.findCollectionByNameOrId("social_owned_accounts"))
  return app.delete(app.findCollectionByNameOrId("social_programs"))
})
