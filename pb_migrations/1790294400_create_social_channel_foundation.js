/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const text = (name, required = false) => ({ name, type: "text", required });
  const json = (name, required = false, maxSize = 2097152) => ({ name, type: "json", required, maxSize });
  const number = (name, required = false) => ({ name, type: "number", required });
  const collection = (name, fields, indexes) => new Collection({
    name, type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [id(), ...fields], indexes
  });

  const specs = [
    {
      name: "social_channel_connections",
      fields: [
        text("tenant_id", true), text("connection_id", true), text("channel_id", true),
        text("account_id", true), text("credential_ref"), text("application_type", true),
        json("approved_scopes", true, 65536), text("token_type", true),
        text("account_qualification", true), text("application_review", true),
        text("real_account_e2e", true), text("assisted_browser_e2e", true),
        text("status", true), json("token_metadata", false, 65536),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_channel_connection_id ON social_channel_connections (tenant_id, connection_id)",
        "CREATE UNIQUE INDEX idx_social_channel_account ON social_channel_connections (tenant_id, channel_id, account_id)",
        "CREATE INDEX idx_social_channel_connection_status ON social_channel_connections (tenant_id, channel_id, status)"
      ]
    },
    {
      name: "social_publication_packages",
      fields: [
        text("tenant_id", true), text("package_id", true), text("idempotency_key", true),
        text("request_hash", true), text("content_id", true), text("content_version", true),
        text("content_hash", true), text("channel_id", true), text("target_account_id"),
        text("package_hash", true), text("status", true), json("manifest", true),
        json("evidence", false, 524288), text("created_by", true),
        text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_publication_package_id ON social_publication_packages (tenant_id, package_id)",
        "CREATE UNIQUE INDEX idx_social_publication_package_key ON social_publication_packages (tenant_id, idempotency_key)",
        "CREATE INDEX idx_social_publication_package_content ON social_publication_packages (tenant_id, content_id, channel_id, created_at)",
        "CREATE INDEX idx_social_publication_package_status ON social_publication_packages (tenant_id, status, updated_at)"
      ]
    },
    {
      name: "social_assisted_publish_sessions",
      fields: [
        text("tenant_id", true), text("session_id", true), text("package_id", true),
        text("channel_id", true), text("target_account_id", true), text("token_digest", true),
        text("status", true), json("session", true, 524288), text("expires_at", true),
        text("created_by", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_assisted_session_id ON social_assisted_publish_sessions (tenant_id, session_id)",
        "CREATE INDEX idx_social_assisted_session_package ON social_assisted_publish_sessions (tenant_id, package_id, status)",
        "CREATE INDEX idx_social_assisted_session_expiry ON social_assisted_publish_sessions (tenant_id, expires_at)"
      ]
    },
    {
      name: "social_external_contents",
      fields: [
        text("tenant_id", true), text("channel_id", true), text("account_id", true),
        text("external_content_id", true), text("source", true), text("status", true),
        text("public_url"), text("linked_package_id"), json("content", true, 524288),
        text("observed_at", true), text("created_at", true), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_external_content ON social_external_contents (tenant_id, channel_id, account_id, external_content_id, source)",
        "CREATE INDEX idx_social_external_content_observed ON social_external_contents (tenant_id, channel_id, account_id, observed_at)"
      ]
    },
    {
      name: "social_channel_metric_snapshots",
      fields: [
        text("tenant_id", true), text("snapshot_id", true), text("channel_id", true),
        text("account_id", true), text("external_content_id"), text("source", true),
        text("captured_at", true), text("freshness", true), json("snapshot", true, 524288)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_channel_metric_snapshot ON social_channel_metric_snapshots (tenant_id, snapshot_id)",
        "CREATE INDEX idx_social_channel_metric_history ON social_channel_metric_snapshots (tenant_id, channel_id, account_id, external_content_id, captured_at)"
      ]
    },
    {
      name: "social_channel_sync_cursors",
      fields: [
        text("tenant_id", true), text("channel_id", true), text("account_id", true),
        text("source", true), text("cursor_digest", true), json("cursor", true, 131072),
        text("last_successful_sync_at"), text("next_retry_at"), number("consecutive_failures", true),
        text("last_error_code"), text("updated_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_channel_sync_cursor ON social_channel_sync_cursors (tenant_id, channel_id, account_id, source)",
        "CREATE INDEX idx_social_channel_sync_retry ON social_channel_sync_cursors (tenant_id, next_retry_at)"
      ]
    },
    {
      name: "social_channel_oauth_states",
      fields: [
        text("tenant_id", true), text("state_id", true), text("user_id", true),
        text("state_digest", true), text("redirect_uri", true), text("status", true),
        text("expires_at", true), text("consumed_at"), text("created_at", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_channel_oauth_state ON social_channel_oauth_states (tenant_id, state_id)",
        "CREATE UNIQUE INDEX idx_social_channel_oauth_digest ON social_channel_oauth_states (tenant_id, state_digest)",
        "CREATE INDEX idx_social_channel_oauth_expiry ON social_channel_oauth_states (tenant_id, expires_at)"
      ]
    },
    {
      name: "social_channel_webhook_messages",
      fields: [
        text("tenant_id", true), text("connection_id", true), text("message_id", true),
        text("received_at", true), text("status", true), text("payload_digest", true)
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_channel_webhook_message ON social_channel_webhook_messages (tenant_id, connection_id, message_id)",
        "CREATE INDEX idx_social_channel_webhook_status ON social_channel_webhook_messages (tenant_id, status, received_at)"
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
    "social_channel_webhook_messages", "social_channel_oauth_states", "social_channel_sync_cursors",
    "social_channel_metric_snapshots", "social_external_contents", "social_assisted_publish_sessions",
    "social_publication_packages", "social_channel_connections"
  ];
  for (let index = 0; index < names.length; index += 1) {
    const result = app.delete(app.findCollectionByNameOrId(names[index]));
    if (index === names.length - 1) return result;
  }
});
