import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { credentialFingerprint, DurableCredentialQuarantine } from './providerCredentialQuarantine.js';

test('a rejected credential remains quarantined after a process restart without persisting the secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-quarantine-'));
  try {
    const file = path.join(root, 'provider.json');
    const secret = 'provider-secret-never-persist';
    const fingerprint = credentialFingerprint(secret);
    const firstProcess = new DurableCredentialQuarantine(() => file, () => new Date('2026-10-14T04:00:00.000Z'));
    firstProcess.remember(fingerprint);
    assert.equal(firstProcess.isRejected(fingerprint), true);

    const restartedProcess = new DurableCredentialQuarantine(() => file);
    assert.equal(restartedProcess.isRejected(fingerprint), true);
    assert.equal(fs.readFileSync(file, 'utf8').includes(secret), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rotating or successfully validating a credential restores provider eligibility', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-rotation-'));
  try {
    const file = path.join(root, 'provider.json');
    const rejected = credentialFingerprint('rejected-key');
    const rotated = credentialFingerprint('rotated-key');
    const quarantine = new DurableCredentialQuarantine(() => file);
    quarantine.remember(rejected);
    assert.equal(quarantine.isRejected(rotated), false);
    quarantine.clear(rejected);
    assert.equal(new DurableCredentialQuarantine(() => file).isRejected(rejected), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unavailable or malformed persistence fails open while the current process stays protected', () => {
  const fingerprint = credentialFingerprint('bad-key');
  const quarantine = new DurableCredentialQuarantine(() => { throw new Error('tenant context unavailable'); });
  quarantine.remember(fingerprint);
  assert.equal(quarantine.isRejected(fingerprint), true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-malformed-'));
  try {
    const file = path.join(root, 'provider.json');
    fs.writeFileSync(file, '{not-json', 'utf8');
    assert.equal(new DurableCredentialQuarantine(() => file).isRejected(fingerprint), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
