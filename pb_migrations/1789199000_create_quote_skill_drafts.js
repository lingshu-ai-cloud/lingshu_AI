/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text_quote_skill_id", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_skill_tenant", "max": 0, "min": 0, "name": "tenant_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_skill_customer", "max": 0, "min": 0, "name": "customer_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_skill_status", "max": 0, "min": 0, "name": "status", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "json_quote_skill_payload", "maxSize": 500000, "name": "payload", "presentable": false, "required": true, "system": false, "type": "json" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_skill_created_by", "max": 0, "min": 0, "name": "created_by", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_skill_updated", "max": 0, "min": 0, "name": "updated_at", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" }
    ],
    "id": "pbc_quote_skill_drafts",
    "indexes": [
      "CREATE INDEX `idx_quote_skill_customer` ON `quote_skill_drafts` (`tenant_id`, `customer_id`, `updated_at`)",
      "CREATE INDEX `idx_quote_skill_status` ON `quote_skill_drafts` (`tenant_id`, `status`)"
    ],
    "listRule": null,
    "name": "quote_skill_drafts",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId("pbc_quote_skill_drafts")));
