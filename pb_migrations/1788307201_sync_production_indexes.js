/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 8dc57541536e2446193a60a1c35bb830c290b61675d292d9d2adbc449da96092
migrate((app) => {
  const indexName = (value) => (/\bindex\s+(?:if\s+not\s+exists\s+)?([^\s]+)/i.exec(value) || [])[1] || value;
  const specs = {
    scripts: ["CREATE UNIQUE INDEX idx_scripts_idempotency ON scripts (tenantId, idempotency_key) WHERE idempotency_key != ''"],
    studio_projects: ["CREATE UNIQUE INDEX idx_studio_projects_legacy ON studio_projects (tenant_id, legacy_id) WHERE legacy_id != ''"],
    posts: [
      "CREATE UNIQUE INDEX idx_posts_de_idempotency ON posts (tenant_id, digital_employee_idempotency_key) WHERE digital_employee_idempotency_key != ''",
      "CREATE UNIQUE INDEX idx_posts_track_code ON posts (tenant_id, track_code)",
      "CREATE INDEX idx_posts_publish_lease ON posts (tenant_id, publish_lease_expires_at, published_at)",
      "CREATE INDEX idx_posts_reconciliation ON posts (tenant_id, reconciliation_required)",
      "CREATE INDEX idx_posts_de_run ON posts (tenant_id, digital_employee_run_id)"
    ],
    digital_employee_configs: ["CREATE UNIQUE INDEX idx_digital_employee_config_tenant ON digital_employee_configs (tenant_id)"],
    weekly_goals: ["CREATE INDEX idx_weekly_goals_tenant_created ON weekly_goals (tenant_id, created_at)"],
    weekly_plans: [
      "CREATE UNIQUE INDEX idx_weekly_plans_goal_version ON weekly_plans (tenant_id, goal_id, version)",
      "CREATE UNIQUE INDEX idx_weekly_plans_idempotency ON weekly_plans (tenant_id, idempotency_key) WHERE idempotency_key != ''"
    ],
    execution_contracts: [
      "CREATE UNIQUE INDEX idx_execution_contract_version ON execution_contracts (tenant_id, goal_id, version)",
      "CREATE INDEX idx_execution_contract_status ON execution_contracts (tenant_id, status)"
    ],
    workflow_runs: [
      "CREATE INDEX idx_workflow_runs_goal ON workflow_runs (tenant_id, goal_id)",
      "CREATE UNIQUE INDEX idx_workflow_runs_idempotency ON workflow_runs (tenant_id, idempotency_key) WHERE idempotency_key != ''",
      "CREATE INDEX idx_workflow_runs_available ON workflow_runs (status, available_at, lease_expires_at)"
    ],
    workflow_tasks: [
      "CREATE UNIQUE INDEX idx_workflow_tasks_run_key ON workflow_tasks (tenant_id, run_id, task_key)",
      "CREATE INDEX idx_workflow_tasks_run_sequence ON workflow_tasks (tenant_id, run_id, sequence)",
      "CREATE UNIQUE INDEX idx_workflow_tasks_idempotency ON workflow_tasks (tenant_id, idempotency_key) WHERE idempotency_key != ''",
      "CREATE INDEX idx_workflow_tasks_available ON workflow_tasks (status, available_at, lease_expires_at)"
    ],
    run_events: ["CREATE UNIQUE INDEX idx_run_events_sequence ON run_events (tenant_id, run_id, sequence)"],
    approval_requests: [
      "CREATE UNIQUE INDEX idx_approval_requests_action_version ON approval_requests (tenant_id, task_id, action_version)",
      "CREATE INDEX idx_approval_requests_owner_status ON approval_requests (tenant_id, owner_id, status, expires_at)"
    ],
    handoff_sessions: [
      "CREATE INDEX idx_handoff_sessions_task ON handoff_sessions (tenant_id, task_id, started_at)",
      "CREATE UNIQUE INDEX idx_handoff_sessions_active ON handoff_sessions (tenant_id, task_id) WHERE status = 'active'"
    ],
    weekly_reviews: ["CREATE UNIQUE INDEX idx_weekly_reviews_run_version ON weekly_reviews (tenant_id, run_id, version)"],
    digital_employee_outbox: [
      "CREATE UNIQUE INDEX idx_de_outbox_event ON digital_employee_outbox (tenant_id, event_id)",
      "CREATE INDEX idx_de_outbox_pending ON digital_employee_outbox (status, available_at, lease_expires_at)"
    ],
    outbound_action_ledger: [
      "CREATE UNIQUE INDEX idx_outbound_action_idempotency ON outbound_action_ledger (tenant_id, idempotency_key)",
      "CREATE UNIQUE INDEX idx_outbound_action_approval_version ON outbound_action_ledger (tenant_id, approval_id, action_version)"
    ]
  };
  for (const name of Object.keys(specs)) {
    let collection;
    try { collection = app.findCollectionByNameOrId(name); } catch { continue; }
    const wanted = specs[name];
    const wantedNames = wanted.map(indexName);
    collection.indexes = (collection.indexes || []).filter((value) => !wantedNames.includes(indexName(value))).concat(wanted);
    app.save(collection);
  }
}, (app) => {
  const canonicalNames = [
    "idx_scripts_idempotency", "idx_studio_projects_legacy", "idx_posts_de_idempotency", "idx_posts_track_code",
    "idx_posts_publish_lease", "idx_posts_reconciliation", "idx_posts_de_run", "idx_digital_employee_config_tenant", "idx_weekly_goals_tenant_created",
    "idx_weekly_plans_goal_version", "idx_weekly_plans_idempotency", "idx_execution_contract_version", "idx_execution_contract_status",
    "idx_workflow_runs_goal", "idx_workflow_runs_idempotency", "idx_workflow_runs_available", "idx_workflow_tasks_run_key",
    "idx_workflow_tasks_run_sequence", "idx_workflow_tasks_idempotency", "idx_workflow_tasks_available", "idx_run_events_sequence",
    "idx_approval_requests_action_version", "idx_approval_requests_owner_status", "idx_handoff_sessions_task", "idx_handoff_sessions_active",
    "idx_weekly_reviews_run_version", "idx_de_outbox_event", "idx_de_outbox_pending", "idx_outbound_action_idempotency",
    "idx_outbound_action_approval_version"
  ];
  const collections = [
    "scripts", "studio_projects", "posts", "digital_employee_configs", "weekly_goals", "weekly_plans", "execution_contracts",
    "workflow_runs", "workflow_tasks", "run_events", "approval_requests", "handoff_sessions", "weekly_reviews",
    "digital_employee_outbox", "outbound_action_ledger"
  ];
  for (const name of collections) {
    let collection;
    try { collection = app.findCollectionByNameOrId(name); } catch { continue; }
    collection.indexes = (collection.indexes || []).filter((value) => !canonicalNames.some((indexName) => value.includes(indexName)));
    app.save(collection);
  }
});
