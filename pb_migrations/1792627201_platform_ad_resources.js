/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const text = (name) => ({ name, type: "text", required: false });
  const json = (name) => ({ name, type: "json", required: false });
  const id = () => ({
    name: "id", type: "text", system: true, required: true, primaryKey: true,
    autogeneratePattern: "[a-z0-9]{15}", min: 15, max: 15, pattern: "^[a-z0-9]+$"
  });
  const names = ["platform_ad_campaigns", "platform_ad_adsets", "platform_ad_ads"];
  let result;
  for (const name of names) {
    try { app.findCollectionByNameOrId(name); continue; } catch {}
    result = app.save(new Collection({
      name, type: "base", system: false,
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [id(), ...["tenant_id", "provider", "connectionId", "accountId", "providerResourceId", "level", "parentResourceId", "campaignId", "adsetId", "name", "configuredStatus", "effectiveStatus", "currency", "accountTimezone", "syncRunId", "lastSyncedAt"].map(text), json("providerSnapshot")],
      indexes: [
        `CREATE UNIQUE INDEX idx_${name}_identity ON ${name} (tenant_id, connectionId, providerResourceId, syncRunId)`,
        `CREATE INDEX idx_${name}_connection ON ${name} (tenant_id, connectionId)`
      ]
    }));
  }
  return result;
}, (app) => {
  let result;
  for (const name of ["platform_ad_ads", "platform_ad_adsets", "platform_ad_campaigns"]) {
    try { result = app.delete(app.findCollectionByNameOrId(name)); } catch {}
  }
  return result;
});
