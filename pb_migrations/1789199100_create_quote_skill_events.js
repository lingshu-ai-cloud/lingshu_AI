/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text_quote_event_id", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_event_tenant", "max": 0, "min": 0, "name": "tenant_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_event_customer", "max": 0, "min": 0, "name": "customer_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_event_quote", "max": 0, "min": 0, "name": "quote_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_event_actor", "max": 0, "min": 0, "name": "actor_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_event_action", "max": 0, "min": 0, "name": "action", "pattern": "^(created|updated|confirmed|reply_generated)$", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "number_quote_event_revision", "max": null, "min": 1, "name": "revision", "onlyInt": true, "presentable": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "json_quote_event_details", "maxSize": 100000, "name": "details", "presentable": false, "required": false, "system": false, "type": "json" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_quote_event_created", "max": 0, "min": 0, "name": "created_at", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" }
    ],
    "id": "pbc_quote_skill_events",
    "indexes": [
      "CREATE INDEX `idx_quote_event_quote` ON `quote_skill_events` (`tenant_id`, `quote_id`, `created_at`)",
      "CREATE INDEX `idx_quote_event_customer` ON `quote_skill_events` (`tenant_id`, `customer_id`, `created_at`)"
    ],
    "listRule": null,
    "name": "quote_skill_events",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId("pbc_quote_skill_events")));
