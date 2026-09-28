import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions,
  Check,
  ChevronRight,
  CircleAlert,
  Film,
  ImagePlus,
  Loader2,
  Megaphone,
  Music2,
  Sparkles,
  Upload,
  UserRound,
  Volume2,
} from 'lucide-react';
import type { SocialContentCreationPath } from '../../lib/socialContentModel';
import { studioApi, type HeyGenAvatarOption, type Material } from '../../lib/studioApi';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, type PresenterAsset, type ProductionDefaults } from '../../lib/shotProduction';
import type { SocialContentStageProfile } from '../../lib/socialContentStage';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import { authHeader } from '../../lib/auth';

interface EnterpriseProductOption {
  id: string;
  name: string;
}

export interface SocialCreationWorkbenchSeed {
  referenceTitle?: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceContentType?: 'video' | 'image';
  referenceLinks?: string[];
  productId?: string;
  productName?: string;
}

export interface SocialCreationWorkbenchSubmit {
  requestId: number;
  creationPath: SocialContentCreationPath;
  title: string;
  productId: string;
  productName: string;
  presenterAssetId: string;
  files: File[];
  uploadedMaterials: Material[];
  referenceLinks: string[];
  callToAction: string;
  specialRequirements: string;
  stageProfileId: SocialContentStageProfile['id'];
  stageLabel: string;
  strategyPresetId: SocialContentStageProfile['presetId'];
}

const freeScript = [
  '还在为内容拍摄和剪辑反复返工吗？',
  '把你的产品素材放进来，我们会逐句匹配最合适的画面。',
  '你可以随时替换某一句对应的素材，也可以一次选择多句统一调整。',
  '确认口播、字幕和音乐后，就能生成一条完整内容。',
];

const replicationScript = [
  '这条爆款的前三秒先用一个明确问题抓住注意力。',
  '随后快速给出产品使用场景和核心价值。',
  '中段用连续画面证明效果，并保持原片节奏。',
  '结尾保留行动引导，替换成企业自己的承接方式。',
];

const creationOptions = [
  { id: 'voice', label: '口播', detail: '生成或沿用逐句口播', icon: Megaphone },
  { id: 'caption', label: '字幕', detail: '自动对齐口播字幕', icon: Captions },
  { id: 'sound', label: '音效', detail: '在转场和重点处补充音效', icon: Volume2 },
  { id: 'music', label: '音乐', detail: '匹配内容节奏与情绪', icon: Music2 },
  { id: 'effect', label: '画面特效', detail: '添加转场与重点强调', icon: Sparkles },
] as const;

function WorkbenchVideoPreview({ source, poster, title }: { source: string; poster?: string; title: string }) {
  const [attempt, setAttempt] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setPlaybackUrl('');
    setStatus('loading');
    setMessage('');
    void resolveInspirationPlaybackUrl(source, { signal: controller.signal, headers: authHeader() })
      .then(url => {
        if (controller.signal.aborted) return;
        setPlaybackUrl(url);
      })
      .catch(error => {
        if (controller.signal.aborted) {
          setMessage('视频地址获取超时，请重试');
        } else {
          setMessage(error instanceof Error ? error.message : '视频地址获取失败');
        }
        setStatus('error');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, source]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#e9eeeb]">
      {poster && status !== 'ready' && <img src={poster} alt={`${title}封面`} className="absolute inset-0 h-full w-full object-contain" />}
      {playbackUrl && <video
        src={playbackUrl}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        aria-label={title}
        className={`h-full w-full object-contain transition-opacity ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => setStatus('ready')}
        onCanPlay={() => setStatus('ready')}
        onError={() => {
          setMessage('视频文件加载或解码失败，请重新获取播放地址');
          setStatus('error');
        }}
      />}
      {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center bg-white/35 backdrop-blur-[1px]"><span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs font-bold text-[#38594d] shadow-sm"><Loader2 size={14} className="animate-spin" />正在加载视频</span></div>}
      {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-white/88 p-6 text-center backdrop-blur-sm"><div><CircleAlert size={24} className="mx-auto text-amber-700" /><p className="mt-2 text-sm font-black text-text-primary">视频暂时无法预览</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-text-muted">{message}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-lg bg-[#173d31] px-3 py-2 text-xs font-black text-white">重新加载</button></div></div>}
    </div>
  );
}

export default function SocialCreationWorkbench({
  mode,
  seed,
  stageProfile,
  onOpenChooser,
  onShowCreations,
  onGenerate,
}: {
  mode: SocialContentCreationPath;
  seed?: SocialCreationWorkbenchSeed;
  stageProfile?: SocialContentStageProfile;
  onOpenChooser: () => void;
  onShowCreations: () => void;
  onGenerate: (request: SocialCreationWorkbenchSubmit) => void;
}) {
  const [products, setProducts] = useState<EnterpriseProductOption[]>([]);
  const [productId, setProductId] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsUnavailable, setProductsUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedLines, setSelectedLines] = useState<number[]>([0]);
  const [activeLine, setActiveLine] = useState(0);
  const [enabledOptions, setEnabledOptions] = useState(() => new Set(creationOptions.map(item => item.id)));
  const [productionDefaults, setProductionDefaults] = useState<ProductionDefaults>(EMPTY_DEFAULTS);
  const [heygenAvatars, setHeygenAvatars] = useState<HeyGenAvatarOption[]>([]);
  const [presenterSelection, setPresenterSelection] = useState('');
  const [presenterOrientation, setPresenterOrientation] = useState<NonNullable<PresenterAsset['nativeOrientation']>>('unknown');
  const [useDigitalPresenter, setUseDigitalPresenter] = useState(false);
  const [presenterConsent, setPresenterConsent] = useState(false);
  const [presentersLoading, setPresentersLoading] = useState(true);
  const [presenterNotice, setPresenterNotice] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const isReplication = mode === 'viral_replication';
  const script = isReplication ? replicationScript : freeScript;
  const previewUrl = useMemo(() => files[0] ? URL.createObjectURL(files[0]) : '', [files]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    let active = true;
    setProductsLoading(true);
    setProductsUnavailable(false);
    void studioApi.materialProducts()
      .then(result => {
        if (!active) return;
        const items = (Array.isArray(result.items) ? result.items : [])
          .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string');
        setProducts(items);
        const seeded = items.find(item => item.id === seed?.productId || item.name === seed?.productName);
        setProductId(seeded?.id || '');
      })
      .catch(() => {
        if (!active) return;
        setProducts([]);
        setProductId('');
        setProductsUnavailable(true);
      })
      .finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [seed?.productId, seed?.productName]);

  useEffect(() => {
    let active = true;
    setPresentersLoading(true);
    void Promise.all([productionApi.defaults(), studioApi.digitalHumanAvatars()])
      .then(([defaults, avatars]) => {
        if (!active) return;
        setProductionDefaults(defaults);
        setHeygenAvatars(avatars.items);
      })
      .catch(() => { if (active) setPresenterNotice('数字人资产暂时无法读取，请稍后刷新。'); })
      .finally(() => { if (active) setPresentersLoading(false); });
    return () => { active = false; };
  }, []);

  const toggleLine = (index: number) => {
    setActiveLine(index);
    setSelectedLines(current => current.includes(index)
      ? current.length === 1 ? current : current.filter(item => item !== index)
      : [...current, index].sort((left, right) => left - right));
  };

  const persistSelectedPresenter = async (): Promise<string> => {
    if (!useDigitalPresenter) return '';
    if (!presenterSelection) throw new Error('请选择一个数字人资产');
    if (!presenterConsent) throw new Error('请先确认人物、声音和商业使用授权');
    if (presenterOrientation !== 'portrait') throw new Error('社媒视频默认为竖屏，请先核验该数字人的原生画幅为竖屏');
    const now = new Date().toISOString();
    const savedId = presenterSelection.startsWith('saved:') ? presenterSelection.slice('saved:'.length) : '';
    const providerId = presenterSelection.startsWith('heygen:') ? presenterSelection.slice('heygen:'.length) : '';
    const existing = savedId
      ? productionDefaults.presenters.find(item => item.id === savedId)
      : productionDefaults.presenters.find(item => (item.toolMappings?.heygen?.avatarId || item.avatarId) === providerId);
    const avatar = providerId ? heygenAvatars.find(item => item.id === providerId) : null;
    const avatarId = avatar?.id || existing?.toolMappings?.heygen?.avatarId || existing?.avatarId || '';
    const voiceId = avatar?.defaultVoiceId || existing?.toolMappings?.heygen?.voiceId || existing?.voiceId || '';
    if (!avatarId || !voiceId) throw new Error('该数字人缺少 HeyGen 人物或默认声音，请先在 HeyGen 中补齐');
    const presenterId = existing?.id || crypto.randomUUID();
    const safeAvatarRef = encodeURIComponent(avatarId);
    const presenter: PresenterAsset = {
      ...(existing || {}),
      id: presenterId,
      name: avatar?.name || existing?.name || 'HeyGen 数字人',
      avatarId,
      voiceId,
      authorized: true,
      supportsAlpha: existing?.supportsAlpha === true,
      nativeOrientation: presenterOrientation,
      commercialRightsStatus: 'cleared',
      rightsEvidence: existing?.rightsEvidence || {
        authorizationRef: `rights://heygen-account-asset/${safeAvatarRef}`,
        consentRef: `consent://studio-operator-confirmation/${encodeURIComponent(now)}`,
        grantedAt: now,
        subjectAdultConfirmed: true,
        permittedProviders: ['heygen'],
        permittedUses: ['digital_presenter', 'voice_synthesis'],
        providerScopes: [{ provider: 'heygen', uses: ['digital_presenter', 'voice_synthesis'] }],
      },
      toolMappings: { ...(existing?.toolMappings || {}), heygen: { avatarId, voiceId } },
    };
    const presenters = existing
      ? productionDefaults.presenters.map(item => item.id === existing.id ? presenter : item)
      : [...productionDefaults.presenters, presenter];
    const saved = await productionApi.saveDefaults({ ...productionDefaults, preference: 'avatar', presenters, defaultPresenterId: presenterId });
    setProductionDefaults(saved);
    if (!saved.presenters.some(item => item.id === presenterId)) throw new Error('数字人资产保存后未能回填，请刷新后重试');
    return presenterId;
  };

  const startGeneration = async () => {
    if (submitting || productsLoading) return;
    setSubmitting(true); setPresenterNotice('');
    try {
      const presenterAssetId = await persistSelectedPresenter();
      const uploadedMaterials: Material[] = [];
      for (const file of files) {
        const type: Material['type'] = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
        const result = await studioApi.uploadMaterialFile(file, { folder: 'upload', type, sourceType: 'content-workbench' });
        if (!result.ok || !result.material?.id) throw new Error(result.error || `「${file.name}」上传失败`);
        uploadedMaterials.push(result.material);
      }
      const selected = products.find(item => item.id === productId);
      const productName = selected?.name || '';
      // GENERATION_INTEGRATION_GAP: the current task contract accepts shared files plus
      // selected sentence indexes, but not a durable sentence-to-asset mapping yet.
      onGenerate({
        requestId: Date.now(),
        creationPath: mode,
        title: isReplication
          ? `${productName || seed?.productName || '自动选品'} · 爆款复刻`
          : `${productName || '自由创作'} · 新内容`,
        productId: selected?.id || '',
        productName,
        presenterAssetId,
        files,
        uploadedMaterials,
        referenceLinks: [...new Set([...(seed?.referenceLinks || []), ...uploadedMaterials.map(item => item.url).filter(Boolean)])],
        callToAction: '',
        specialRequirements: `口播段落：${selectedLines.map(index => index + 1).join('、')}；生成项：${[...enabledOptions, ...(presenterAssetId ? ['digital_presenter'] : [])].join('、')}`,
        stageProfileId: stageProfile?.id || 'b2b_launch',
        stageLabel: stageProfile?.name || 'B2B 起步验证',
        strategyPresetId: stageProfile?.presetId || 'b2b_starting',
      });
    } catch (error) {
      setPresenterNotice(error instanceof Error ? error.message : '数字人资产绑定失败');
      setSubmitting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#f3f5f2]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${isReplication ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>{isReplication ? '爆款复刻' : '自由创作'}</span>
            <span className="text-[10px] font-bold text-text-muted">逐句口播与画面制作台</span>
            {stageProfile&&<span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500">{stageProfile.name}</span>}
          </div>
          <h1 className="mt-1 truncate text-base font-black text-text-primary">{isReplication ? seed?.referenceTitle || '从爆款参考开始制作' : '创建一条新内容'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onShowCreations} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">我的创作</button>
          <button type="button" onClick={onOpenChooser} className="inline-flex items-center gap-1.5 rounded-lg bg-[#173d31] px-3 py-2 text-xs font-black text-white hover:bg-[#245644]"><ImagePlus size={14} />切换制作方式</button>
        </div>
      </header>

      <div className="social-creation-workbench-layout grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden">
        <aside className="min-h-0 border-b border-border bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="sticky top-0 z-10 border-b border-border bg-white px-4 py-4">
            <p className="text-sm font-black text-text-primary">口播内容</p>
            <p className="mt-1 text-[11px] leading-5 text-text-muted">点击句子跳到对应画面；可多选后统一更换素材。</p>
          </div>
          <ol className="space-y-2 p-3">
            {script.map((line, index) => {
              const selected = selectedLines.includes(index);
              const active = activeLine === index;
              return <li key={line}>
                <button type="button" onClick={() => toggleLine(index)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${active ? 'border-emerald-400 bg-emerald-50 shadow-sm' : selected ? 'border-emerald-200 bg-emerald-50/50' : 'border-border bg-white hover:border-emerald-200'}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-black ${selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border text-text-muted'}`}>{selected ? <Check size={12} /> : index + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-bold leading-5 text-text-primary">{line}</span><span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted">00:{String(index * 4).padStart(2, '0')}–00:{String((index + 1) * 4).padStart(2, '0')}<ChevronRight size={11} /></span></span>
                </button>
              </li>;
            })}
          </ol>
        </aside>

        <main className="flex min-h-[560px] min-w-0 flex-col bg-[#f5f8f5] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
            <div><p className="text-xs font-black text-text-primary">画面预览</p><p className="mt-0.5 text-[10px] text-text-muted">当前对应第 {activeLine + 1} 句 · 已选 {selectedLines.length} 句</p></div>
            {!isReplication && <button type="button" onClick={() => uploadRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-black text-text-secondary shadow-sm"><Upload size={14} />上传素材</button>}
          </div>
          <input ref={uploadRef} type="file" multiple accept="video/*,image/*" className="hidden" onChange={event => setFiles(Array.from(event.currentTarget.files || []))} />
          <div className="flex flex-1 items-stretch justify-center p-4 sm:p-5">
            <div className="relative flex min-h-[460px] w-full overflow-hidden rounded-xl border border-[#dfe5e1] bg-[#eef0f3] shadow-[0_2px_12px_rgba(23,61,49,0.06)]">
              {previewUrl && files[0]?.type.startsWith('video/') ? <video src={previewUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                : previewUrl ? <img src={previewUrl} alt="用户上传素材预览" className="h-full w-full object-contain" />
                : seed?.referenceContentType === 'video' && seed.referenceMediaUrl ? <WorkbenchVideoPreview source={seed.referenceMediaUrl} poster={seed.referenceThumbnail} title={seed.referenceTitle || '爆款视频预览'} />
                : seed?.referenceThumbnail ? <img src={seed.referenceThumbnail} alt={isReplication ? '爆款视频预览' : '已选素材预览'} className="h-full w-full object-contain" />
                : <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center text-[#294c40]">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#607b71] shadow-sm"><Film size={27} /></span>
                    <div><p className="text-base font-black">{isReplication ? '等待爆款视频' : '暂无预览'}</p><p className="mt-2 text-xs leading-5 text-[#789087]">{isReplication ? '从灵感中心选择爆款后，会在这里显示原视频。' : '先从素材库选择画面，或上传本地视频与图片。'}</p></div>
                    {!isReplication && <div className="flex items-center gap-3"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:open-material-library'))} className="rounded-lg border border-white bg-white px-4 py-2.5 text-xs font-black text-[#38594d] shadow-sm">选择素材</button><button type="button" onClick={() => uploadRef.current?.click()} className="rounded-lg bg-[#173d31] px-4 py-2.5 text-xs font-black text-white shadow-sm">上传素材</button></div>}
                  </div>}
              {(previewUrl || seed?.referenceThumbnail || seed?.referenceMediaUrl) && <div className="pointer-events-none absolute inset-x-6 bottom-5 rounded-lg bg-black/55 px-3 py-2 text-center text-xs font-bold leading-5 text-white backdrop-blur-sm">{script[activeLine]}</div>}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-black/5 px-5 py-3 text-[11px] text-text-muted"><span>{files.length ? `已上传 ${files.length} 个素材` : isReplication ? '沿用爆款原片素材' : '尚未上传素材'}</span><button type="button" onClick={()=>uploadRef.current?.click()} className="font-black text-emerald-700">为所选口播更换素材</button></div>
        </main>

        <aside className="flex min-h-0 flex-col border-t border-border bg-white lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-text-primary">生成设置</p><p className="mt-1 text-[11px] leading-5 text-text-muted">{isReplication ? '爆款复刻沿用原片设置，选项只读。' : '每一步都由你确认后再生成。'}</p></div>{isReplication && <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500">已锁定</span>}</div>

            {isReplication && <div className="mt-4">
              <label htmlFor="replication-product" className="text-xs font-black text-text-primary">主推产品</label>
              <select id="replication-product" value={productId} disabled={productsLoading || submitting} onChange={event => setProductId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-border bg-white px-3 text-xs font-bold text-text-primary disabled:bg-slate-100">
                <option value="">{productsLoading ? '正在读取企业产品表…' : '请选择主推产品'}</option>
                {products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {productsUnavailable && <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700"><CircleAlert size={11} />企业产品表暂时无法读取</p>}
            </div>}

            <div className="mt-4 space-y-2">
              {creationOptions.map(item => {
                const Icon = item.icon;
                const checked = enabledOptions.has(item.id);
                const locked = isReplication;
                return <button key={item.id} type="button" disabled={locked} onClick={() => setEnabledOptions(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${locked ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : checked ? 'border-emerald-200 bg-emerald-50/55' : 'border-border bg-white'}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${locked ? 'bg-white text-slate-400' : 'bg-white text-emerald-700'}`}><Icon size={15} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-black">{item.label}</span><span className="mt-0.5 block truncate text-[10px] opacity-75">{item.detail}</span></span>
                  <span className={`h-5 w-9 rounded-full p-0.5 ${checked ? locked ? 'bg-slate-300' : 'bg-emerald-600' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-4' : ''}`} /></span>
                </button>;
              })}
            </div>

            <div className={`mt-4 rounded-xl border p-3 ${useDigitalPresenter ? 'border-emerald-300 bg-emerald-50/70' : 'border-border bg-white'}`}>
              <button type="button" disabled={isReplication} onClick={() => { setUseDigitalPresenter(value => !value); setPresenterNotice(''); }} className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-55">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700"><UserRound size={15} /></span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-black text-text-primary">数字人</span><span className="mt-0.5 block text-[10px] text-text-muted">从 HeyGen 账号资产选择出镜人物</span></span>
                <span className={`h-5 w-9 rounded-full p-0.5 ${useDigitalPresenter ? 'bg-emerald-600' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${useDigitalPresenter ? 'translate-x-4' : ''}`} /></span>
              </button>
              {useDigitalPresenter && !isReplication && (
                <div className="mt-3 space-y-2 border-t border-emerald-200 pt-3">
                  <label className="block text-[10px] font-black text-text-primary">数字人资产
                    <select value={presenterSelection} disabled={presentersLoading || submitting} onChange={event => {
                      const value = event.target.value;
                      setPresenterSelection(value); setPresenterConsent(false); setPresenterNotice('');
                      const presenter = value.startsWith('saved:') ? productionDefaults.presenters.find(item => item.id === value.slice(6)) : null;
                      setPresenterOrientation(presenter?.nativeOrientation || 'unknown');
                    }} className="mt-1.5 h-10 w-full rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-text-primary">
                      <option value="">{presentersLoading ? '正在读取数字人资产…' : '请选择数字人'}</option>
                      {productionDefaults.presenters.length > 0 && <optgroup label="已绑定企业人物">{productionDefaults.presenters.filter(item => Boolean((item.toolMappings?.heygen?.avatarId || item.avatarId) && (item.toolMappings?.heygen?.voiceId || item.voiceId))).map(item => <option key={item.id} value={`saved:${item.id}`}>{item.name}</option>)}</optgroup>}
                      {heygenAvatars.length > 0 && <optgroup label="HeyGen 账号">{heygenAvatars.map(item => <option key={item.id} value={`heygen:${item.id}`}>{item.ownership === 'private' ? '账号资产' : '公共人物'} · {item.name}</option>)}</optgroup>}
                    </select>
                  </label>
                  <label className="block text-[10px] font-black text-text-primary">原生画幅
                    <select value={presenterOrientation} disabled={submitting} onChange={event => setPresenterOrientation(event.target.value as NonNullable<PresenterAsset['nativeOrientation']>)} className="mt-1.5 h-10 w-full rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-bold text-text-primary">
                      <option value="unknown">未核验</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option>
                    </select>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-4 text-text-secondary"><input type="checkbox" checked={presenterConsent} disabled={submitting} onChange={event => setPresenterConsent(event.target.checked)} className="mt-0.5 accent-emerald-700" /><span>我确认已取得该成年出镜人物的肖像、声音和商业使用授权。</span></label>
                  {!presentersLoading && !productionDefaults.presenters.length && !heygenAvatars.length && <p className="text-[10px] leading-4 text-amber-700">暂未读取到数字人资产，请检查测试服 HeyGen Key 与私有资产开关。</p>}
                </div>
              )}
              {isReplication && <p className="mt-2 text-[10px] leading-4 text-text-muted">爆款复刻的人物替换需先完成参考视频分析，进入任务后逐镜确认。</p>}
              {presenterNotice && <p role="status" className="mt-2 text-[10px] leading-4 text-amber-700">{presenterNotice}</p>}
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} className="text-amber-700" /><p className="text-xs font-black text-amber-950">CTA</p></div>
              <p className="mt-1 text-[10px] leading-5 text-amber-800">CTA 从企业中心的社媒策略读取，填写一次后后续内容自动复用。</p>
              <button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'social-strategy'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="mt-2 text-[10px] font-black text-amber-800 underline underline-offset-2">前往企业中心填写</button>
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-white p-4">
            {/* GENERATION_INTEGRATION_GAP: the server calculates estimatedCostCny only
                after a task plan exists; there is no preflight quote endpoint yet. */}
            {isReplication && <div className="mb-3 flex items-center justify-between text-[11px]"><span className="text-text-muted">预计消耗</span><span className="font-black text-text-primary" title="生成任务建立后由服务端返回真实预估">待生成服务核算</span></div>}
            <button type="button" disabled={submitting || productsLoading || (isReplication && !productId && products.length > 0)} onClick={() => void startGeneration()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#173d31] px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-[#245644] disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}{submitting ? '正在创建任务' : '开始生成'}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
