import assert from 'node:assert/strict';
import {
  parseAcquireAccountBody,
  parseAssignOwnerBody,
  parseCreateAccountBody,
  parseLocalReleaseBody,
  parseReassignOwnerBody,
} from './validation.js';

assert.deepEqual(parseCreateAccountBody({
  provider: 'codex', label: ' Main ', memberId: 'member_123',
}), {
  provider: 'codex', label: 'Main', memberId: 'member_123',
});
assert.throws(
  () => parseCreateAccountBody({ provider: 'codex', label: 'x', memberId: 'member_1', cookie: 'secret' }),
  /credential_material_not_accepted/,
);
assert.throws(() => parseCreateAccountBody({ provider: 'unknown', label: 'x', memberId: 'member_1' }), /invalid_provider/);
assert.throws(() => parseCreateAccountBody({ provider: 'codex', label: 'x' }), /invalid_member_id/);

assert.deepEqual(parseAcquireAccountBody({
  memberId: 'member_123', deviceId: 'macbook-pro:123', deviceLabel: ' Jiejie MacBook ',
}), {
  memberId: 'member_123', deviceId: 'macbook-pro:123', deviceLabel: 'Jiejie MacBook',
});
assert.throws(() => parseAcquireAccountBody({
  memberId: 'member_123', deviceId: 'bad/device', deviceLabel: 'Mac',
}), /invalid_device_id/);
assert.throws(() => parseAcquireAccountBody({
  memberId: 'member_123', deviceId: 'device_1', deviceLabel: 'Mac', accessToken: 'forbidden',
}), /credential_material_not_accepted/);

assert.throws(
  () => parseLocalReleaseBody({ memberId: 'member_123', deviceId: 'device_1' }),
  /invalid_lease_id/,
);
assert.deepEqual(parseLocalReleaseBody({ memberId: 'member_123', deviceId: 'device_1', leaseId: 'lease_1' }), {
  memberId: 'member_123', deviceId: 'device_1', leaseId: 'lease_1',
});
assert.throws(() => parseLocalReleaseBody({ memberId: 'member_123' }), /invalid_device_id/);
assert.deepEqual(parseAssignOwnerBody({ memberId: 'member_123' }), { memberId: 'member_123' });
assert.throws(() => parseAssignOwnerBody({ memberId: 'member_123', provider: 'codex' }), /unsupported_field/);
assert.deepEqual(parseReassignOwnerBody({ memberId: 'member_456' }), { memberId: 'member_456' });
assert.throws(
  () => parseReassignOwnerBody({ memberId: 'member_456', refreshToken: 'forbidden' }),
  /credential_material_not_accepted/,
);
assert.throws(() => parseReassignOwnerBody({ memberId: '../escape' }), /invalid_member_id/);
