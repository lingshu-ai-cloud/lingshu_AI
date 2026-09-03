// Transactional datastore primitives used by the Node workers. PocketBase
// executes route callbacks in a pooled JS runtime, so every callback is
// deliberately self-contained instead of closing over module-level helpers.

routerAdd("POST", "/api/lingshu/atomic/compare-and-set/{collection}/{id}", (e) => {
  const allowed = {
    digital_employee_configs: true, weekly_goals: true, weekly_plans: true, execution_contracts: true,
    workflow_runs: true, workflow_tasks: true, run_events: true, approval_requests: true,
    handoff_sessions: true, weekly_reviews: true, digital_employee_outbox: true,
    outbound_action_ledger: true, work_items: true, scripts: true, studio_projects: true, posts: true,
    tenants: true, users: true, crawl_jobs: true, tenant_api_keys: true,
    tenant_platform_apps: true, youtube_accounts: true, social_accounts: true, assist_links: true,
    publish_content_fences: true, webhook_message_receipts: true,
    whatsapp_customers: true, whatsapp_interactions: true,
    auth_sessions: true, oauth_transactions: true, social_comment_states: true,
    social_reply_operations: true, whatsapp_outbound_operations: true, whatsapp_delivery_receipts: true
  };
  const collection = e.request.pathValue("collection");
  const id = e.request.pathValue("id");
  if (!allowed[collection]) throw new ForbiddenError("Collection is not enabled for atomic operations");
  const body = e.requestInfo().body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("JSON object body is required");
  const system = { id: true, collectionId: true, collectionName: true, created: true, updated: true };
  const validateFields = (value, label, allowEmpty, scalarOnly) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError(label + " must be an object");
    const keys = Object.keys(value);
    if (!allowEmpty && keys.length === 0) throw new BadRequestError(label + " must not be empty");
    for (const key of keys) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || system[key]) throw new BadRequestError("Invalid field in " + label);
      const item = value[key];
      if (scalarOnly && !["string", "number", "boolean"].includes(typeof item)) throw new BadRequestError(label + " values must be scalar");
    }
    return keys;
  };
  const expectedKeys = validateFields(body.expected, "expected", false, true);
  const dataKeys = validateFields(body.data, "data", false, false);
  let result = { status: 404, body: { reason: "not_found" } };

  e.app.runInTransaction((txApp) => {
    const records = txApp.findRecordsByFilter(collection, "id = {:id}", "", 1, 0, { id });
    if (!records.length) return;
    const record = records[0];
    for (const key of expectedKeys) {
      const expected = body.expected[key];
      const actual = record.get(key);
      const matches = typeof expected === "boolean"
        ? Boolean(actual) === expected
        : typeof expected === "number"
          ? Number(actual) === expected
          : String(actual == null ? "" : actual) === expected;
      if (!matches) {
        result = { status: 409, body: { reason: "conflict", current: record } };
        return;
      }
    }
    for (const key of dataKeys) record.set(key, body.data[key]);
    txApp.save(record);
    result = { status: 200, body: { record } };
  });

  return e.json(result.status, result.body);
}, $apis.requireSuperuserAuth(), $apis.bodyLimit(2097152));

routerAdd("POST", "/api/lingshu/atomic/create-if-absent/{collection}", (e) => {
  const allowed = {
    digital_employee_configs: true, weekly_goals: true, weekly_plans: true, execution_contracts: true,
    workflow_runs: true, workflow_tasks: true, run_events: true, approval_requests: true,
    handoff_sessions: true, weekly_reviews: true, digital_employee_outbox: true,
    outbound_action_ledger: true, work_items: true, scripts: true, studio_projects: true, posts: true,
    tenants: true, users: true, crawl_jobs: true, tenant_api_keys: true,
    tenant_platform_apps: true, youtube_accounts: true, social_accounts: true, assist_links: true,
    publish_content_fences: true, webhook_message_receipts: true,
    whatsapp_customers: true, whatsapp_interactions: true,
    auth_sessions: true, oauth_transactions: true, social_comment_states: true,
    social_reply_operations: true, whatsapp_outbound_operations: true, whatsapp_delivery_receipts: true
  };
  const collection = e.request.pathValue("collection");
  if (!allowed[collection]) throw new ForbiddenError("Collection is not enabled for atomic operations");
  const body = e.requestInfo().body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("JSON object body is required");
  const system = { id: true, collectionId: true, collectionName: true, created: true, updated: true };
  const validateFields = (value, label, allowEmpty, scalarOnly) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError(label + " must be an object");
    const keys = Object.keys(value);
    if (!allowEmpty && keys.length === 0) throw new BadRequestError(label + " must not be empty");
    for (const key of keys) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || system[key]) throw new BadRequestError("Invalid field in " + label);
      const item = value[key];
      if (scalarOnly && !["string", "number", "boolean"].includes(typeof item)) throw new BadRequestError(label + " values must be scalar");
    }
    return keys;
  };
  const whereKeys = validateFields(body.uniqueWhere, "uniqueWhere", false, true);
  const dataKeys = validateFields(body.data, "data", true, false);
  let result;

  e.app.runInTransaction((txApp) => {
    const params = {};
    const clauses = [];
    for (let index = 0; index < whereKeys.length; index += 1) {
      const key = whereKeys[index];
      const param = "value" + index;
      clauses.push(key + " = {:" + param + "}");
      params[param] = body.uniqueWhere[key];
    }
    const existing = txApp.findRecordsByFilter(collection, clauses.join(" && "), "", 1, 0, params);
    if (existing.length) {
      result = { created: false, record: existing[0] };
      return;
    }
    const record = new Record(txApp.findCollectionByNameOrId(collection));
    for (const key of dataKeys) record.set(key, body.data[key]);
    for (const key of whereKeys) record.set(key, body.uniqueWhere[key]);
    txApp.save(record);
    result = { created: true, record };
  });

  return e.json(200, result);
}, $apis.requireSuperuserAuth(), $apis.bodyLimit(2097152));
