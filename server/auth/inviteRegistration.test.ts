import assert from 'node:assert/strict';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import {
  classifyInviteActivationEvidence,
  consumeInviteRegistration,
  inviteTenantRegistrationEligible,
  InviteRegistrationError,
} from './inviteRegistration.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Map<string, Record_>>();
  const collection = (name: string) => {
    let value = rows.get(name);
    if (!value) { value = new Map(); rows.set(name, value); }
    return value;
  };
  return {
    async getById<T = Record_>(name: string, id: string) { return (collection(name).get(id) as T) ?? null; },
    async create<T = Record_>(name: string, data: Record<string, unknown>) {
      const target = collection(name);
      if (name === 'durable_operation_leases') {
        const duplicate = [...target.values()].some(row => row.tenant_id === data.tenant_id
          && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id);
        if (duplicate) return null;
      }
      const row: Record_ = { ...data, id: `row-${target.size + 1}` };
      target.set(row.id, row);
      return row as T;
    },
    async update(name: string, id: string, data: Record<string, unknown>) {
      const row = collection(name).get(id);
      if (!row) return false;
      collection(name).set(id, { ...row, ...data }); return true;
    },
    async delete(name: string, id: string) { return collection(name).delete(id); },
    async list<T = Record_>(name: string, query: ListQuery = {}) {
      const items = [...collection(name).values()].filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value)) as T[];
      return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 20 };
    },
  };
}

const store = memoryStore();
assert.equal(inviteTenantRegistrationEligible({ subscriptionStatus: 'provisioning_pending' }), false);
assert.equal(inviteTenantRegistrationEligible({ subscriptionStatus: 'provisioning_failed' }), false);
assert.equal(inviteTenantRegistrationEligible({ subscriptionStatus: 'pending_delivery' }), true);
assert.equal(classifyInviteActivationEvidence({
  current: {
    inviteCode: '',
    registrationInviteCode: 'invite-1',
    registeredEmail: 'owner@example.test',
    registeredAt: '2026-09-14T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
  },
  inviteCode: 'invite-1',
  email: 'OWNER@example.test',
}), 'activated');
assert.equal(classifyInviteActivationEvidence({
  current: { inviteCode: 'invite-1' },
  inviteCode: 'invite-1',
  email: 'owner@example.test',
}), 'not_activated');
assert.equal(classifyInviteActivationEvidence({
  current: { inviteCode: '', registrationInviteCode: 'different-invite' },
  inviteCode: 'invite-1',
  email: 'owner@example.test',
}), 'unknown');
let releaseCreate!: () => void;
const createBlocked = new Promise<void>(resolve => { releaseCreate = resolve; });
let activeInvite = true;
let owners = 0;
const register = () => consumeInviteRegistration({
  dataStore: store,
  tenantId: 'tenant-1',
  readInvitedTenant: async () => activeInvite ? { id: 'tenant-1' } : null,
  createOwner: async () => { owners += 1; await createBlocked; return { id: `owner-${owners}` }; },
  loginOwner: async () => ({ token: 'token' }),
  activateTenant: async () => { activeInvite = false; return true; },
  readActivationEvidence: async () => activeInvite ? 'not_activated' : 'activated',
  deleteOwner: async () => true,
});

const winner = register();
await new Promise(resolve => setTimeout(resolve, 0));
await assert.rejects(register(), (error: unknown) => (
  error instanceof InviteRegistrationError && error.code === 'invite_registration_in_progress'
));
releaseCreate();
await winner;
assert.equal(owners, 1, 'one invite must never create two tenant owners concurrently');

let resumedCreates = 0;
await consumeInviteRegistration({
  dataStore: memoryStore(),
  tenantId: 'tenant-resume',
  readInvitedTenant: async () => ({ id: 'tenant-resume' }),
  readExistingOwner: async () => ({ id: 'owner-from-interrupted-attempt', email: 'same@example.test' }),
  acceptExistingOwner: owner => owner.email === 'same@example.test',
  createOwner: async () => { resumedCreates += 1; return { id: 'unexpected-owner' }; },
  loginOwner: async () => ({ token: 'resumed' }),
  activateTenant: async () => true,
  readActivationEvidence: async () => 'activated',
  deleteOwner: async () => true,
});
assert.equal(resumedCreates, 0, 'a retry after a crash must resume the existing Owner instead of creating another');

await assert.rejects(consumeInviteRegistration({
  dataStore: memoryStore(),
  tenantId: 'tenant-conflict',
  readInvitedTenant: async () => ({ id: 'tenant-conflict' }),
  readExistingOwner: async () => ({ id: 'different-owner', email: 'other@example.test' }),
  acceptExistingOwner: owner => owner.email === 'requested@example.test',
  createOwner: async () => ({ id: 'must-not-be-created' }),
  loginOwner: async () => ({ token: 'token' }),
  activateTenant: async () => true,
  readActivationEvidence: async () => 'activated',
  deleteOwner: async () => true,
}), (error: unknown) => error instanceof InviteRegistrationError
  && error.code === 'invite_registration_owner_conflict');

let commitLostDeletes = 0;
const commitLost = await consumeInviteRegistration({
  dataStore: memoryStore(),
  tenantId: 'tenant-commit-lost',
  readInvitedTenant: async () => ({ id: 'tenant-commit-lost' }),
  createOwner: async () => ({ id: 'owner-commit-lost' }),
  loginOwner: async () => ({ token: 'token-after-commit' }),
  activateTenant: async () => { throw new Error('response lost after commit'); },
  readActivationEvidence: async () => 'activated',
  deleteOwner: async () => { commitLostDeletes += 1; return true; },
});
assert.equal(commitLost.login.token, 'token-after-commit');
assert.equal(commitLostDeletes, 0, 'confirmed activation must retain the Owner after a lost response');

let unknownDeletes = 0;
await assert.rejects(consumeInviteRegistration({
  dataStore: memoryStore(),
  tenantId: 'tenant-activation-unknown',
  readInvitedTenant: async () => ({ id: 'tenant-activation-unknown' }),
  createOwner: async () => ({ id: 'owner-activation-unknown' }),
  loginOwner: async () => ({ token: 'token' }),
  activateTenant: async () => { throw new Error('response lost and authority unavailable'); },
  readActivationEvidence: async () => 'unknown',
  deleteOwner: async () => { unknownDeletes += 1; return true; },
}), (error: unknown) => error instanceof InviteRegistrationError
  && error.code === 'invite_activation_needs_attention');
assert.equal(unknownDeletes, 0, 'unknown activation must never destructively roll back the Owner');

await assert.rejects(consumeInviteRegistration({
  dataStore: memoryStore(),
  tenantId: 'tenant-rollback',
  readInvitedTenant: async () => ({ id: 'tenant-rollback' }),
  createOwner: async () => ({ id: 'owner-rollback' }),
  loginOwner: async () => ({ token: 'token' }),
  activateTenant: async () => { throw new Error('storage offline'); },
  readActivationEvidence: async () => 'not_activated',
  deleteOwner: async () => { throw new Error('delete offline'); },
}), (error: unknown) => (
  error instanceof InviteRegistrationError && error.code === 'invite_registration_rollback_failed'
));

console.log('invite registration lease and rollback contract passed');
