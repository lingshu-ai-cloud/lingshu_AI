/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: e08c07741cedb89ccbfff1da859bffe1a7e6f8a3faa4e44a4058813e5b52e909
//
// Materializes the small, globally indexed candidate set used by the scheduled
// publisher. Nested stats remain authoritative; this projection only narrows
// reads. Legacy rows are admitted fail-closed and ambiguous state is blocked.
migrate((app) => {
  const text = (name, required = false, max = 0) => ({
    name, type: "text", required, ...(max ? { max } : {})
  });
  const posts = app.findCollectionByNameOrId("posts");
  const findField = (name) => {
    try {
      const found = posts.fields.getByName(name);
      return found && found.name ? found : null;
    } catch {
      return null;
    }
  };

  for (const wanted of [text("publish_queue_state", false, 32), text("publish_available_at")]) {
    if (!findField(wanted.name)) {
      posts.fields.addAt(posts.fields.length, new Field({ ...wanted, required: false }));
    }
  }
  // PocketBase applies indexes before newly added fields when both are saved
  // together. Persist the columns before touching legacy rows or the index.
  app.save(posts);

  const statsOf = (record) => {
    // JSON fields are types.JSONRaw in JSVM. Unmarshal into a typed dynamic
    // model instead of treating the Go-backed value as a plain JS object.
    const stats = new DynamicModel({
      status: "", source: "", schedulePayloadHash: "", directPublish: false,
      publishAttempts: 0, nextPublishAttemptAt: "", lastPublishAttemptAt: ""
    });
    try { record.unmarshalJSONField("stats", stats); } catch {}
    return stats;
  };
  const time = (value) => {
    const parsed = Date.parse(String(value || "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const iso = (value) => new Date(value).toISOString();
  const maxTime = (values) => iso(Math.max(...values));
  const classify = (record) => {
    const stats = statsOf(record);
    const status = String(stats.status || "").trim();
    const source = String(stats.source || "").trim();
    const hash = String(stats.schedulePayloadHash || "").trim();
    const direct = stats.directPublish === true;
    const reconciles = record.getBool("reconciliation_required") || status === "needs_reconciliation";
    const platformPostId = record.getString("platform_post_id").trim();
    const scheduledAt = time(record.getString("published_at"));
    const attempts = Number(stats.publishAttempts || 0);
    const validAttempts = Number.isFinite(attempts) && attempts >= 0 && Math.floor(attempts) === attempts;

    if (reconciles || status === "on_hold" || status === "reserving") {
      return { state: "blocked", availableAt: "" };
    }
    if (platformPostId || ["published", "cancelled", "voided", "partial"].includes(status)) {
      return { state: "terminal", availableAt: "" };
    }
    if (direct && ["failed"].includes(status)) {
      return { state: "terminal", availableAt: "" };
    }
    if (direct && status === "publishing") {
      const available = [];
      const leaseExpiresAt = time(record.getString("publish_lease_expires_at"));
      const lastAttemptAt = time(stats.lastPublishAttemptAt);
      if (leaseExpiresAt !== null) available.push(leaseExpiresAt);
      if (lastAttemptAt !== null) available.push(lastAttemptAt + 15 * 60 * 1000);
      return available.length
        ? { state: "direct", availableAt: maxTime(available) }
        : { state: "blocked", availableAt: "" };
    }

    const validAdmission = !direct
      && ["manual", "digital_employee"].includes(source)
      && /^[a-f0-9]{64}$/.test(hash)
      && scheduledAt !== null;
    if (!validAdmission) return { state: "blocked", availableAt: "" };
    if (status === "failed" && (!validAttempts || attempts >= 3)) {
      return { state: "terminal", availableAt: "" };
    }

    if (status === "scheduled") {
      const available = [scheduledAt];
      const leaseExpiresAt = time(record.getString("publish_lease_expires_at"));
      if (record.getString("publish_lease_owner").trim() && leaseExpiresAt !== null) {
        available.push(leaseExpiresAt);
      }
      return { state: "pending", availableAt: maxTime(available) };
    }
    if (status === "failed" && validAttempts && attempts < 3) {
      const retryAt = time(stats.nextPublishAttemptAt);
      if (retryAt === null) return { state: "terminal", availableAt: "" };
      return { state: "pending", availableAt: maxTime([scheduledAt, retryAt]) };
    }
    if (status === "publishing") {
      const lastAttemptAt = time(stats.lastPublishAttemptAt);
      if (lastAttemptAt === null) return { state: "blocked", availableAt: "" };
      const available = [scheduledAt, lastAttemptAt + 15 * 60 * 1000];
      const leaseExpiresAt = time(record.getString("publish_lease_expires_at"));
      if (leaseExpiresAt !== null) available.push(leaseExpiresAt);
      return { state: "pending", availableAt: maxTime(available) };
    }
    return { state: "blocked", availableAt: "" };
  };

  // Avoid findAllRecords(posts): large production tables are traversed in
  // bounded, deterministic ID pages and each successfully classified page is
  // durable before the next page is loaded.
  let cursor = "";
  while (true) {
    const filter = cursor ? "id > {:cursor}" : "id != ''";
    const records = app.findRecordsByFilter("posts", filter, "id", 500, 0, cursor ? { cursor } : {});
    if (!records.length) break;
    for (const record of records) {
      const projected = classify(record);
      record.set("publish_queue_state", projected.state);
      record.set("publish_available_at", projected.availableAt);
      app.save(record);
    }
    const nextCursor = records[records.length - 1].getString("id");
    if (!nextCursor || nextCursor === cursor) throw new Error("posts publish queue migration cursor did not advance");
    cursor = nextCursor;
  }

  const queueIndex = "CREATE INDEX idx_posts_publish_queue ON posts (publish_queue_state, publish_available_at, id)";
  posts.indexes = (posts.indexes || [])
    .filter((index) => !String(index).includes("idx_posts_publish_queue"))
    .concat([queueIndex]);
  app.save(posts);
}, (_app) => {
  // Intentionally irreversible. Removing the fail-closed projection during a
  // rollback would force the publisher back to a full-table scan and could
  // re-admit ambiguous historical rows.
});
