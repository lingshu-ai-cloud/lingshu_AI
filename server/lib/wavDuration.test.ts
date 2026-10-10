import assert from 'node:assert/strict';
import { wavDurationFromBytes } from './wavDuration';
const chunk = (id: string, body: Buffer) => { const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(body.length, 4); return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]); };
const fmt = Buffer.alloc(16); fmt.writeUInt32LE(48000, 8);
const body = Buffer.concat([Buffer.from('WAVE'), chunk('JUNK', Buffer.from('abc')), chunk('fmt ', fmt), chunk('LIST', Buffer.from('metadata data')), chunk('data', Buffer.alloc(96000))]);
const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(body.length,4);
assert.equal(wavDurationFromBytes(Buffer.concat([header,body])), 2);
assert.equal(wavDurationFromBytes(Buffer.from('invalid')),0);
console.log('wav duration regression passed');
