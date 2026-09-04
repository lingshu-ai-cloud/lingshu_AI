/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Forward-only reconciliation of prototype/setup-first schemas. Preserve IDs,
  // records, unrelated fields and historical migration bytes. Conflicts fail.
  const buildField = (definition) => {
    const constructors = { text: TextField, number: NumberField, json: JSONField, bool: BoolField };
    const Constructor = constructors[definition.type];
    if (!Constructor) throw new Error("unsupported field type: " + definition.type);
    return new Constructor(definition);
  };
  const saveForward = (proposed) => {
    let current = null;
    try { current = app.findCollectionByNameOrId(proposed.name); } catch {}
    if (!current) return app.save(proposed);
    if (current.type !== proposed.type) throw new Error("incompatible collection: " + proposed.name);
    for (const field of proposed.fields) {
      const definition = { ...JSON.parse(JSON.stringify(field)), type: field.type() };
      let existing = null;
      try { existing = current.fields.getByName(definition.name); } catch {}
      if (!existing) {
        current.fields.addAt(current.fields.length, buildField(definition));
      } else {
        const existingDefinition = { ...JSON.parse(JSON.stringify(existing)), type: existing.type() };
        if (existingDefinition.type !== definition.type) throw new Error("incompatible field: " + proposed.name + "." + definition.name);
        if (definition.type === "json" && existing.maxSize < definition.maxSize) {
          current.fields.add(buildField({ ...existingDefinition, maxSize: definition.maxSize }));
        }
      }
    }
    const indexes = Array.from(current.indexes || []);
    for (const index of proposed.indexes || []) {
      const indexName = /INDEX\s+(\S+)\s+ON/i.exec(index);
      const existing = indexes.find(value => {
        const name = /INDEX\s+(\S+)\s+ON/i.exec(value);
        return name && indexName && name[1] === indexName[1];
      });
      if (existing && existing.replace(/\s+/g, " ").trim() !== index.replace(/\s+/g, " ").trim()) throw new Error("incompatible index: " + indexName[1]);
      if (!existing) indexes.push(index);
    }
    current.indexes = indexes;
    for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      if (current[rule] !== null) throw new Error("unexpected client access rule: " + proposed.name + "." + rule);
    }
    return app.save(current);
  };

  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const bool = (name) => ({ name, type: "bool", required: false });
  const specs = [
    {
      name: "digital_employee_configs",
      fields: [text("tenant_id", true), json("config", true), text("status", true), text("updated_by"), text("created_at", true), text("updated_at", true)],
      indexes: ["CREATE UNIQUE INDEX idx_digital_employee_config_tenant ON digital_employee_configs (tenant_id)"]
    },
    {
      name: "weekly_goals",
      fields: [
        text("tenant_id", true), text("title", true), text("objective", true), text("metric", true),
        number("baseline"), number("target", true), text("unit"), text("starts_at", true), text("ends_at", true),
        json("scope"), number("budget_limit"), json("constraints"), text("owner_id", true), text("status", true),
        number("version", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: ["CREATE INDEX idx_weekly_goals_tenant_created ON weekly_goals (tenant_id, created_at)"]
    },
    {
      name: "weekly_plans",
      fields: [text("tenant_id", true), text("goal_id", true), text("status", true), json("plan", true), text("created_at", true)],
      indexes: ["CREATE UNIQUE INDEX idx_weekly_plans_goal ON weekly_plans (tenant_id, goal_id)"]
    },
    {
      name: "workflow_runs",
      fields: [
        text("tenant_id", true), text("goal_id", true), text("plan_id", true), text("status", true),
        text("current_controller"), text("pause_reason"), number("budget_limit"), number("budget_spent"),
        text("started_at", true), text("completed_at")
      ],
      indexes: ["CREATE UNIQUE INDEX idx_workflow_runs_goal ON workflow_runs (tenant_id, goal_id)"]
    },
    {
      name: "workflow_tasks",
      fields: [
        text("tenant_id", true), text("goal_id", true), text("plan_id", true), text("run_id", true),
        text("task_key", true), text("title", true), text("description"), text("agent_role", true), text("kind", true),
        text("status", true), number("sequence", true), text("priority"), bool("requires_approval"), json("depends_on"),
        json("output"), text("blocked_reason"), text("owner_id"), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_workflow_tasks_run_key ON workflow_tasks (tenant_id, run_id, task_key)",
        "CREATE INDEX idx_workflow_tasks_run_sequence ON workflow_tasks (tenant_id, run_id, sequence)"
      ]
    },
    {
      name: "run_events",
      fields: [
        text("tenant_id", true), text("run_id", true), text("task_id"), number("sequence", true), text("type", true),
        text("level", true), text("summary", true), json("payload"), text("occurred_at", true)
      ],
      indexes: ["CREATE UNIQUE INDEX idx_run_events_sequence ON run_events (tenant_id, run_id, sequence)"]
    },
    {
      name: "approval_requests",
      fields: [
        text("tenant_id", true), text("goal_id", true), text("run_id", true), text("task_id", true), text("status", true),
        text("action_summary", true), text("risk_level", true), json("evidence"), text("requested_by_agent"),
        text("decided_by"), text("decision_note"), text("created_at", true), text("decided_at")
      ],
      indexes: ["CREATE UNIQUE INDEX idx_approval_requests_task ON approval_requests (tenant_id, task_id)"]
    },
    {
      name: "handoff_sessions",
      fields: [
        text("tenant_id", true), text("run_id", true), text("task_id", true), text("status", true), text("taken_by", true),
        json("snapshot", true), text("started_at", true), text("returned_at")
      ],
      indexes: ["CREATE INDEX idx_handoff_sessions_task ON handoff_sessions (tenant_id, task_id, started_at)"]
    },
    {
      name: "weekly_reviews",
      fields: [text("tenant_id", true), text("goal_id", true), text("run_id", true), text("status", true), json("summary", true), text("created_at", true)],
      indexes: ["CREATE UNIQUE INDEX idx_weekly_reviews_run ON weekly_reviews (tenant_id, run_id)"]
    }
  ];

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const result = saveForward(new Collection({
      name: spec.name,
      type: "base",
      system: false,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [idField(), ...spec.fields],
      indexes: spec.indexes
    }));
    if (index === specs.length - 1) return result;
  }
}, () => { throw new Error("Forward-only release migration; rollback the application image, never delete business records."); });
