/// <reference path="../pb_data/types.d.ts" />
// canonical-schema-fingerprint: 84c09d4f263f99bd307afc4ff0e6ce1bcf6817002a1892c235dd20f0bc7687c8
migrate((app) => {
  const text = (name, required = false) => ({ name, type: "text", required });
  const select = (name, values, required = false) => ({ name, type: "select", required, maxSelect: 1, values });
  const roles = ["super_admin", "admin", "social_operator", "customer_service"];
  const specs = [
    {
      name: "users",
      fields: [text("tenantId", true), select("role", roles, true)],
      indexes: ["CREATE UNIQUE INDEX idx_users_single_super_admin ON users (tenantId) WHERE role = 'super_admin'"]
    },
    {
      name: "tenants",
      fields: [
        text("inviteCode"), text("registrationInviteCode"), text("registeredEmail"), text("registeredAt"),
        text("registrationClaimToken"), text("registrationClaimedAt"), text("registrationClaimEmail")
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_tenants_active_invite ON tenants (inviteCode) WHERE inviteCode != ''",
        "CREATE UNIQUE INDEX idx_tenants_used_invite ON tenants (registrationInviteCode) WHERE registrationInviteCode != ''"
      ]
    }
  ];
  // Add fields as optional first; existing rows must be repaired before the
  // required constraints are enabled.
  for (const spec of specs) {
    const collection = app.findCollectionByNameOrId(spec.name);
    for (const wanted of spec.fields) {
      let existing;
      try { existing = collection.fields.getByName(wanted.name); } catch {}
      if (!existing) collection.fields.addAt(collection.fields.length, new Field({ ...wanted, required: false }));
    }
    app.save(collection);
  }

  const tenantRecords = app.findAllRecords("tenants");
  const tenantById = {};
  const tenantByRegistrationEmail = {};
  for (const tenant of tenantRecords) {
    const tenantId = String(tenant.id || "");
    tenantById[tenantId] = tenant;
    const email = String(tenant.get("registeredEmail") || "").trim().toLowerCase();
    if (!email) continue;
    if (tenantByRegistrationEmail[email]) {
      throw new Error("duplicate tenants registeredEmail prevents safe auth migration: " + email);
    }
    tenantByRegistrationEmail[email] = tenant;
  }

  let workbenchAdminEmail = "";
  try { workbenchAdminEmail = String($os.getenv("WORKBENCH_ADMIN_EMAIL") || "").trim().toLowerCase(); } catch {}
  const userRecords = app.findAllRecords("users");
  const plan = [];
  const superAdminsByTenant = {};
  for (const user of userRecords) {
    const email = String(user.get("email") || "").trim().toLowerCase();
    const registeredTenant = tenantByRegistrationEmail[email];
    const existingTenantId = String(user.get("tenantId") || "").trim();
    const tenantId = registeredTenant ? String(registeredTenant.id) : existingTenantId;
    if (!tenantId || !tenantById[tenantId]) {
      throw new Error("user has no verifiable tenantId and cannot be migrated safely: " + (email || user.id));
    }
    const currentRole = String(user.get("role") || "");
    const role = registeredTenant || (workbenchAdminEmail && email === workbenchAdminEmail)
      ? "super_admin"
      : roles.includes(currentRole)
        ? currentRole
        : "customer_service";
    if (role === "super_admin") {
      if (superAdminsByTenant[tenantId]) {
        throw new Error("tenant has multiple super_admin candidates: " + tenantId);
      }
      superAdminsByTenant[tenantId] = email || String(user.id);
    }
    plan.push({ user, tenantId, role });
  }
  for (const email of Object.keys(tenantByRegistrationEmail)) {
    const tenantId = String(tenantByRegistrationEmail[email].id);
    if (!superAdminsByTenant[tenantId]) {
      throw new Error("registered tenant has no matching super_admin user: " + tenantId);
    }
  }
  for (const item of plan) {
    item.user.set("tenantId", item.tenantId);
    item.user.set("role", item.role);
    app.save(item.user);
  }

  const hardenedUsers = app.findCollectionByNameOrId("users");
  hardenedUsers.fields.getByName("tenantId").required = true;
  hardenedUsers.fields.getByName("role").required = true;
  hardenedUsers.indexes = (hardenedUsers.indexes || [])
    .filter((index) => !index.includes("idx_users_single_super_admin"))
    .concat(specs[0].indexes);
  app.save(hardenedUsers);

  const hardenedTenants = app.findCollectionByNameOrId("tenants");
  hardenedTenants.indexes = (hardenedTenants.indexes || [])
    .filter((index) => !index.includes("idx_tenants_active_invite") && !index.includes("idx_tenants_used_invite"))
    .concat(specs[1].indexes);
  app.save(hardenedTenants);
}, (_app) => {
  // Intentionally irreversible. Removing required role/tenant ownership or
  // single-use invite indexes would reopen an authorization boundary.
});
