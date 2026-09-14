/// <reference path="../pb_data/types.d.ts" />

// Versioned source of truth for the advertising workspace schema. Older
// deployments may already have these collections because application startup
// used to create them imperatively, so the forward migration also adopts and
// completes an existing collection instead of assuming an empty database.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required });
  const json = (name, required = false) => ({ name, type: "json", required });
  const bool = (name, required = false) => ({ name, type: "bool", required });
  const select = (name, values, required = false) => ({ name, type: "select", required, values });
  const autodate = (name, onCreate, onUpdate) => ({ name, type: "autodate", required: false, onCreate, onUpdate });
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });

  const specs = [
    {
      name: "platform_ad_imports",
      fields: [
        ...["tenant_id", "provider", "accountId", "connectionId", "campaignId", "taskId", "status", "capability", "createdAt", "updatedAt"].map(name => text(name)),
        json("providerSnapshot")
      ],
      indexes: []
    },
    {
      name: "platform_ad_launches",
      fields: [
        ...["tenant_id", "taskId", "connectionId", "status", "createdAt", "updatedAt", "error"].map(name => text(name)),
        select("launchMode", ["create_paused", "create_and_activate"]),
        number("taskVersion"), json("meta"), json("receipt")
      ],
      indexes: []
    },
    {
      name: "platform_ad_approvals",
      fields: [
        ...["tenant_id", "taskId", "status", "createdBy", "decidedBy", "createdAt", "expiresAt", "updatedAt", "error"].map(name => text(name)),
        number("taskVersion"), json("payload"), json("receipt")
      ],
      indexes: []
    },
    {
      name: "platform_ad_oauth_states",
      fields: [
        ...["tenant_id", "userId", "stateHash", "expiresAt", "status", "tokenCipher"].map(name => text(name)),
        json("accounts")
      ],
      indexes: []
    },
    {
      name: "platform_ad_automation_rules",
      fields: [
        ...["tenant_id", "taskId", "connectionId", "resourceId", "updatedAt"].map(name => text(name, true)),
        ...["targetCpc", "minClicks", "cooldownMinutes", "maxMetricAgeMinutes"].map(name => number(name, true)),
        bool("enabled")
      ],
      indexes: []
    },
    {
      name: "platform_ad_automation_runs",
      fields: [
        ...["tenant_id", "taskId", "ruleId", "status", "reason", "createdAt"].map(name => text(name)),
        json("metrics"), json("receipt")
      ],
      indexes: []
    },
    {
      name: "platform_ad_executions",
      fields: [
        number("expectedDailyBudget"), text("tenant_id", true), text("taskId", true),
        text("requestId", true), text("action", true), text("connectionId", true),
        text("resourceId"), text("status", true), text("createdAt", true), text("error"),
        json("result")
      ],
      indexes: []
    },
    {
      name: "platform_ad_handoffs",
      fields: [
        text("tenant_id", true), text("goalId", true), text("adTaskId"), text("objective"),
        text("evidence"), text("expectedOutcome"), json("constraints"), text("createdAt"),
        text("createdBy")
      ],
      indexes: []
    },
    {
      name: "platform_ad_connections",
      fields: [
        text("tenant_id", true), text("provider", true), text("accountId", true),
        text("name"), text("currency"), text("tokenCipher"), text("status"), text("updatedAt")
      ],
      indexes: []
    },
    {
      name: "platform_ad_tasks",
      fields: [
        number("version"), json("authorization"), json("proposal"), json("sourceContext"),
        json("managementHistory"), text("creationSource"), text("managementMode"), json("configuration"),
        text("tenant_id", true), text("created_by", true), text("name", true), text("video", true),
        text("goal", true), text("market", true), number("budget", true),
        select("currency", ["USD", "CNY"], true), json("channels", true),
        select("status", ["draft", "paused", "active", "error", "unknown"], true),
        text("createdAt", true), text("updatedAt", true),
        autodate("created", true, false), autodate("updated", true, true)
      ],
      indexes: []
    }
  ];

  const findCollection = (name) => {
    try { return app.findCollectionByNameOrId(name); } catch { return null; }
  };
  const findField = (collection, name) => {
    try { return collection.fields.getByName(name); } catch { return null; }
  };
  const addOrNormalizeField = (collection, definition, collectionIndex, fieldIndex) => {
    const existing = findField(collection, definition.name);
    if (!existing) {
      collection.fields.addAt(collection.fields.length, new Field({
        id: `pad_${String(collectionIndex).padStart(2, "0")}_${String(fieldIndex).padStart(2, "0")}`,
        ...definition
      }));
      return;
    }
    if (existing.type !== definition.type) {
      throw new Error(`${collection.name}.${definition.name} must be ${definition.type}, found ${existing.type}`);
    }
    existing.required = Boolean(definition.required);
    if (definition.type === "select") existing.values = [...definition.values];
    if (definition.type === "autodate") {
      existing.onCreate = Boolean(definition.onCreate);
      existing.onUpdate = Boolean(definition.onUpdate);
    }
  };

  let result;
  for (let collectionIndex = 0; collectionIndex < specs.length; collectionIndex += 1) {
    const spec = specs[collectionIndex];
    let collection = findCollection(spec.name);
    if (!collection) {
      collection = new Collection({
        name: spec.name,
        type: "base",
        system: false,
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [id(), ...spec.fields],
        indexes: spec.indexes
      });
    } else {
      for (let fieldIndex = 0; fieldIndex < spec.fields.length; fieldIndex += 1) {
        addOrNormalizeField(collection, spec.fields[fieldIndex], collectionIndex, fieldIndex);
      }
      const indexes = collection.indexes || [];
      collection.indexes = [...indexes, ...spec.indexes.filter(index => !indexes.includes(index))];
    }
    result = app.save(collection);
  }
  return result;
}, (app) => {
  const names = [
    "platform_ad_tasks", "platform_ad_connections", "platform_ad_handoffs",
    "platform_ad_executions", "platform_ad_automation_runs", "platform_ad_automation_rules",
    "platform_ad_oauth_states", "platform_ad_approvals", "platform_ad_launches",
    "platform_ad_imports"
  ];
  let result;
  for (const name of names) {
    try { result = app.delete(app.findCollectionByNameOrId(name)); } catch {}
  }
  return result;
});
