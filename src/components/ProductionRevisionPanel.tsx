import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';

const base = '/api/overseas/digital-employees/content-projects/';
const field = 'ui-field mt-1 !min-h-9 !rounded-md !px-3 !py-2 !text-sm';
const selectField = `${field} ui-select`;
const fieldLabel = 'block text-xs font-bold text-text-secondary';
const secondaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-border-bright hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';
const primaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-4 py-2 text-xs font-bold text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40';

async function api(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '请求失败');
  return data;
}

export default function ProductionRevisionPanel({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [node, setNode] = useState('music');
  const [tracks, setTracks] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [values, setValues] = useState<any>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = () => api(base + encodeURIComponent(projectId) + '/production').then(value => { setData(value); setDirty(false); }).catch(error => setNotice(error.message));

  useEffect(() => {
    void load();
    void api('/api/overseas/studio/bgm').then(setTracks).catch(error => setNotice(error.message));
    void api('/api/overseas/studio/materials').then(value => setAssets(Array.isArray(value) ? value : value.items || [])).catch(error => setNotice(error.message));
  }, [projectId]);

  useEffect(() => {
    const spec = data?.spec;
    if (!spec) return;
    setValues(node === 'music'
      ? { bgm: spec.bgm || '', volume: spec.bgmVol ?? 24 }
      : node === 'voice'
        ? { voice: spec.voice || 'v1', speed: spec.voiceStyle?.speed || 1, emotion: spec.voiceStyle?.emotion || '自然可信' }
        : node === 'subtitles'
          ? { cues: spec.cues, fontScale: spec.subtitleStyle?.fontScale || 1, bottomRatio: spec.subtitleStyle?.bottomRatio || .2 }
          : node === 'cover'
            ? { title: spec.coverTitle || '', frameTime: spec.coverFrameTime || 0 }
            : node === 'export'
              ? { ratio: spec.exportSpec?.ratio || spec.ratio || '9:16', resolution: spec.exportSpec?.resolution || '1080p' }
              : { scenes: (spec.sceneSourcePlan || []).map((row: any, index: number) => ({ source: spec.scenePlan?.[index]?.source || (/数字人/.test(row.intent) ? 'avatar' : 'material'), materialId: row.assetId, trimStart: spec.sceneOverrides?.[index]?.trimStart || 0 })) });
  }, [data, node]);

  const set = (key: string, value: any) => { setDirty(true); setValues((current: any) => ({ ...current, [key]: value })); };

  if (!data) return <p role="status" className="border-y border-border bg-surface py-8 text-center text-sm text-text-muted">{notice || '正在读取生产配置…'}</p>;

  return <section className="space-y-4 border-y border-border bg-surface py-4">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Revision control</p>
        <h3 className="mt-1 text-base font-bold text-text-primary">生产现场 · 查看与纠正</h3>
      </div>
      <button type="button" className={secondaryButton} onClick={() => void load()}>刷新</button>
    </header>

    <p className="border-l-2 border-border-bright bg-surface-2 px-3 py-2 text-xs leading-5 text-text-secondary">
      当前节点：{({ script: '脚本', material_match: '分镜素材', voice_subtitles: '配音与字幕', heygen: '数字人及混剪合成', render: '合成', quality: '质检', completed: '待验收', blocked: '需要处理' } as any)[data.spec.stage] || data.spec.stage}。保存后撤销旧审批并从受影响节点重新制作。
    </p>

    <nav aria-label="生产配置节点" className="flex flex-wrap border-b border-border">
      {[
        ['music', '配乐'],
        ['voice', '配音'],
        ['shots', '分镜素材'],
        ['subtitles', '字幕'],
        ['cover', '封面'],
        ['export', '导出规格'],
      ].map(([id, label]) => <button
        key={id}
        type="button"
        aria-pressed={node === id}
        onClick={() => setNode(id)}
        className={`relative -mb-px border-b-2 px-3 py-2 text-xs font-bold transition ${node === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}
      >
        {label}
      </button>)}
    </nav>

    <div className="min-h-44">
      {node === 'music' && <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className={fieldLabel}>
            配乐
            <select className={selectField} value={values.bgm || ''} onChange={event => set('bgm', event.target.value)}>
              <option value="">不配乐</option>
              {tracks.map(track => <option key={track.id} value={track.id}>{track.name} · {track.mood}</option>)}
            </select>
          </label>
          <label className={fieldLabel}>
            最终混音音量 <span className="font-medium text-accent">{values.volume}%</span>
            <input aria-label="配乐音量" className="mt-3 w-full accent-accent" type="range" min="0" max="100" value={values.volume || 0} onChange={event => set('volume', Number(event.target.value))} />
          </label>
        </div>
        {tracks.find(track => track.id === values.bgm)?.url && <audio controls className="h-10 w-full" src={tracks.find(track => track.id === values.bgm).url} />}
        <p className="border-l-2 border-border-bright pl-3 text-xs leading-5 text-text-muted">这里试听的是原曲；上方成片会在保存并重新制作完成后更新，显示百分比就是最终混音增益。</p>
        {data.spec.bgmSelection?.reason && <p className="border-l-2 border-border-bright pl-3 text-xs leading-5 text-text-muted">{data.spec.bgmSelection.reason}</p>}
      </div>}

      {node === 'voice' && <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={fieldLabel}>
            音色
            <select className={selectField} value={values.voice || 'v1'} onChange={event => set('voice', event.target.value)}>
              <option value="v1">女声</option>
              <option value="v2">男声</option>
            </select>
          </label>
          <label className={fieldLabel}>
            语速
            <input aria-label="配音语速" className={field} type="number" min=".8" max="1.2" step=".05" value={values.speed || 1} onChange={event => set('speed', Number(event.target.value))} />
          </label>
        </div>
        {data.spec.voiceoverUrl && <audio controls className="h-10 w-full" src={data.spec.voiceoverUrl} />}
        <p className="border-l-2 border-border-bright pl-3 text-xs leading-5 text-text-muted">{data.spec.voiceSelection?.reason} 试听为当前已生成配音，修改后重新生成。</p>
      </div>}

      {node === 'shots' && <div className="divide-y divide-border border-y border-border">
        {(values.scenes || []).map((scene: any, index: number) => <div key={index} className="space-y-3 py-4">
          <div className="grid items-end gap-3 sm:grid-cols-[4rem_minmax(0,9rem)_minmax(0,1fr)_7rem]">
            <span className="self-center text-xs font-bold text-text-secondary">第 {index + 1} 镜</span>
            <label className={fieldLabel}>
              来源
              <select aria-label={'第' + (index + 1) + '镜来源'} className={selectField} value={scene.source} onChange={event => set('scenes', values.scenes.map((item: any, i: number) => i === index ? { ...item, source: event.target.value } : item))}>
                <option value="material">素材</option>
                <option value="avatar">数字人</option>
              </select>
            </label>
            {scene.source === 'material' && <>
              <label className={fieldLabel}>
                素材
                <select aria-label={'第' + (index + 1) + '镜素材'} className={selectField} value={scene.materialId} onChange={event => set('scenes', values.scenes.map((item: any, i: number) => i === index ? { ...item, materialId: event.target.value } : item))}>
                  {data.spec.materialIds.map((id: string, i: number) => <option key={id} value={id}>{assets.find(asset => asset.id === id)?.name || '素材 ' + (i + 1)}</option>)}
                </select>
              </label>
              <label className={fieldLabel}>
                起点秒
                <input className={field} type="number" min="0" step=".1" value={scene.trimStart} onChange={event => set('scenes', values.scenes.map((item: any, i: number) => i === index ? { ...item, trimStart: Number(event.target.value) } : item))} />
              </label>
            </>}
          </div>
          {scene.source === 'material' && assets.find(asset => asset.id === scene.materialId)?.url && <video controls preload="none" className="max-h-44 w-full bg-black object-contain" src={assets.find(asset => asset.id === scene.materialId).url} />}
        </div>)}
      </div>}

      {node === 'subtitles' && <div className="space-y-4">
        <p className="border-l-2 border-border-bright pl-3 text-xs leading-5 text-text-muted">对齐来源：{data.spec.subtitleAlignmentSource || '未标记'}。字幕文字须与口播一致，可调整时间和排版。</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={fieldLabel}>
            字号倍率
            <input className={field} type="number" min=".7" max="1.4" step=".1" value={values.fontScale || 1} onChange={event => set('fontScale', Number(event.target.value))} />
          </label>
          <label className={fieldLabel}>
            底部安全区
            <input className={field} type="number" min=".08" max=".35" step=".01" value={values.bottomRatio || .2} onChange={event => set('bottomRatio', Number(event.target.value))} />
          </label>
        </div>
        <div className="max-h-64 divide-y divide-border overflow-auto border-y border-border">
          {(values.cues || []).map((cue: any, index: number) => <div key={index} className="grid gap-2 py-3 sm:grid-cols-[6rem_6rem_minmax(0,1fr)] sm:items-center">
            <input aria-label={'字幕' + (index + 1) + '起点'} className="ui-field !min-h-8 !rounded-md !px-2 !py-1 !text-xs" type="number" step=".01" value={cue.start} onChange={event => set('cues', values.cues.map((item: any, i: number) => index === i ? { ...item, start: Number(event.target.value) } : item))} />
            <input aria-label={'字幕' + (index + 1) + '终点'} className="ui-field !min-h-8 !rounded-md !px-2 !py-1 !text-xs" type="number" step=".01" value={cue.end} onChange={event => set('cues', values.cues.map((item: any, i: number) => index === i ? { ...item, end: Number(event.target.value) } : item))} />
            <span className="text-sm leading-6 text-text-secondary">{cue.text}</span>
          </div>)}
        </div>
      </div>}

      {node === 'cover' && <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className={fieldLabel}>
          封面标题
          <input className={field} value={values.title || ''} onChange={event => set('title', event.target.value)} />
        </label>
        <label className={fieldLabel}>
          取帧时间（秒）
          <input className={field} type="number" min="0" step=".1" value={values.frameTime || 0} onChange={event => set('frameTime', Number(event.target.value))} />
        </label>
      </div>}

      {node === 'export' && <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className={fieldLabel}>
          导出画幅
          <select aria-label="导出画幅" className={selectField} value={values.ratio} onChange={event => set('ratio', event.target.value)}>
            {['9:16', '1:1', '16:9'].map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className={fieldLabel}>
          导出分辨率
          <select aria-label="导出分辨率" className={selectField} value={values.resolution} onChange={event => set('resolution', event.target.value)}>
            <option>1080p</option>
            <option>720p</option>
          </select>
        </label>
        <span className="pb-2 text-xs font-medium text-text-muted">30 fps · H.264 MP4</span>
      </div>}
    </div>

    <label className={fieldLabel}>
      修改原因（可选，用于后续制作参考）
      <input className={field} value={values.reason || ''} onChange={event => set('reason', event.target.value)} />
    </label>

    <footer className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <button
        type="button"
        disabled={busy || !data.managed}
        className={primaryButton}
        onClick={async () => {
          setBusy(true);
          setNotice('');
          try {
            await api(base + encodeURIComponent(projectId) + '/revise', { hash: data.hash, node, values });
            setNotice('已保存，原任务将从受影响节点重新制作');
            await load();
            onSaved?.();
          } catch (error) {
            setNotice((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '保存中…' : '保存并继续原任务'}
      </button>
      {!data.managed && <p className="text-xs text-text-muted">手动创作请在工作台编辑后重新生成。</p>}
      {dirty && <p className="text-xs font-medium text-amber">当前修改尚未进入上方成片，请保存并等待重新制作。</p>}
    </footer>

    {notice && <p role="status" className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm text-amber">{notice}</p>}
  </section>;
}
