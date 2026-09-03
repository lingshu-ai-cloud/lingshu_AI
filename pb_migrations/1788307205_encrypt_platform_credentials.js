/// <reference path="../pb_data/types.d.ts" />
// Legacy platform credentials cannot be trusted or safely authenticated in a
// schema migration. They are revoked and cleared; operators must reconnect the
// account so the Node service can write an AAD-bound cred:v1 envelope.
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const number = (name, required = false) => ({ name, type: "number", required });
  const specs = [
    {
      name: "tenant_platform_apps",
      secretFields: ["app_secret", "access_token", "wecom_encoding_aes_key"],
      version: "credential_version",
      state: "credential_state",
      revision: "credential_revision",
      fields: [text("credential_version"), text("credential_state"), number("credential_revision")],
      reconnectStatus: "error",
      requiredWhenConnected: [],
      indexes: ["CREATE INDEX idx_tenant_platform_apps_credential_state ON tenant_platform_apps (credential_state)"]
    },
    {
      name: "youtube_accounts",
      secretFields: ["clientSecret", "refreshToken", "accessToken"],
      version: "credentialVersion",
      state: "credentialState",
      revision: "credentialRevision",
      fields: [text("credentialVersion"), text("credentialState"), number("credentialRevision")],
      reconnectStatus: "expired",
      requiredWhenConnected: ["clientSecret", "refreshToken"],
      indexes: [
        "CREATE UNIQUE INDEX idx_youtube_accounts_tenant_channel ON youtube_accounts (tenantId, channelId)",
        "CREATE INDEX idx_youtube_accounts_credential_state ON youtube_accounts (credentialState)"
      ]
    },
    {
      name: "social_accounts",
      secretFields: ["accessToken", "refreshToken"],
      version: "credentialVersion",
      state: "credentialState",
      revision: "credentialRevision",
      fields: [text("credentialVersion"), text("credentialState"), number("credentialRevision")],
      reconnectStatus: "expired",
      requiredWhenConnected: ["accessToken"],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_accounts_tenant_platform_provider ON social_accounts (tenantId, platform, providerAccountId)",
        "CREATE INDEX idx_social_accounts_credential_state ON social_accounts (credentialState)"
      ]
    }
  ];

  for (const spec of specs) {
    const collection = app.findCollectionByNameOrId(spec.name);
    const ensureField = (name, type) => {
      let existing;
      try { existing = collection.fields.getByName(name); } catch {}
      if (existing) return existing;
      const field = new Field({ name, type, required: false });
      collection.fields.addAt(collection.fields.length, field);
      return field;
    };
    for (const wanted of spec.fields) ensureField(wanted.name, wanted.type);
    for (const name of spec.secretFields) {
      try { collection.fields.getByName(name).hidden = true; } catch {}
    }
    // PocketBase applies collection indexes before newly-added columns when
    // both mutations are included in the same save. Persist the fields first
    // so fresh databases can create the credential-state indexes reliably.
    app.save(collection);
    collection.indexes = (collection.indexes || [])
      .filter((index) => !spec.indexes.some((wanted) => index.includes(wanted.split(" ON ")[0].replace("CREATE UNIQUE INDEX ", "").replace("CREATE INDEX ", ""))))
      .concat(spec.indexes);
    app.save(collection);

    for (const record of app.findAllRecords(spec.name)) {
      const invalid = spec.secretFields.some((field) => {
        const value = String(record.get(field) || "").trim();
        return value && !value.startsWith("cred:v1:");
      });
      const connected = String(record.get("status") || "") === "connected";
      const missingRequired = connected && spec.requiredWhenConnected.some((field) => {
        return !String(record.get(field) || "").startsWith("cred:v1:");
      });
      if (invalid || missingRequired) {
        for (const field of spec.secretFields) record.set(field, "");
        record.set("status", spec.reconnectStatus);
        record.set(spec.state, "reconnect_required");
      } else {
        record.set(spec.state, "ready");
      }
      record.set(spec.version, "cred:v1");
      record.set(spec.revision, Number(record.get(spec.revision) || 0));
      app.save(record);
    }
  }
}, (_app) => {
  // Intentionally irreversible: restoring fields or plaintext values would
  // weaken the credential boundary and cannot restore revoked provider tokens.
});
