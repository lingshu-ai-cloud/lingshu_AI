import fs from 'node:fs';
import path from 'node:path';

const baseUrl = String(process.env.LINGSHU_ACCEPTANCE_BASE_URL || 'https://43.134.182.192').replace(/\/$/, '');
const credentialsFile = String(process.env.LINGSHU_ACCEPTANCE_CREDENTIALS_FILE || '').trim();
const fixtureDir = String(process.env.LINGSHU_ACCEPTANCE_FIXTURE_DIR || '').trim();
const stateFile = String(process.env.LINGSHU_ACCEPTANCE_STATE_FILE || path.resolve('.local-bin/ops-mixed-acceptance-state.json'));

if (!credentialsFile || !fixtureDir) {
  throw new Error('LINGSHU_ACCEPTANCE_CREDENTIALS_FILE and LINGSHU_ACCEPTANCE_FIXTURE_DIR are required');
}

const credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
function persistState() {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route} HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const login = await request('/api/overseas/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: credentials.email, password: credentials.password }),
});
const headers = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
const existingProjects = await request('/api/overseas/studio/projects', { headers });
const existingProject = (Array.isArray(existingProjects) ? existingProjects : []).find(item => item.title === '数字人混合分镜真实验收 2026-09-05');
const projectResponse = state.projectResponse || (existingProject ? { ok: true, project: existingProject } : await request('/api/overseas/studio/projects', {
  method: 'POST', headers,
  body: JSON.stringify({
    title: '数字人混合分镜真实验收 2026-09-05', status: 'draft', thumbSeed: 'mixed-digital-human-acceptance',
    spec: { ratio: '9:16', duration: 15, language: 'zh', acceptance: true, timelineComposition: 'mixed' },
  }),
}));
state.projectResponse = projectResponse;
persistState();
const project = projectResponse.project;
if (!project?.id) throw new Error('Project creation did not return an id');

async function uploadFixture(filename, name) {
  const key = `material:${filename}`;
  if (state[key]) return state[key];
  const existingMaterials = await request('/api/overseas/studio/materials', { headers });
  const existing = (Array.isArray(existingMaterials) ? existingMaterials : []).find(item => item.name === name);
  if (existing) {
    state[key] = existing;
    persistState();
    return existing;
  }
  const bytes = fs.readFileSync(path.join(fixtureDir, filename));
  const response = await request('/api/overseas/studio/materials', {
    method: 'POST', headers,
    body: JSON.stringify({
      name, folder: 'product', type: 'video', duration: 3, mimeType: 'video/mp4',
      dataBase64: bytes.toString('base64'), sourceType: 'uploaded', usage: 'editable',
    }),
  });
  const material = response.material;
  if (!material?.id) throw new Error(`Material upload did not return an id: ${filename}`);
  state[key] = material;
  persistState();
  return material;
}

async function uploadVoiceover(filename) {
  const key = `voiceover:${filename}`;
  if (state[key]) return state[key];
  const bytes = fs.readFileSync(path.join(fixtureDir, filename));
  const voiceover = await request('/api/overseas/studio/voiceover', {
    method: 'POST', headers,
    body: JSON.stringify({ name: filename, mimeType: 'audio/wav', duration: 3, dataBase64: bytes.toString('base64') }),
  });
  state[key] = voiceover;
  persistState();
  return voiceover;
}

const [material1, material2] = await Promise.all([
  uploadFixture('broll-1.mp4', '验收素材 · 产品细节'),
  uploadFixture('broll-2.mp4', '验收素材 · 使用场景'),
]);
const voiceover = await uploadVoiceover('segment.wav');
const avatars = await request('/api/overseas/studio/digital-human/avatars?includeUnready=1', { headers });
const capabilities = await request('/api/overseas/studio/digital-human/capabilities', { headers });
const avatar = avatars.items.find(item => item.productionReady === true && item.rightsStatus === 'commercial_cleared');
if (!avatar) throw new Error('No production-ready HeyGen avatar');

const scripts = [
  '欢迎来到灵枢，我们先快速了解核心价值。',
  '数字人负责讲解，真实素材负责展示产品细节。',
  '五个分镜已经合并，现在进入最终成片验收。',
];
for (let index = 0; index < scripts.length; index += 1) {
  const key = `job:${index + 1}`;
  if (state[key]) continue;
  state[key] = await request('/api/overseas/studio/digital-human/jobs', {
    method: 'POST', headers,
    body: JSON.stringify({
      projectId: project.id, storyboardSlotId: `mixed-shot-${index * 2 + 1}`, avatarMaterialId: avatar.id,
      mode: 'quality', language: 'zh', voiceoverUrl: voiceover.url, script: scripts[index],
      audioStartSeconds: 0, audioEndSeconds: 3, timelineComposition: 'mixed', allShotsUseSamePerson: true,
      voiceStrategy: 'person', usagePurpose: 'internal_preview', consentConfirmed: true,
      pipelineVersion: capabilities.pipelineVersion,
    }),
  });
  persistState();
}

persistState();
console.log(JSON.stringify({
  projectId: project.id,
  avatarId: avatar.id,
  materialIds: [material1.id, material2.id],
  jobs: scripts.map((_, index) => state[`job:${index + 1}`]?.job?.id),
}, null, 2));
