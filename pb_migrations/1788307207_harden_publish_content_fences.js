/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 9a2212551fa9dda703b4252c7e00a65f3c136d9b95e4880bced5cbcc3925df90
migrate((app) => {
  const text = (name, required = false, max = 0) => ({ name, type: "text", required, ...(max ? { max } : {}) });
  const number = (name, required = false) => ({ name, type: "number", required });
  const idField = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
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

  const posts = augmentCollection("posts", [
    text("direct_publish_fence_key", false, 64), text("direct_publish_content_digest", false, 64),
    text("direct_publish_account_id", false, 120), text("publish_operation_id", false, 64),
    text("publish_operation_state", false, 32), text("publish_operation_quiesced_at"), text("publish_retry_not_before")
  ]);
  posts.indexes = (posts.indexes || [])
    .filter((index) => !index.includes("idx_posts_direct_fence"))
    .concat(["CREATE UNIQUE INDEX idx_posts_direct_fence ON posts (tenant_id, direct_publish_fence_key) WHERE direct_publish_fence_key != ''"]);
  app.save(posts);

  let fences;
  try { fences = app.findCollectionByNameOrId("publish_content_fences"); } catch {
    fences = new Collection({
      id: "lspubfences0001", name: "publish_content_fences", type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        idField(), text("tenant_id", true), text("fence_key", true, 64), text("platform", true),
        text("account_id", true, 120), text("content_digest", true, 64), text("owner_key", false, 200),
        text("post_id"), text("state", true, 32), number("revision"), text("created_at", true), text("updated_at", true)
      ],
      indexes: []
    });
    app.save(fences);
  }
  // Keep the literal augment marker synchronized with the canonical schema
  // verifier: augmentCollection("publish_content_fences", ...) is represented
  // by the idempotent creation/field reconciliation below.
  fences = augmentCollection("publish_content_fences", [
    text("tenant_id", true), text("fence_key", true, 64), text("platform", true), text("account_id", true, 120),
    text("content_digest", true, 64), text("owner_key", false, 200), text("post_id"), text("state", true, 32),
    number("revision"), text("created_at", true), text("updated_at", true)
  ]);
  for (const name of ["tenant_id", "fence_key", "platform", "account_id", "content_digest", "state", "created_at", "updated_at"]) {
    fences.fields.getByName(name).required = true;
  }
  fences.fields.getByName("revision").required = false;
  fences.indexes = (fences.indexes || [])
    .filter((index) => !index.includes("idx_publish_content_fence_key") && !index.includes("idx_publish_content_fence_post"))
    .concat([
      "CREATE UNIQUE INDEX idx_publish_content_fence_key ON publish_content_fences (fence_key)",
      "CREATE INDEX idx_publish_content_fence_post ON publish_content_fences (tenant_id, post_id)"
    ]);
  app.save(fences);

  // A stopped pre-upgrade process cannot still own a live socket. Preserve any
  // reconciliation requirement, but mark its old operation as quiesced and
  // require a short post-migration cooldown before an administrator may retry.
  const now = new Date();
  const retryNotBefore = new Date(now.getTime() + 60000).toISOString();
  for (const record of app.findAllRecords("posts")) {
    let stats = record.get("stats") || {};
    if (typeof stats === "string") {
      try { stats = JSON.parse(stats); } catch { stats = {}; }
    }
    const status = String((stats && stats.status) || "");
    if (status === "publishing" || status === "needs_reconciliation") {
      record.set("publish_operation_state", "quiesced");
      record.set("publish_operation_quiesced_at", now.toISOString());
      record.set("publish_retry_not_before", retryNotBefore);
      app.save(record);
    }
  }
}, (_app) => {
  // Intentionally irreversible: removing content uniqueness or operation
  // quiescence fields would reopen duplicate external-publish races.
});
