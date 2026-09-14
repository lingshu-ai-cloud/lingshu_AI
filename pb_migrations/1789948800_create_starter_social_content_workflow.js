/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required });
  const json = (name, required = false, maxSize = 2097152) => ({ name, type: "json", required, maxSize });
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  });

  const specs = [
    {
      name: "starter_social_content_tasks",
      fields: [
        text("tenant_id", true), text("task_id", true), json("brief", true, 262144),
        json("package_selection", true, 65536), text("status", true), text("version", true),
        text("run_id"), text("orchestrator_item_id"), number("source_count", true),
        number("knowledge_source_count", true), number("material_source_count", true),
        number("artifact_count", true), number("approved_artifact_count", true),
        number("delivery_package_count", true), number("publication_count", true),
        number("metric_submission_count", true), text("create_idempotency_key", true),
        text("create_request_hash", true), text("last_operation_id", true), text("created_by", true),
        text("updated_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_content_task_id ON starter_social_content_tasks (tenant_id, task_id)",
        "CREATE UNIQUE INDEX idx_social_content_task_create ON starter_social_content_tasks (tenant_id, create_idempotency_key)",
        "CREATE INDEX idx_social_content_task_status ON starter_social_content_tasks (tenant_id, status, updated_at)"
      ]
    },
    {
      name: "starter_social_content_files",
      fields: [
        text("tenant_id", true), text("file_id", true), text("task_id", true), text("usage", true),
        text("name", true), text("mime_type", true), number("byte_size", true), text("content_sha256", true),
        text("storage_kind", true), text("storage_key", true), text("last_operation_id", true),
        text("created_by", true), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_content_file_id ON starter_social_content_files (tenant_id, file_id)",
        "CREATE UNIQUE INDEX idx_social_content_file_operation ON starter_social_content_files (tenant_id, last_operation_id)",
        "CREATE UNIQUE INDEX idx_social_content_file_content ON starter_social_content_files (tenant_id, task_id, usage, content_sha256)",
        "CREATE INDEX idx_social_content_file_task ON starter_social_content_files (tenant_id, task_id, created_at)"
      ]
    },
    {
      name: "starter_social_task_sources",
      fields: [
        text("tenant_id", true), text("source_id", true), text("task_id", true), text("source_kind", true),
        text("source_ref", true), text("source_version"), text("label", true), text("purpose"),
        text("status", true), text("storage_kind"), text("storage_key"), text("mime_type"),
        number("byte_size"), text("content_sha256"), text("created_operation_id", true), text("last_operation_id", true),
        text("created_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_task_source_id ON starter_social_task_sources (tenant_id, source_id)",
        "CREATE UNIQUE INDEX idx_social_task_source_created_operation ON starter_social_task_sources (tenant_id, created_operation_id)",
        "CREATE UNIQUE INDEX idx_social_task_source_operation ON starter_social_task_sources (tenant_id, last_operation_id)",
        "CREATE UNIQUE INDEX idx_social_task_source_active_ref ON starter_social_task_sources (tenant_id, task_id, source_kind, source_ref) WHERE status = 'active'",
        "CREATE INDEX idx_social_task_source_task ON starter_social_task_sources (tenant_id, task_id, status)"
      ]
    },
    {
      name: "starter_social_work_package_versions",
      fields: [
        text("tenant_id", true), text("package_kind", true), text("package_key", true),
        text("package_version", true), text("name", true), text("summary"), json("framework", true, 524288),
        text("status", true), text("effective_from"), text("effective_until"), text("record_version", true),
        text("last_operation_id", true), text("created_by", true), text("updated_by", true),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_work_package_version ON starter_social_work_package_versions (tenant_id, package_key, package_version)",
        "CREATE UNIQUE INDEX idx_social_work_package_operation ON starter_social_work_package_versions (tenant_id, last_operation_id)",
        "CREATE UNIQUE INDEX idx_social_work_package_one_active ON starter_social_work_package_versions (tenant_id, package_kind) WHERE status = 'active'",
        "CREATE INDEX idx_social_work_package_active ON starter_social_work_package_versions (tenant_id, package_kind, status, created_at)"
      ]
    },
    {
      name: "starter_social_content_artifacts",
      fields: [
        text("tenant_id", true), text("artifact_id", true), text("task_id", true), text("artifact_kind", true),
        text("platform"), text("language"), text("version", true), text("status", true), text("origin", true),
        text("resource_ref"), json("content", false, 262144), text("content_hash", true),
        text("parent_artifact_id"), text("decision_note"), text("created_operation_id", true), text("last_operation_id", true),
        text("created_by", true), text("updated_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_content_artifact_id ON starter_social_content_artifacts (tenant_id, artifact_id)",
        "CREATE UNIQUE INDEX idx_social_content_artifact_created_operation ON starter_social_content_artifacts (tenant_id, created_operation_id)",
        "CREATE UNIQUE INDEX idx_social_content_artifact_operation ON starter_social_content_artifacts (tenant_id, last_operation_id)",
        "CREATE INDEX idx_social_content_artifact_task ON starter_social_content_artifacts (tenant_id, task_id, status)"
      ]
    },
    {
      name: "starter_social_delivery_packages",
      fields: [
        text("tenant_id", true), text("package_id", true), text("task_id", true), text("version", true),
        text("status", true), json("artifact_ids", true, 65536), json("manifest", true, 2097152),
        text("package_hash", true), text("created_operation_id", true), text("last_operation_id", true), text("created_by", true),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_delivery_package_id ON starter_social_delivery_packages (tenant_id, package_id)",
        "CREATE UNIQUE INDEX idx_social_delivery_package_created_operation ON starter_social_delivery_packages (tenant_id, created_operation_id)",
        "CREATE UNIQUE INDEX idx_social_delivery_package_operation ON starter_social_delivery_packages (tenant_id, last_operation_id)",
        "CREATE INDEX idx_social_delivery_package_task ON starter_social_delivery_packages (tenant_id, task_id, created_at)"
      ]
    },
    {
      name: "starter_social_publications",
      fields: [
        text("tenant_id", true), text("publication_id", true), text("task_id", true), text("package_id", true),
        text("platform", true), text("account_label"), text("public_url"), text("platform_post_id"),
        text("published_at", true), text("notes"), text("status", true), text("created_operation_id", true), text("last_operation_id", true),
        text("created_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_publication_id ON starter_social_publications (tenant_id, publication_id)",
        "CREATE UNIQUE INDEX idx_social_publication_created_operation ON starter_social_publications (tenant_id, created_operation_id)",
        "CREATE UNIQUE INDEX idx_social_publication_operation ON starter_social_publications (tenant_id, last_operation_id)",
        "CREATE INDEX idx_social_publication_task ON starter_social_publications (tenant_id, task_id, published_at)"
      ]
    },
    {
      name: "starter_social_metric_submissions",
      fields: [
        text("tenant_id", true), text("submission_id", true), text("task_id", true), text("publication_id", true),
        text("method", true), text("captured_at", true), json("metrics", true, 131072),
        json("evidence_refs", true, 65536), text("notes"), text("status", true), text("version", true),
        text("created_operation_id", true), text("last_operation_id", true), text("created_by", true), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_metric_submission_id ON starter_social_metric_submissions (tenant_id, submission_id)",
        "CREATE UNIQUE INDEX idx_social_metric_created_operation ON starter_social_metric_submissions (tenant_id, created_operation_id)",
        "CREATE UNIQUE INDEX idx_social_metric_operation ON starter_social_metric_submissions (tenant_id, last_operation_id)",
        "CREATE INDEX idx_social_metric_publication ON starter_social_metric_submissions (tenant_id, publication_id, captured_at)"
      ]
    },
    {
      name: "starter_social_content_operations",
      fields: [
        text("tenant_id", true), text("operation_id", true), text("idempotency_key", true),
        text("request_hash", true), text("operation", true), text("target_id", true), text("status", true),
        json("result", true, 4096), text("error_code"), number("http_status"), text("created_by", true),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_content_operation_id ON starter_social_content_operations (tenant_id, operation_id)",
        "CREATE UNIQUE INDEX idx_social_content_operation_key ON starter_social_content_operations (tenant_id, idempotency_key)",
        "CREATE INDEX idx_social_content_operation_target ON starter_social_content_operations (tenant_id, target_id, created_at)"
      ]
    }
  ];

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const result = app.save(collection(spec.name, spec.fields, spec.indexes));
    if (index === specs.length - 1) return result;
  }
}, (app) => {
  const names = [
    "starter_social_content_operations", "starter_social_metric_submissions", "starter_social_publications",
    "starter_social_delivery_packages", "starter_social_content_artifacts", "starter_social_work_package_versions",
    "starter_social_task_sources", "starter_social_content_files", "starter_social_content_tasks"
  ];
  for (let index = 0; index < names.length; index += 1) {
    const result = app.delete(app.findCollectionByNameOrId(names[index]));
    if (index === names.length - 1) return result;
  }
});
