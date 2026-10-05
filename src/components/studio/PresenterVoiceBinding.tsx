import { useEffect, useRef, useState } from 'react';
import { presenterApi } from '../../lib/presenterApi';
import type { PresenterVoice } from '../../lib/presenterAssets';

const readingSamples: Record<string, string> = {
  zh: '大家好，我是今天的讲解人。接下来，我会用自然的语速介绍产品的特点、使用场景和注意事项。不同的人有不同的需求，如果您想进一步了解，欢迎随时联系我们。我们会认真回答您的问题，并提供清楚、准确的建议。',
  en: 'Hello, I am your presenter today. Let me introduce the product, explain how it works, and share a few useful details. Every customer has different needs. If you have any questions, please contact our team. We will listen carefully and give you a clear, helpful answer.',
};

export default function PresenterVoiceBinding({ presenterId, currentVoiceId, onBound }: { presenterId: string; currentVoiceId: string; onBound: () => Promise<void> }) {
  const [voices, setVoices] = useState<PresenterVoice[]>([]);
  const [voiceId, setVoiceId] = useState(currentVoiceId);
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('zh');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [file, setFile] = useState<File | Blob | null>(null);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [jobs, setJobs] = useState<Array<{ id: string; name: string; status: string; voiceId: string; createdAt: string }>>([]);
  const [localPreview, setLocalPreview] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const attempt = useRef<{ id: string; signature: string } | null>(null);
  useEffect(() => { setVoiceId(currentVoiceId); }, [currentVoiceId]);
  useEffect(() => {
    let live = true;
    void presenterApi.voices('', '', 'private').then(page => { if (live) { setVoices(page.items); setToken(page.nextToken); } }).catch(e => { if (live) setError(e instanceof Error ? e.message : '私人音色读取失败'); });
    void presenterApi.cloneJobs().then(items => { if (live) setJobs(items); }).catch(() => {});
    return () => { live = false; recorder.current?.stop(); stream.current?.getTracks().forEach(track => track.stop()); };
  }, []);
  useEffect(() => {
    if (!file) { setLocalPreview(''); return; }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!jobId || !['processing', 'submitting'].includes(jobStatus)) return;
    const timer = window.setTimeout(() => { void presenterApi.cloneStatus(jobId).then(result => {
      setJobStatus(result.status);
      if (result.voice?.id && result.status === 'completed') {
        setVoices(current => [...current.filter(item => item.id !== result.voice!.id), result.voice!]);
        setVoiceId(result.voice.id);
      }
      if (result.status === 'failed') setError(result.error || '音色克隆失败，请更换清晰录音');
    }).catch(e => setError(e instanceof Error ? e.message : '音色状态查询失败')); }, 5000);
    return () => window.clearTimeout(timer);
  }, [jobId, jobStatus]);
  const selected = voices.find(item => item.id === voiceId);
  const start = async () => {
    setError('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) { media.getTracks().forEach(track => track.stop()); throw new Error('当前浏览器不支持录音，请上传音频文件'); }
      stream.current = media; chunks.current = [];
      const next = new MediaRecorder(media, { mimeType: mime });
      next.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = () => { setFile(new Blob(chunks.current, { type: mime })); media.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false); };
      recorder.current = next; setRecordingSeconds(0); setFile(null); next.start(); setRecording(true);
    } catch (e) { setError(e instanceof Error ? e.message : '麦克风启动失败'); }
  };
  const submit = async () => {
    if (!file || !name.trim() || !authorized) return;
    setBusy(true); setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('录音不能超过 10MB');
      const signature = `${name.trim()}:${language}:${file.size}:${file.type}`;
      if (attempt.current && attempt.current.signature !== signature) throw new Error('上次提交结果待核对，请先查看原音色任务');
      attempt.current ||= { id: crypto.randomUUID(), signature };
      const result = await presenterApi.cloneVoice(file, name.trim(), language, attempt.current.id);
      setJobId(result.id); setJobStatus(result.status);
      setJobs(current => [{ id: result.id, name: name.trim(), status: result.status, voiceId: result.voiceId, createdAt: new Date().toISOString() }, ...current.filter(item => item.id !== result.id)]);
    } catch (e) { setError(e instanceof Error ? e.message : '音色克隆失败'); }
    finally { setBusy(false); }
  };
  const bind = async () => {
    if (!voiceId || !authorized) return;
    setBusy(true); setError('');
    try { await presenterApi.bindVoice(presenterId, voiceId); await onBound(); }
    catch (e) { setError(e instanceof Error ? e.message : '音色绑定失败'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 rounded-lg border p-2 text-xs" aria-label="企业人物音色绑定">
    <label className="block font-bold">HeyGen 私人音色<select aria-label="企业人物音色" value={voiceId} onChange={event => setVoiceId(event.target.value)} className="mt-1 w-full rounded border p-2 font-normal">
      <option value="">请选择音色</option>{voiceId && !selected && <option value={voiceId}>当前已绑定音色（待核验）</option>}
      {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.language}</option>)}
    </select></label>
    {selected?.previewUrl && <audio aria-label="音色试听" controls src={selected.previewUrl} className="h-9 w-full" />}
    {token && <button type="button" disabled={busy} onClick={() => void presenterApi.voices(token, '', 'private').then(page => { setVoices(current => [...current, ...page.items]); setToken(page.nextToken); }).catch(e => setError(String(e)))} className="underline">加载更多音色</button>}
    <label className="flex items-start gap-1"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />我确认已取得本人声音克隆及商业口播使用授权</label>
    <button type="button" disabled={busy || !voiceId || !authorized || voiceId === currentVoiceId} onClick={() => void bind()} className="rounded border px-2 py-1 disabled:opacity-40">绑定到当前企业人物</button>
    <details><summary className="cursor-pointer font-bold">录制或上传新音色</summary><div className="mt-2 space-y-2">
      <input aria-label="新音色名称" value={name} onChange={event => setName(event.target.value)} placeholder="音色名称" className="w-full rounded border p-2" />
      <select aria-label="录音语言" value={language} onChange={event => setLanguage(event.target.value)} className="rounded border p-2"><option value="zh">中文</option><option value="en">英语</option></select>
      <div className="rounded-lg border bg-slate-50 p-3" aria-label="音色录制朗读提示">
        <p className="font-bold">请本人朗读这段示例文本</p>
        <p className="mt-1 leading-relaxed">{readingSamples[language]}</p>
        <p className="mt-2 text-text-muted">在安静环境中自然朗读，保持单人声音清晰。此文本是灵枢提供的录音示例，不是 HeyGen 人物授权视频的指定文案。</p>
      </div>
      <div className="flex items-center gap-2"><button type="button" disabled={busy || recording} onClick={() => void start()} className="rounded border px-2 py-1">开始录音</button><button type="button" disabled={!recording} onClick={() => recorder.current?.stop()} className="rounded border px-2 py-1 disabled:opacity-40">结束录音</button>{recording && <span role="status">录音中 · {recordingSeconds} 秒</span>}</div>
      <label className="block">或上传清晰单人录音<input aria-label="上传音色录音" type="file" accept="audio/webm,audio/wav,audio/mpeg,audio/mp4,audio/ogg" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full" /></label>
      {file && <p>录音已准备 · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
      {localPreview && <audio aria-label="本地录音试听" controls src={localPreview} className="h-9 w-full" />}
      <button type="button" disabled={busy || !file || !name.trim() || !authorized || recording || Boolean(jobId)} onClick={() => void submit()} className="rounded border px-2 py-1 disabled:opacity-40">提交 HeyGen 克隆</button>
      {jobId && <p role="status">音色任务：{jobStatus === 'completed' ? '已可用，请试听后绑定' : jobStatus === 'failed' ? '失败' : '正在处理'}</p>}
      {jobs.length > 0 && <div className="space-y-1"><p>已有音色任务</p>{jobs.map(job => <button key={job.id} type="button" onClick={() => { setJobId(job.id); setJobStatus('processing'); }} className="block underline">{job.name} · {job.status === 'completed' ? '已完成' : job.status === 'uncertain' ? '待核对' : '处理中'} · 查看原任务</button>)}</div>}
    </div></details>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
