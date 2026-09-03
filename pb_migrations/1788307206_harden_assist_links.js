/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 783a922cb399faaad87a44409a6d125100f780616e4fb2cb0c5be5919f5b07e4
migrate((app) => {
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const number = (name, required = false) => ({ name, type: "number", required });
  const augmentCollection = (name, fields) => {
    const collection = app.findCollectionByNameOrId(name);
    for (const wanted of fields) {
      let existing;
      try { existing = collection.fields.getByName(wanted.name); } catch {}
      if (!existing) collection.fields.addAt(collection.fields.length, new Field({ ...wanted, required: false }));
    }
    app.save(collection);
    return collection;
  };

  const collection = augmentCollection("assist_links", [
    text("token_hash", false, 64), text("token_prefix", false, 6), text("token_last4", false, 4),
    text("tenant_id", true), text("platform", true), text("status", true), text("expires_at", true),
    text("claimed_at"), text("claim_expires_at"), text("claim_nonce_hash", false, 64), text("used_at"),
    text("revoked_at"), text("created_by"), number("revision"), text("connected_account_id"),
    number("connected_account_count")
  ]);

  // Relax/remove the legacy plaintext constraint before clearing any values;
  // otherwise the first empty token violates required and the second violates
  // the old unique index.
  try { collection.fields.getByName("token").required = false; } catch {}
  collection.indexes = (collection.indexes || [])
    .filter((index) => !index.includes("idx_assist_links_token"));
  app.save(collection);

  // Previously issued plaintext capabilities are considered compromised by
  // construction. Revoke them instead of hashing them into still-valid links.
  const now = new Date().toISOString();
  const validStatuses = { pending: true, claimed: true, consumed: true, revoked: true };
  for (const record of app.findAllRecords("assist_links")) {
    const plaintext = String(record.get("token") || "");
    const tokenHash = String(record.get("token_hash") || "");
    const hardened = !plaintext && /^[a-f0-9]{64}$/.test(tokenHash);
    if (!hardened) {
      record.set("token", "");
      record.set("token_hash", "");
      record.set("token_prefix", "");
      record.set("token_last4", "");
      record.set("status", "revoked");
      record.set("revoked_at", now);
      record.set("claimed_at", "");
      record.set("claim_expires_at", "");
      record.set("claim_nonce_hash", "");
    } else if (!validStatuses[String(record.get("status") || "")]) {
      record.set("status", "revoked");
      record.set("revoked_at", now);
    }
    const revision = Number(record.get("revision") || 0);
    record.set("revision", Number.isFinite(revision) && revision >= 0 ? revision : 0);
    app.save(record);
  }

  // Keep the legacy column only so old databases can be migrated in place;
  // application code never writes or queries it after this migration.
  collection.fields.getByName("tenant_id").required = true;
  collection.fields.getByName("platform").required = true;
  collection.fields.getByName("status").required = true;
  collection.fields.getByName("expires_at").required = true;
  collection.fields.getByName("revision").required = false;
  collection.indexes = (collection.indexes || [])
    .filter((index) => !index.includes("idx_assist_links_token")
      && !index.includes("idx_assist_links_token_hash")
      && !index.includes("idx_assist_links_status_expiry")
      && !index.includes("idx_assist_links_tenant_created")
      && !index.includes("idx_assist_links_tenant_expiry"))
    .concat([
      "CREATE UNIQUE INDEX idx_assist_links_token_hash ON assist_links (token_hash) WHERE token_hash != ''",
      "CREATE INDEX idx_assist_links_status_expiry ON assist_links (status, expires_at, claim_expires_at)",
      "CREATE INDEX idx_assist_links_tenant_expiry ON assist_links (tenant_id, expires_at)"
    ]);
  app.save(collection);
}, (_app) => {
  // Intentionally irreversible: restoring plaintext capabilities or removing
  // single-consumer fencing would reopen an authentication boundary.
});
