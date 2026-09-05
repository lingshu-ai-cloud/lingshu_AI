/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
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
    const result = app.save(new Collection({
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
}, (app) => {
  const names = [
    "weekly_reviews", "handoff_sessions", "approval_requests", "run_events", "workflow_tasks",
    "workflow_runs", "weekly_plans", "weekly_goals", "digital_employee_configs"
  ];
  for (let index = 0; index < names.length; index += 1) {
    const result = app.delete(app.findCollectionByNameOrId(names[index]));
    if (index === names.length - 1) return result;
  }
});
