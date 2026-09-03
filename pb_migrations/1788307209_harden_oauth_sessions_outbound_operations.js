/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 6637d3d8a4fad0b6e0c2ea43d706f2c86adc928c72af20eec09cb3a47e11ba56
//
// Adds the durable state required for one-shot OAuth callbacks, server-side
// session revocation, and idempotent provider writes. Legacy Meta verification
// tokens remain usable after being one-way hashed. Legacy WeCom callback
// secrets are revoked because only the Node service can create an AAD-bound
// credential envelope.
migrate((app) => {
  const text = (name, required = false, max = 0, hidden = false) => ({
    name, type: "text", required, ...(max ? { max } : {}), ...(hidden ? { hidden: true } : {})
  });
  const number = (name, required = false) => ({ name, type: "number", required });
  const json = (name, required = false, maxSize = 524288) => ({ name, type: "json", required, maxSize });
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const findField = (collection, name) => {
    try {
      const found = collection.fields.getByName(name);
      return found && found.name ? found : null;
    } catch {
      return null;
    }
  };
  const ensureBaseCollection = (name, id) => {
    try { return app.findCollectionByNameOrId(name); } catch {
      const created = new Collection({
        id, name, type: "base", system: false,
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        fields: [idField()], indexes: []
      });
      app.save(created);
      return created;
    }
  };
  const indexName = (index) => {
    const match = String(index).match(/CREATE(?:\s+UNIQUE)?\s+INDEX\s+[`\"]?([^\s`\"]+)/i);
    return match ? match[1] : String(index);
  };
  const augmentCollection = (name, id, fields, indexes) => {
    const target = ensureBaseCollection(name, id);
    for (const wanted of fields) {
      let current = findField(target, wanted.name);
      if (!current) {
        target.fields.addAt(target.fields.length, new Field({ ...wanted, required: false }));
        current = findField(target, wanted.name);
      }
      if (!current) throw new Error("failed to add field " + name + "." + wanted.name);
      if (wanted.max) current.max = wanted.max;
      if (wanted.maxSize) current.maxSize = wanted.maxSize;
      if (wanted.hidden) current.hidden = true;
    }
    // PocketBase creates indexes before newly-added fields when both are part
    // of one save, so persist fields first and indexes second.
    app.save(target);
    for (const wanted of fields) target.fields.getByName(wanted.name).required = Boolean(wanted.required);
    const replaced = {};
    for (const wanted of indexes) replaced[indexName(wanted)] = true;
    target.indexes = (target.indexes || []).filter((index) => !replaced[indexName(index)]).concat(indexes);
    app.save(target);
    return target;
  };

  const users = app.findCollectionByNameOrId("users");
  if (!findField(users, "session_epoch")) users.fields.addAt(users.fields.length, new Field(number("session_epoch")));
  users.fields.getByName("session_epoch").required = false;
  app.save(users);

  const tenantApps = augmentCollection("tenant_platform_apps", "pbc_tenant_platform_apps", [
    text("tenant_id", true), text("platform", true), text("app_id"), text("app_secret", false, 0, true),
    text("wa_config_id"), text("business_id"), text("waba_id"), text("phone_number_id"), text("wa_public_number"),
    text("page_id"), text("ig_user_id"), text("youtube_channel_id"),
    text("webhook_verify_token", false, 0, true), text("wecom_encoding_aes_key", false, 0, true),
    text("token_type"), text("access_token", false, 0, true), text("token_expires_at"), text("status"),
    text("last_checklist"), text("notes"), text("credential_version"), text("credential_state"),
    number("credential_revision")
  ], [
    "CREATE UNIQUE INDEX idx_tenant_platform_apps_unique ON tenant_platform_apps (tenant_id, platform)",
    "CREATE INDEX idx_tenant_platform_apps_status ON tenant_platform_apps (status)",
    "CREATE INDEX idx_tenant_platform_apps_credential_state ON tenant_platform_apps (credential_state)"
  ]);

  augmentCollection("auth_sessions", "lsauthsession01", [
    text("token_hash", true, 64, true), text("user_id", true), text("tenant_id", true), text("status", true),
    number("session_epoch"), text("expires_at", true), text("revoked_at"), number("revision"),
    text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_auth_sessions_token_hash ON auth_sessions (token_hash)",
    "CREATE INDEX idx_auth_sessions_tenant_user_status ON auth_sessions (tenant_id, user_id, status)",
    "CREATE INDEX idx_auth_sessions_status_expiry ON auth_sessions (status, expires_at)"
  ]);

  augmentCollection("oauth_transactions", "lsoauthtrans001", [
    text("state_hash", true, 64, true), text("tenant_id", true), text("user_id", true), text("platform", true),
    text("return_to", true, 2000), text("status", true), text("expires_at", true), text("consumed_at"),
    number("revision"), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_oauth_transactions_state_hash ON oauth_transactions (state_hash)",
    "CREATE INDEX idx_oauth_transactions_status_expiry ON oauth_transactions (status, expires_at)",
    "CREATE INDEX idx_oauth_transactions_actor ON oauth_transactions (tenant_id, user_id, platform)"
  ]);

  augmentCollection("social_comment_states", "pbc_social_comment_states", [
    text("tenantId", true), text("key", true), text("status", true), json("analysis", false, 200000),
    text("repliedAt"), text("replyId"), text("updatedAt", true), number("revision")
  ], [
    "CREATE UNIQUE INDEX idx_social_comment_state_key ON social_comment_states (tenantId, key)",
    "CREATE INDEX idx_social_comment_state_status ON social_comment_states (tenantId, status)"
  ]);

  const outboundFields = () => [
    text("tenant_id", true), text("idempotency_key", true, 200), text("operation_type", true),
    text("target_id", true), text("payload_hash", true, 64), text("status", true),
    json("provider_message_ids"), json("result"), text("last_error_code", false, 80), number("revision"),
    text("created_at", true), text("updated_at", true), text("completed_at")
  ];
  augmentCollection("social_reply_operations", "lssocialreply01", outboundFields(), [
    "CREATE UNIQUE INDEX idx_social_reply_operations_idempotency ON social_reply_operations (tenant_id, idempotency_key)",
    "CREATE INDEX idx_social_reply_operations_status ON social_reply_operations (status, updated_at)"
  ]);
  augmentCollection("whatsapp_outbound_operations", "lswaoutbound001", outboundFields().concat([
    text("delivery_status"), text("delivery_updated_at")
  ]), [
    "CREATE UNIQUE INDEX idx_whatsapp_outbound_operations_idempotency ON whatsapp_outbound_operations (tenant_id, idempotency_key)",
    "CREATE INDEX idx_whatsapp_outbound_operations_status ON whatsapp_outbound_operations (status, updated_at)"
  ]);
  augmentCollection("whatsapp_delivery_receipts", "lswareceipts001", [
    text("tenant_id", true), text("provider_message_id", true), text("outbound_operation_id"), text("status", true),
    text("provider_timestamp"), text("recipient_hash", false, 64), text("error_code", false, 80),
    number("revision"), text("created_at", true), text("updated_at", true)
  ], [
    "CREATE UNIQUE INDEX idx_whatsapp_delivery_receipts_provider ON whatsapp_delivery_receipts (tenant_id, provider_message_id)",
    "CREATE INDEX idx_whatsapp_delivery_receipts_status ON whatsapp_delivery_receipts (status, updated_at)",
    "CREATE INDEX idx_whatsapp_delivery_receipts_operation ON whatsapp_delivery_receipts (tenant_id, outbound_operation_id)"
  ]);

  for (const record of app.findAllRecords("tenant_platform_apps")) {
    const platform = String(record.get("platform") || "");
    const verifyToken = String(record.get("webhook_verify_token") || "").trim();
    let changed = false;
    let reconnect = false;
    if (platform === "meta" && verifyToken && !/^sha256:[a-f0-9]{64}$/i.test(verifyToken)) {
      record.set("webhook_verify_token", "sha256:" + $security.sha256(verifyToken));
      changed = true;
    } else if (platform === "wecom" && verifyToken && !verifyToken.startsWith("cred:v1:")) {
      record.set("webhook_verify_token", "");
      changed = true;
      reconnect = true;
    } else if (platform !== "meta" && platform !== "wecom" && verifyToken) {
      record.set("webhook_verify_token", "");
      changed = true;
      reconnect = true;
    }
    for (const secretName of ["app_secret", "access_token", "wecom_encoding_aes_key"]) {
      const secret = String(record.get(secretName) || "").trim();
      if (secret && !secret.startsWith("cred:v1:")) {
        record.set(secretName, "");
        changed = true;
        reconnect = true;
      }
    }
    if (reconnect) {
      record.set("status", "error");
      record.set("credential_state", "reconnect_required");
    } else if (!String(record.get("credential_state") || "")) {
      record.set("credential_state", "ready");
      changed = true;
    }
    if (String(record.get("credential_version") || "") !== "cred:v1") {
      record.set("credential_version", "cred:v1");
      changed = true;
    }
    if (changed) {
      record.set("credential_revision", Number(record.get("credential_revision") || 0) + 1);
      app.save(record);
    }
  }

  // Re-read to make the hidden flags explicit even if the fields predated this
  // migration and were constructed from an older collection snapshot.
  for (const name of ["app_secret", "access_token", "webhook_verify_token", "wecom_encoding_aes_key"]) {
    tenantApps.fields.getByName(name).hidden = true;
  }
  app.save(tenantApps);
}, (_app) => {
  // Intentionally irreversible. Restoring callback plaintext, consumed OAuth
  // state, revoked sessions, or completed outbound operations would reopen
  // replay and duplicate-provider-write vulnerabilities.
});
