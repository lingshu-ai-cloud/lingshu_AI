import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HeyGenV3Provider } from '../server/lib/digitalHumanProvider.js';

// Explicit invocation only. Persist the task ID so reruns poll instead of spending again.
const dir = path.resolve('data/heygen-live-20260905');
const stateFile = path.join(dir, 'task.json');
const key = process.env.HEYGEN_API_KEY || (process.argv.includes('--clipboard')
  ? execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }).trim() : '');
const provider = new HeyGenV3Provider({ apiKey: key });
fs.mkdirSync(dir, { recursive: true });
let state: { id: string; status: string };
if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
else {
  if (!process.argv.includes('--create')) throw new Error('No existing task; --create explicitly permits one paid verification render.');
  const people = await provider.publicPeople();
  if (!people.length) throw new Error('No usable public avatar returned');
  const person = people[0];
  const task = await provider.submit({
    externalJobId: 'heygen-live-20260905', language: 'zh', title: 'Lingshu internal integration verification',
    script: '这是灵枢数字人功能的内部技术测试。我们正在验证视频生成和声音同步。',
    selection: { provider: 'heygen', engine: person.supported_api_engines.includes('avatar_v') ? 'avatar_v' : 'avatar_iv',
      externalAvatarId: person.id, externalVoiceId: person.default_voice_id, routingReason: 'authorized_internal_verification' },
  });
  state = { id: task.id, status: task.status };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
const task = await provider.get(state.id);
fs.writeFileSync(stateFile, JSON.stringify({ id: state.id, status: task.status }, null, 2));
console.log(JSON.stringify({ id: state.id, status: task.status }));
if (task.status === 'failed') throw new Error(task.errorMessage || 'HeyGen generation failed');
if (task.status === 'completed' && task.outputUrl && !fs.existsSync(path.join(dir, 'output.mp4'))) {
  const url = new URL(task.outputUrl);
  if (url.protocol !== 'https:' || !/(^|\.)heygen\.(ai|com)$/.test(url.hostname)) throw new Error('Untrusted output host');
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
  fs.writeFileSync(path.join(dir, 'output.mp4'), Buffer.from(await response.arrayBuffer()));
  console.log('Downloaded video; signed URL and API key are not persisted.');
}
