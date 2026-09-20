import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  createWeComKfProvider,
  decryptWeComPayload,
  parseWeComEncryptedEnvelope,
  parseWeComKfCallbackXml,
  verifyWeComSignature,
  WeComApiError,
} from './wecom.js';

const encodingAesKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64').replace(/=$/, '');

function encrypt(message: string, receiveId: string, invalidPad = false): string {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  const messageBytes = Buffer.from(message, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBytes.length);
  const unpadded = Buffer.concat([Buffer.alloc(16, 7), length, messageBytes, Buffer.from(receiveId)]);
  const pad = 32 - (unpadded.length % 32 || 32) || 32;
  const padding = Buffer.alloc(pad, pad);
  if (invalidPad && padding.length > 1) padding[0] = pad - 1;
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.concat([unpadded, padding])), cipher.final()]).toString('base64');
}

test('WeCom callback crypto validates signature, receiver and PKCS#7 padding', () => {
  const callbackXml = '<xml><ToUserName><![CDATA[corp-1]]></ToUserName><CreateTime>1790000000</CreateTime><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[sync-token]]></Token><OpenKfId><![CDATA[wk-1]]></OpenKfId></xml>';
  const encrypted = encrypt(callbackXml, 'corp-1');
  const timestamp = '1790000000';
  const nonce = 'nonce-1';
  const token = 'verify-token';
  const signature = crypto.createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex');
  assert.equal(verifyWeComSignature({ token, timestamp, nonce, encrypted, signature }), true);
  assert.equal(verifyWeComSignature({ token, timestamp, nonce, encrypted, signature: `${signature.slice(0, -1)}0` }), false);

  const payload = decryptWeComPayload({ encodingAesKey, encryptedEcho: encrypted, corpId: 'corp-1' });
  assert.equal(payload.receiveId, 'corp-1');
  assert.equal(parseWeComKfCallbackXml(payload.message).token, 'sync-token');
  assert.throws(
    () => decryptWeComPayload({ encodingAesKey, encryptedEcho: encrypted, corpId: 'another-corp' }),
    /wecom_corp_id_mismatch/,
  );
  assert.throws(
    () => decryptWeComPayload({ encodingAesKey, encryptedEcho: encrypt(callbackXml, 'corp-1', true), corpId: 'corp-1' }),
    /invalid_wecom_padding/,
  );
});

test('WeCom XML parser accepts encrypted envelope and rejects entity declarations', () => {
  assert.deepEqual(
    parseWeComEncryptedEnvelope('<xml><Encrypt><![CDATA[cipher-value]]></Encrypt></xml>'),
    { encrypted: 'cipher-value' },
  );
  assert.throws(
    () => parseWeComEncryptedEnvelope('<!DOCTYPE xml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><xml><Encrypt>&xxe;</Encrypt></xml>'),
    /unsafe_wecom_xml/,
  );
});

test('WeCom provider uses official KF endpoints and marks ambiguous send failures unknown', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let tokenRequests = 0;
  let syncRequests = 0;
  const provider = createWeComKfProvider({
    now: () => 1_790_000_000_000,
    request: (async config => {
      calls.push(config as Record<string, unknown>);
      if (String(config.url).endsWith('/cgi-bin/gettoken')) {
        tokenRequests += 1;
        return { status: 200, data: { errcode: 0, access_token: `access-${tokenRequests}`, expires_in: 7200 } } as never;
      }
      if (String(config.url).endsWith('/cgi-bin/kf/sync_msg')) {
        syncRequests += 1;
        if (syncRequests === 1) return { status: 200, data: { errcode: 42001, errmsg: 'token expired' } } as never;
        return { status: 200, data: { errcode: 0, next_cursor: 'next', has_more: 1, msg_list: [] } } as never;
      }
      throw new Error('network after possible write');
    }) as typeof import('axios').default.request,
  });
  const page = await provider.syncMessages({
    corpId: 'corp', corpSecret: 'secret', cursor: '', token: 'callback-token', openKfId: 'wk',
  });
  assert.deepEqual(page, { nextCursor: 'next', hasMore: true, messages: [] });
  assert.equal(calls.filter(call => String(call.url).endsWith('/cgi-bin/gettoken')).length, 2, 'an explicitly expired token should refresh once');
  await assert.rejects(
    provider.sendText({
      corpId: 'corp', corpSecret: 'secret', openKfId: 'wk', externalUserId: 'user',
      content: 'hello', msgId: 'idempotent-msg-id',
    }),
    error => error instanceof WeComApiError && error.uncertain === true,
  );
  const send = calls.find(call => String(call.url).endsWith('/cgi-bin/kf/send_msg'))!;
  assert.deepEqual(send.data, {
    touser: 'user', open_kfid: 'wk', msgid: 'idempotent-msg-id', msgtype: 'text', text: { content: 'hello' },
  });
});
