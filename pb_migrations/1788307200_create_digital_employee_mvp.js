/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 8dc57541536e2446193a60a1c35bb830c290b61675d292d9d2adbc449da96092
migrate((app) => {
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const number = (name, required = false) => ({ name, type: "number", required });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const bool = (name) => ({ name, type: "bool", required: false });
  const augmentCollection = (name, fields) => {
    let collection;
    try { collection = app.findCollectionByNameOrId(name); } catch { return; }
    let fieldsChanged = false;
    for (const field of fields) {
      if (!collection.fields.getByName(field.name)) {
        collection.fields.addAt(collection.fields.length, new Field(field));
        fieldsChanged = true;
      }
    }
    if (fieldsChanged) app.save(collection);
  };
  const ensureBootstrapCollection = (id, name, fields) => {
    try { app.findCollectionByNameOrId(name); return; } catch {}
    app.save(new Collection({
      id, name, type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [idField(), ...fields], indexes: []
    }));
  };
  // These two route-critical collections historically existed only in
  // setup-pb. Create them during migrations as well so a fresh production
  // PocketBase can pass canonical readiness before the app process starts.
  // Stable collection ids let the down migration distinguish bootstrap-owned
  // collections from older installations that are merely augmented here.
  ensureBootstrapCollection("lsstudio0000001", "studio_projects", [
    text("tenant_id", true), text("legacy_id"), text("title", true), text("status", true),
    json("spec", false, 2000000), text("thumb_seed"), text("created_at"), text("updated_at")
  ]);
  ensureBootstrapCollection("lsposts00000001", "posts", [
    text("tenant_id", true), text("content_id"), text("platform", true), text("platform_post_id"),
    text("title"), text("published_at"), text("track_code", true), text("wa_link"), json("stats"),
    number("inquiries"), number("deals"), text("digital_employee_idempotency_key"),
    text("publish_lease_owner"), text("publish_lease_expires_at"), number("publish_revision"),
    bool("reconciliation_required"), text("digital_employee_run_id"), text("digital_employee_approval_id"),
    text("digital_employee_action_hash"), number("digital_employee_fence_revision")
  ]);
  augmentCollection("scripts", [text("idempotency_key"), number("version"), text("payload_hash"), text("updatedAt")]);
  augmentCollection("studio_projects", []);
  augmentCollection("posts", [
    text("digital_employee_idempotency_key"), text("publish_lease_owner"), text("publish_lease_expires_at"),
    number("publish_revision"), bool("reconciliation_required"), text("digital_employee_run_id"),
    text("digital_employee_approval_id"), text("digital_employee_action_hash"), number("digital_employee_fence_revision")
  ]);
  const specs = [
    {
      name: "digital_employee_configs",
      fields: [text("tenant_id", true), json("config", true, 262144), text("status", true), text("updated_by"), text("created_at", true), text("updated_at", true)],
      indexes: ["CREATE UNIQUE INDEX idx_digital_employee_config_tenant ON digital_employee_configs (tenant_id)"]
    },
    {
      name: "weekly_goals",
      fields: [
        text("tenant_id", true), text("title", true), text("objective", true, 5000), text("metric", true),
        number("baseline"), number("target", true), text("unit"), text("starts_at", true), text("ends_at", true),
        json("scope", false, 65536), number("budget_limit"), json("constraints", false, 65536), text("owner_id", true), text("status", true),
        number("version", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: ["CREATE INDEX idx_weekly_goals_tenant_created ON weekly_goals (tenant_id, created_at)"]
    },
    {
      name: "weekly_plans",
      fields: [text("tenant_id", true), text("goal_id", true), number("goal_version", true), number("version", true), text("status", true), json("plan", true), text("idempotency_key", true), text("parent_plan_id"), text("reason", false, 5000), text("created_at", true), text("updated_at")],
      indexes: ["CREATE UNIQUE INDEX idx_weekly_plans_goal_version ON weekly_plans (tenant_id, goal_id, version)", "CREATE UNIQUE INDEX idx_weekly_plans_idempotency ON weekly_plans (tenant_id, idempotency_key) WHERE idempotency_key != ''"]
    },
    {
      name: "execution_contracts",
      fields: [text("tenant_id", true), text("goal_id", true), number("goal_version", true), number("version", true), text("status", true), text("payload_hash", true), text("source_fingerprint", true), json("contract", true, 1048576), text("confirmed_by"), text("compiled_at", true), text("confirmed_at"), text("invalidated_at")],
      indexes: ["CREATE UNIQUE INDEX idx_execution_contract_version ON execution_contracts (tenant_id, goal_id, version)", "CREATE INDEX idx_execution_contract_status ON execution_contracts (tenant_id, status)"]
    },
    {
      name: "workflow_runs",
      fields: [
        text("tenant_id", true), text("goal_id", true), text("plan_id", true), text("status", true),
        text("current_controller"), text("pause_reason"), number("budget_limit"), number("budget_spent"),
        json("execution_snapshot"), text("idempotency_key"), text("available_at"), text("lease_owner"), text("lease_expires_at"),
        text("started_at", true), text("completed_at"), number("revision"), text("error_code"), text("error_detail", false, 5000)
      ],
      indexes: [
        "CREATE INDEX idx_workflow_runs_goal ON workflow_runs (tenant_id, goal_id)",
        "CREATE UNIQUE INDEX idx_workflow_runs_idempotency ON workflow_runs (tenant_id, idempotency_key) WHERE idempotency_key != ''",
        "CREATE INDEX idx_workflow_runs_available ON workflow_runs (status, available_at, lease_expires_at)"
      ]
    },
    {
      name: "workflow_tasks",
      fields: [
        text("tenant_id", true), text("goal_id", true), text("plan_id", true), text("run_id", true),
        text("task_key", true), text("title", true), text("description", false, 5000), text("agent_role", true), text("kind", true),
        text("status", true), number("sequence", true), text("priority"), bool("requires_approval"), json("depends_on", false, 65536),
        json("output"), text("blocked_reason"), text("owner_id"), text("created_at", true), text("updated_at", true)
        , number("attempt"), number("max_attempts"), text("available_at"), text("lease_owner"), text("lease_expires_at"),
        text("started_at"), text("completed_at"), text("error_code"), text("error_detail", false, 5000), text("idempotency_key"), number("actual_cost"),
        number("expected_cost"), number("revision")
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_workflow_tasks_run_key ON workflow_tasks (tenant_id, run_id, task_key)",
        "CREATE INDEX idx_workflow_tasks_run_sequence ON workflow_tasks (tenant_id, run_id, sequence)",
        "CREATE UNIQUE INDEX idx_workflow_tasks_idempotency ON workflow_tasks (tenant_id, idempotency_key) WHERE idempotency_key != ''",
        "CREATE INDEX idx_workflow_tasks_available ON workflow_tasks (status, available_at, lease_expires_at)"
      ]
    },
    {
      name: "run_events",
      fields: [
        text("tenant_id", true), text("run_id", true), text("task_id"), number("sequence", true), text("type", true),
        text("level", true), text("summary", true, 5000), json("payload"), text("occurred_at", true)
      ],
      indexes: ["CREATE UNIQUE INDEX idx_run_events_sequence ON run_events (tenant_id, run_id, sequence)"]
    },
    {
      name: "approval_requests",
      fields: [
        text("tenant_id", true), text("goal_id", true), text("run_id", true), text("task_id", true), text("status", true),
        text("action_summary", true, 5000), text("action_type"), text("risk_level", true), json("evidence"), text("requested_by_agent"),
        text("decided_by"), text("decision_note", false, 5000), text("created_at", true), text("decided_at")
        , text("owner_id", true), number("action_version", true), text("payload_hash", true), text("approved_payload_hash"), json("action_payload"),
        text("target_account"), text("scheduled_at"), number("estimated_cost"), text("reversibility"), text("expires_at"), text("next_step"),
        json("changes"), json("diff"), number("revision"), text("transfer_note", false, 5000)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_approval_requests_action_version ON approval_requests (tenant_id, task_id, action_version)",
        "CREATE INDEX idx_approval_requests_owner_status ON approval_requests (tenant_id, owner_id, status, expires_at)"
      ]
    },
    {
      name: "handoff_sessions",
      fields: [
        text("tenant_id", true), text("run_id", true), text("task_id", true), text("status", true), text("taken_by", true),
        json("snapshot", true), text("started_at", true), text("returned_at"), number("revision"), text("transfer_note", false, 5000)
      ],
      indexes: [
        "CREATE INDEX idx_handoff_sessions_task ON handoff_sessions (tenant_id, task_id, started_at)",
        "CREATE UNIQUE INDEX idx_handoff_sessions_active ON handoff_sessions (tenant_id, task_id) WHERE status = 'active'"
      ]
    },
    {
      name: "weekly_reviews",
      fields: [text("tenant_id", true), text("goal_id", true), text("run_id", true), number("version", true), text("status", true), json("summary", true), text("created_at", true), text("superseded_at"), text("superseded_by"), text("superseded_reason", false, 5000)],
      indexes: ["CREATE UNIQUE INDEX idx_weekly_reviews_run_version ON weekly_reviews (tenant_id, run_id, version)"]
    },
    {
      name: "digital_employee_outbox",
      fields: [text("tenant_id", true), text("run_id", true), text("event_id", true), number("sequence", true), text("topic", true), json("payload", true), text("status", true), number("attempt"), text("available_at"), text("created_at", true), text("delivered_at"), text("lease_owner"), text("lease_expires_at"), text("error_detail", false, 5000)],
      indexes: ["CREATE UNIQUE INDEX idx_de_outbox_event ON digital_employee_outbox (tenant_id, event_id)", "CREATE INDEX idx_de_outbox_pending ON digital_employee_outbox (status, available_at, lease_expires_at)"]
    },
    {
      name: "outbound_action_ledger",
      fields: [text("tenant_id", true), text("run_id", true), text("task_id", true), text("approval_id", true), text("action_type", true), number("action_version", true), text("status", true), text("idempotency_key", true), text("approved_payload_hash"), json("payload"), text("external_record_id"), text("reason", false, 5000), text("created_at", true), text("updated_at", true)],
      indexes: ["CREATE UNIQUE INDEX idx_outbound_action_idempotency ON outbound_action_ledger (tenant_id, idempotency_key)", "CREATE UNIQUE INDEX idx_outbound_action_approval_version ON outbound_action_ledger (tenant_id, approval_id, action_version)"]
    }
  ];

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    let existing;
    try { existing = app.findCollectionByNameOrId(spec.name); } catch {}
    if (existing) {
      let fieldsChanged = false;
      for (const field of spec.fields) {
        if (!existing.fields.getByName(field.name)) {
          existing.fields.addAt(existing.fields.length, new Field(field));
          fieldsChanged = true;
        }
      }
      if (fieldsChanged) app.save(existing);
      continue;
    }
    app.save(new Collection({
      name: spec.name, type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [idField(), ...spec.fields], indexes: spec.indexes
    }));
  }
}, (app) => {
  const names = [
    "outbound_action_ledger", "digital_employee_outbox", "weekly_reviews", "handoff_sessions", "approval_requests", "run_events", "workflow_tasks",
    "workflow_runs", "execution_contracts", "weekly_plans", "weekly_goals", "digital_employee_configs"
  ];
  for (let index = 0; index < names.length; index += 1) {
    app.delete(app.findCollectionByNameOrId(names[index]));
  }
  const removeBootstrapCollection = (name, expectedId) => {
    let collection;
    try { collection = app.findCollectionByNameOrId(name); } catch { return; }
    if (collection.id === expectedId) app.delete(collection);
  };
  removeBootstrapCollection("studio_projects", "lsstudio0000001");
  removeBootstrapCollection("posts", "lsposts00000001");
  const removeAugmentation = (name, fieldNames, indexNames) => {
    let collection;
    try { collection = app.findCollectionByNameOrId(name); } catch { return; }
    for (const fieldName of fieldNames) {
      try { collection.fields.removeById(collection.fields.getByName(fieldName).id); } catch {}
    }
    collection.indexes = (collection.indexes || []).filter((value) => !indexNames.some((indexName) => value.includes(indexName)));
    app.save(collection);
  };
  removeAugmentation("scripts", ["idempotency_key", "version", "payload_hash", "updatedAt"], ["idx_scripts_idempotency"]);
  removeAugmentation("studio_projects", [], ["idx_studio_projects_legacy"]);
  removeAugmentation("posts", ["digital_employee_idempotency_key", "publish_lease_owner", "publish_lease_expires_at", "publish_revision", "reconciliation_required", "digital_employee_run_id", "digital_employee_approval_id", "digital_employee_action_hash", "digital_employee_fence_revision"], ["idx_posts_de_idempotency", "idx_posts_track_code", "idx_posts_publish_lease", "idx_posts_reconciliation", "idx_posts_de_run"]);
});
