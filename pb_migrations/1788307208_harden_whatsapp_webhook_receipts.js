/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 482d9a01dd16c39dcb1428af551ca38c50c6d934d033abf4e684e550f890c067
migrate((app) => {
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const number = (name, required = false) => ({ name, type: "number", required });
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
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
  const augmentCollection = (name, id, fields) => {
    const target = ensureBaseCollection(name, id);
    for (const wanted of fields) {
      let existing;
      try { existing = target.fields.getByName(wanted.name); } catch {}
      if (!existing) target.fields.addAt(target.fields.length, new Field({ ...wanted, required: false }));
    }
    app.save(target);
    return target;
  };
  const wantedFields = [
    text("tenant_id", true), text("provider", true), text("message_id", true), text("status", true),
    number("revision"), text("received_at", true), text("updated_at", true), text("claim_expires_at"),
    text("completed_at"), text("last_error_code", false, 80), text("reconciled_at"), text("reconciled_by"),
    text("reconciliation_resolution", false, 40), text("reconciliation_note", false, 2000)
  ];
  const collection = augmentCollection("webhook_message_receipts", "lswhreceipts001", wantedFields);
  for (const name of ["tenant_id", "provider", "message_id", "status", "received_at", "updated_at"]) {
    collection.fields.getByName(name).required = true;
  }
  collection.fields.getByName("revision").required = false;
  collection.indexes = (collection.indexes || [])
    .filter((index) => !index.includes("idx_webhook_message_receipts_key") && !index.includes("idx_webhook_message_receipts_status"))
    .concat([
      "CREATE UNIQUE INDEX idx_webhook_message_receipts_key ON webhook_message_receipts (tenant_id, provider, message_id)",
      "CREATE INDEX idx_webhook_message_receipts_status ON webhook_message_receipts (status, claim_expires_at, updated_at)"
    ]);
  app.save(collection);

  const customers = augmentCollection("whatsapp_customers", "lswhcustomers01", [
    text("tenant_id", true), text("customer_id", true), text("wa_number", true), text("name"), text("stage"),
    number("last_active_at"), text("payload", true), number("persistence_revision", true), text("updated_at", true)
  ]);
  for (const record of app.findAllRecords("whatsapp_customers")) {
    let payload = record.get("payload") || {};
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { payload = {}; }
    }
    const revision = Math.max(1, Number(record.get("persistence_revision") || payload.persistenceRevision || 1));
    const updatedAt = String(record.get("updated_at") || payload.updatedAt || record.get("updated") || new Date().toISOString());
    record.set("persistence_revision", revision);
    record.set("updated_at", updatedAt);
    app.save(record);
  }
  for (const name of ["tenant_id", "customer_id", "wa_number", "payload", "persistence_revision", "updated_at"]) {
    customers.fields.getByName(name).required = true;
  }
  customers.indexes = (customers.indexes || [])
    .filter((index) => !index.includes("idx_whatsapp_customers_tenant_customer") && !index.includes("idx_whatsapp_customers_tenant_active"))
    .concat([
      "CREATE UNIQUE INDEX idx_whatsapp_customers_tenant_customer ON whatsapp_customers (tenant_id, customer_id)",
      "CREATE INDEX idx_whatsapp_customers_tenant_active ON whatsapp_customers (tenant_id, last_active_at)"
    ]);
  app.save(customers);

  const interactions = augmentCollection("whatsapp_interactions", "lswhinteract001", [
    text("tenant_id", true), text("interaction_id", true), text("customer_id", true), text("wa_number"),
    number("timestamp"), text("payload", true)
  ]);
  for (const name of ["tenant_id", "interaction_id", "customer_id", "payload"]) {
    interactions.fields.getByName(name).required = true;
  }
  interactions.indexes = (interactions.indexes || [])
    .filter((index) => !index.includes("idx_whatsapp_interactions_tenant_interaction") && !index.includes("idx_whatsapp_interactions_customer_time"))
    .concat([
      "CREATE UNIQUE INDEX idx_whatsapp_interactions_tenant_interaction ON whatsapp_interactions (tenant_id, interaction_id)",
      "CREATE INDEX idx_whatsapp_interactions_customer_time ON whatsapp_interactions (tenant_id, customer_id, timestamp)"
    ]);
  app.save(interactions);
}, (_app) => {
  // Intentionally irreversible: deleting durable receipts would allow old
  // Meta deliveries to repeat external side effects after a rollback.
});
