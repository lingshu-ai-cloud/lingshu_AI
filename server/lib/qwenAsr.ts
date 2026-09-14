import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { speechText, validateSpeechCues } from '../../src/lib/narrationAlignment.js';
import type { SubCue } from '../../src/lib/studioApi.js';
import { withPaidOperationLock } from './paidOperationLock.js';
import { studioPaidBudget } from './studioPaidBudget.js';

export const ASR_MODEL = 'qwen3-asr-flash-filetrans';
export function qwenAsrCues(raw: any, duration: number, expected = ''): { text: string; cues: SubCue[]; matches: boolean } {
  if (raw?.transcripts?.length !== 1) throw new Error('需要单声道转写结果');
  const transcript = raw.transcripts[0];
  const words: SubCue[] = (transcript.sentences || []).flatMap((s: any) => (s.words || []).map((w: any) => ({ text: String(w.text || '') + String(w.punctuation || ''), start: w.begin_time / 1000, end: w.end_time / 1000 })));
  if (!validateSpeechCues(words, transcript.text, duration)) throw new Error('千问未返回有效字词时间戳，不能作为精确对齐');
  const matches = !expected || speechText(expected) === speechText(transcript.text);
  const lines = (matches && expected ? expected : transcript.text).match(/[^。！？!?\n]+[。！？!?]?/g) || [transcript.text];
  let cursor = 0;
  const cues = lines.filter((line: string) => speechText(line)).map((line: string) => {
    const selected: SubCue[] = []; let actual = '';
    while (cursor < words.length && actual.length < speechText(line).length) { const word = words[cursor++]; selected.push(word); actual += speechText(word.text); }
    if (actual !== speechText(line)) throw new Error('台词边界跨越识别词，请人工核验');
    return { text: line.trim(), start: selected[0].start, end: selected.at(-1)!.end, words: selected };
  });
  if (cursor !== words.length) throw new Error('存在未匹配识别词');
  return { text: transcript.text, cues, matches };
}

type RecordData = { id: string; sourceSha256: string; model: string; status: string; taskId?: string; raw?: any; usage?: any; error?: string };
export class QwenAsrService {
  private locks = new Map<string, Promise<RecordData>>();
  constructor(private root: string, private request: typeof fetch = fetch, private reserve: (id: string) => Promise<void> = id => studioPaidBudget.reserve('qwen_asr', id)) {}
  async run(tenant: string, bytes: Buffer, mimeType: string, confirmed = false): Promise<RecordData> {
    if (!/^[\w-]{1,128}$/.test(tenant)) throw new Error('企业身份无效');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('转写音频需小于20MB');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = `${tenant}:${hash}`;
    const active = this.locks.get(key); if (active) return active;
    const promise = withPaidOperationLock(path.join(this.root, '.locks'), key, () => this.perform(tenant, hash, bytes, mimeType, confirmed));
    this.locks.set(key, promise);
    try { return await promise; } finally { this.locks.delete(key); }
  }
  private async perform(tenant: string, hash: string, bytes: Buffer, mime: string, confirmed: boolean): Promise<RecordData> {
    const dir = path.join(this.root, tenant); const file = path.join(dir, `${hash}.json`);
    let record: RecordData = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id: hash, sourceSha256: hash, model: ASR_MODEL, status: 'needs_confirmation' };
    if (record.sourceSha256 !== hash || record.model !== ASR_MODEL) throw new Error('转写缓存不匹配');
    if (['SUCCEEDED', 'FAILED', 'uncertain', 'submitting'].includes(record.status)) return record;
    if (!record.taskId && !confirmed) return record;
    const save = () => { fs.mkdirSync(dir, { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temp, file); };
    const endpoint = process.env.QWEN_ASR_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';
    if (!['https://dashscope.aliyuncs.com/api/v1', 'https://dashscope-intl.aliyuncs.com/api/v1'].includes(endpoint)) throw new Error('ASR地域端点不在许可列表');
    let apiKey = process.env.DASHSCOPE_API_KEY?.trim() || '';
    if (!apiKey) { try { apiKey = fs.readFileSync(process.env.DASHSCOPE_API_KEY_FILE || path.join(os.homedir(), '.config/lingshu/dashscope.key'), 'utf8').trim(); } catch {} }
    if (!apiKey) throw new Error('未配置 DashScope 密钥');
    const json = async (url: string, init: RequestInit = {}) => {
      const response = await this.request(url, { ...init, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`千问ASR HTTP ${response.status}`);
      return response.json();
    };
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (!record.taskId) {
      if (process.env.QWEN_ASR_GENERATION_ENABLED !== 'true') throw new Error('付费转写尚未启用；已有缓存仍可使用');
      await this.reserve(`${tenant}:${hash}`);
      record.status = 'submitting'; save(); // Persist before any external operation; never auto-resubmit after crash.
      try {
        const { data: policy } = await json(`${endpoint}/uploads?action=getPolicy&model=${ASR_MODEL}`, { headers });
        const host = new URL(policy.upload_host);
        if (host.protocol !== 'https:' || !host.hostname.endsWith('.aliyuncs.com')) throw new Error('上传地址不安全');
        const extension = ({ 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/aac': 'aac' } as Record<string, string>)[mime];
        if (!extension) throw new Error('不支持此音频格式');
        const objectKey = `${policy.upload_dir}/${hash}.${extension}`; const form = new FormData();
        for (const [key, value] of Object.entries({ OSSAccessKeyId: policy.oss_access_key_id, Signature: policy.signature, policy: policy.policy, 'x-oss-object-acl': policy.x_oss_object_acl, 'x-oss-forbid-overwrite': policy.x_oss_forbid_overwrite, key: objectKey, success_action_status: '200' })) form.append(key, String(value));
        form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `${hash}.${extension}`);
        const upload = await this.request(host.href, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
        if (!upload.ok) throw new Error(`音频上传 HTTP ${upload.status}`);
        const submitted = await json(`${endpoint}/services/audio/asr/transcription`, { method: 'POST', headers: { ...headers, 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' }, body: JSON.stringify({ model: ASR_MODEL, input: { file_url: `oss://${objectKey}` }, parameters: { channel_id: [0], enable_words: true, enable_itn: false } }) });
        if (!submitted.output?.task_id) throw new Error('未返回任务ID，禁止自动重试');
        record = { ...record, taskId: submitted.output.task_id, status: 'PENDING' }; save(); return record;
      } catch (error) { record.status = 'uncertain'; record.error = error instanceof Error ? error.message : '提交状态未知'; save(); return record; }
    }
    const result = await json(`${endpoint}/tasks/${encodeURIComponent(record.taskId)}`, { headers });
    if (result.output?.task_status === 'SUCCEEDED') {
      const url = new URL(result.output.result?.transcription_url);
      if (!url.hostname.endsWith('.aliyuncs.com') || !['http:', 'https:'].includes(url.protocol)) throw new Error('转写结果地址不安全');
      url.protocol = 'https:';
      const raw = await json(url.href);
      record.raw = { audio_info: raw.audio_info, transcripts: raw.transcripts }; record.usage = result.usage;
    }
    record.status = result.output?.task_status || 'PENDING';
    if (record.status === 'FAILED') record.error = '千问转写任务失败；请核对供应商任务，不自动重新扣费';
    save(); return record;
  }
}
