import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dashscopeApiKey } from './qwen.js';

test('DashScope key uses environment first and falls back to a local secret file', () => {
  const priorKey = process.env.DASHSCOPE_API_KEY;
  const priorFile = process.env.DASHSCOPE_API_KEY_FILE;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-qwen-key-'));
  const keyFile = path.join(directory, 'key');
  try {
    fs.writeFileSync(keyFile, 'file-test-key\n', { mode: 0o600 });
    process.env.DASHSCOPE_API_KEY_FILE = keyFile;
    process.env.DASHSCOPE_API_KEY = 'env-test-key';
    assert.equal(dashscopeApiKey(), 'env-test-key');
    delete process.env.DASHSCOPE_API_KEY;
    assert.equal(dashscopeApiKey(), 'file-test-key');
    fs.rmSync(keyFile);
    assert.throws(() => dashscopeApiKey(), /DASHSCOPE_API_KEY is not set/);
  } finally {
    if (priorKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = priorKey;
    if (priorFile === undefined) delete process.env.DASHSCOPE_API_KEY_FILE;
    else process.env.DASHSCOPE_API_KEY_FILE = priorFile;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
