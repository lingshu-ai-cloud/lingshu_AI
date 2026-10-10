migrate((app) => {
  app.save(new Collection({ name: "review_todo_boards", type: "base", system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [{ name: "id", type: "text", system: true, required: true, primaryKey: true, autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$" }, { name: "tenant_id", type: "text", required: true }, { name: "week", type: "text", required: true }, { name: "auto_assign", type: "bool" }, { name: "payload", type: "json", maxSize: 1048576 }],
    indexes: ["CREATE UNIQUE INDEX idx_review_todos_tenant_week ON review_todo_boards (tenant_id, week)", "CREATE INDEX idx_review_todos_due ON review_todo_boards (auto_assign)"]
  }));
}, (app) => { app.delete(app.findCollectionByNameOrId("review_todo_boards")); });
