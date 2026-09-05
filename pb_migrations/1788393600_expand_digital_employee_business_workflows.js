/// <reference path="../pb_data/types.d.ts" />

// P0 business-workflow persistence for Digital Employees.
//
// `followup_*` is the canonical naming used by the application. Do not add the
// earlier `outreach_*` aliases: having two sources of truth makes weekly review
// and send idempotency impossible to reason about.
migrate((app) => {
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required, onlyInt: true });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const bool = (name, required = false) => ({ name, type: "bool", required });

  const findCollection = (name) => {
    try { return app.findCollectionByNameOrId(name); } catch { return null; }
  };
  const hasField = (collection, name) => {
    try { return Boolean(collection.fields.getByName(name)); } catch { return false; }
  };
  const addField = (collection, definition) => {
    if (hasField(collection, definition.name)) return;
    collection.fields.addAt(collection.fields.length, new Field(definition));
  };

  const workflowTasks = findCollection("workflow_tasks");
  if (!workflowTasks) throw new Error("workflow_tasks collection must exist before P0 expansion");
  [
    { id: "text_wft_business_domain", ...text("business_domain") },
    { id: "text_wft_capability_key", ...text("capability_key") },
    { id: "text_wft_destination", ...text("destination") },
    { id: "text_wft_destination_view", ...text("destination_view") },
    { id: "text_wft_status_source", ...text("status_source") },
    { id: "text_wft_execution_mode", ...text("execution_mode") },
    { id: "text_wft_external_effect", ...text("external_effect") },
    { id: "json_wft_business_refs", ...json("business_refs", false, 262144) },
    { id: "number_wft_task_version", ...number("task_version") },
    { id: "number_wft_correction_version", ...number("correction_version") },
  ].forEach((field) => addField(workflowTasks, field));
  app.save(workflowTasks);

  const approvals = findCollection("approval_requests");
  if (approvals) {
    addField(approvals, { id: "number_approval_subject_version", ...number("subject_version") });
    addField(approvals, { id: "text_approval_content_hash", ...text("content_hash") });
    app.save(approvals);
  }

  const specs = [
    {
      name: "workflow_corrections",
      fields: [
        text("tenant_id", true), text("goal_id"), text("run_id", true), text("task_id", true),
        number("version", true), text("scope", true), text("instruction", true), bool("rerun_downstream"),
        json("before_state", true), json("after_state", true), json("affected_task_ids"), json("business_refs"),
        text("status", true), text("created_by", true), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_workflow_corrections_task_version ON workflow_corrections (tenant_id, task_id, version)",
        "CREATE INDEX idx_workflow_corrections_run_created ON workflow_corrections (tenant_id, run_id, created_at)"
      ]
    },
    {
      name: "customer_segments",
      fields: [
        text("tenant_id", true), text("goal_id"), text("run_id", true), text("task_id", true), text("name", true),
        text("status", true), number("version", true), json("criteria", true), text("criteria_hash", true),
        number("member_count"), number("excluded_count"), json("exclusion_summary"), text("snapshot_at", true),
        text("created_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_customer_segments_run_version ON customer_segments (tenant_id, run_id, version)",
        "CREATE INDEX idx_customer_segments_tenant_snapshot ON customer_segments (tenant_id, snapshot_at)"
      ]
    },
    {
      name: "customer_segment_members",
      fields: [
        text("tenant_id", true), text("segment_id", true), text("customer_id", true), text("customer_name"),
        text("membership", true), json("inclusion_reasons"), json("exclusion_reasons"), json("customer_snapshot", true),
        text("risk_level"), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_customer_segment_members_customer ON customer_segment_members (tenant_id, segment_id, customer_id)",
        "CREATE INDEX idx_customer_segment_members_segment_state ON customer_segment_members (tenant_id, segment_id, membership)"
      ]
    },
    {
      name: "followup_batches",
      fields: [
        text("tenant_id", true), text("goal_id"), text("run_id", true), text("task_id", true), text("segment_id", true),
        text("name", true), text("status", true), number("version", true), text("approval_id"),
        number("approved_version"), text("content_hash", true), json("delivery_policy", true),
        json("safety_summary", true), json("counts", true), text("created_by", true), text("approved_by"),
        text("created_at", true), text("updated_at", true), text("approved_at")
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_followup_batches_run_version ON followup_batches (tenant_id, run_id, version)",
        "CREATE INDEX idx_followup_batches_tenant_status ON followup_batches (tenant_id, status, updated_at)"
      ]
    },
    {
      name: "followup_batch_items",
      fields: [
        text("tenant_id", true), text("batch_id", true), text("segment_member_id"), text("customer_id", true),
        text("customer_name"), text("wa_number"), text("language"), text("time_zone"), text("last_inbound_at"),
        bool("outside_24h"), text("send_mode"), text("template_name"), text("template_status"),
        text("draft_body", true), number("draft_version", true), text("content_hash", true), text("status", true),
        text("risk_level"), text("guard_rule"), text("exclusion_reason"), text("scheduled_at"),
        text("idempotency_key"), text("provider_message_id"), json("provider_receipt"), number("attempts"),
        text("last_error"), text("approved_at"), text("sent_at"), text("delivered_at"),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_followup_batch_items_customer ON followup_batch_items (tenant_id, batch_id, customer_id)",
        "CREATE UNIQUE INDEX idx_followup_batch_items_idempotency ON followup_batch_items (tenant_id, idempotency_key) WHERE idempotency_key != ''",
        "CREATE INDEX idx_followup_batch_items_due ON followup_batch_items (tenant_id, status, scheduled_at)"
      ]
    }
  ];

  for (const spec of specs) {
    if (findCollection(spec.name)) continue;
    app.save(new Collection({
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
  }
}, (app) => {
  const findCollection = (name) => {
    try { return app.findCollectionByNameOrId(name); } catch { return null; }
  };
  for (const name of [
    "followup_batch_items", "followup_batches", "customer_segment_members", "customer_segments", "workflow_corrections"
  ]) {
    const collection = findCollection(name);
    if (collection) app.delete(collection);
  }

  const removeFields = (collectionName, names) => {
    const collection = findCollection(collectionName);
    if (!collection) return;
    for (const name of names) {
      try {
        const field = collection.fields.getByName(name);
        collection.fields.removeById(field.id);
      } catch {}
    }
    app.save(collection);
  };
  removeFields("approval_requests", ["subject_version", "content_hash"]);
  removeFields("workflow_tasks", [
    "business_domain", "capability_key", "destination", "destination_view", "status_source",
    "execution_mode", "external_effect", "business_refs", "task_version", "correction_version"
  ]);
});
