import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Tag } from 'antd';
import { CheckCircle2, Mic2, ShieldCheck, UserRound } from 'lucide-react';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, type ProductionDefaults, type PresenterAsset } from '../../lib/shotProduction';
import { fetchMaterialLibrary, type Material } from '../../lib/studioApi';
import { presenterApi } from '../../lib/presenterApi';
import { notifyPresenterAssetsUpdated } from '../../lib/presenterAssetsUpdated';
import type { ArkPresenterPreparation } from '../../lib/presenterAssets';
import { LsBrandAction, LsLoadingState } from '../ui/LsExperiencePrimitives';
import ArkPresenterEnrollmentPanel from '../studio/ArkPresenterEnrollmentPanel';
import PresenterManager, { type PresenterSaveContext } from './PresenterManager';

function heyGenReady(presenter?: PresenterAsset): boolean {
  return Boolean(presenter?.authorized && (presenter.toolMappings?.heygen?.avatarId || presenter.avatarId)
    && (presenter.toolMappings?.heygen?.voiceId || presenter.voiceId));
}

function presenterSelected(presenter?: PresenterAsset): boolean {
  return Boolean(presenter?.toolMappings?.heygen?.avatarId || presenter?.avatarId);
}

function presenterReady(presenter?: PresenterAsset): boolean {
  return Boolean(presenter?.authorized && (presenter.toolMappings?.heygen?.avatarId || presenter.avatarId));
}

function voiceReady(presenter?: PresenterAsset): boolean {
  return Boolean(presenter?.toolMappings?.heygen?.voiceId || presenter?.voiceId);
}

function arkReady(presenter?: PresenterAsset): boolean {
  return Boolean(presenter?.authorized && presenter.arkCertification?.status === 'active'
    && presenter.arkCertification.assetType === 'image' && presenter.arkCertification.assetUri);
}

function openDigitalHumanOnboarding(): void {
  try { window.sessionStorage.setItem('lingshu:open-digital-employee-guide', 'presenter'); } catch { /* optional */ }
  // DigitalEmployeePage is retained in a hidden React Activity. Its effects
  // reconnect after navigation and consume this persisted request. Opening an
  // Ant modal from the hidden page crashes rc-dialog while it restores focus.
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'digitalEmployees' } }));
}

export default function EnterprisePresenters({
  contentProduction = false,
  initialConfiguration = false,
  onInitialSelection,
}: {
  contentProduction?: boolean;
  initialConfiguration?: boolean;
  onInitialSelection?: () => void;
} = {}) {
  const [value, setValue] = useState<ProductionDefaults>(EMPTY_DEFAULTS);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showArkSetup, setShowArkSetup] = useState(false);
  const [showHeyGenManager, setShowHeyGenManager] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [preparedArk, setPreparedArk] = useState<(ArkPresenterPreparation & { presenterId: string })>();
  const [creationPreparations, setCreationPreparations] = useState<Record<string, ArkPresenterPreparation>>({});
  const [certifyingPresenterId, setCertifyingPresenterId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [loadError, setLoadError] = useState('');
  const initialReadyNotified = useRef(false);

  const load = useCallback(async () => {
    const [next, creations] = await Promise.all([
      productionApi.defaults(),
      presenterApi.creations().catch(() => []),
    ]);
    setValue({ ...EMPTY_DEFAULTS, ...next, presenterRoutes: next.presenterRoutes || [] });
    setCreationPreparations(Object.fromEntries(creations.flatMap(item => item.arkPreparation ? [[item.id, item.arkPreparation]] : [])));
    setLoadError('');
    setLoaded(true);
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    void load().catch(cause => { if (live) setLoadError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [load]);

  useEffect(() => {
    let live = true;
    // Presenter enrollment inputs are intentionally absent from the public
    // "My Materials" view.  This private manager resolves the bound evidence
    // through purpose=all so existing certification and reuse remain intact.
    void fetchMaterialLibrary('all').then(result => {
      if (live) setMaterials(result.items.filter(item => item.type === 'image' || item.type === 'video'));
    }).catch(() => { if (live) setError('人物素材暂时无法读取，请稍后重试。'); });
    return () => { live = false; };
  }, []);

  const selectedPresenter = useMemo(() => value.presenters.find(item => item.id === value.defaultPresenterId)
    || value.presenters[0], [value.defaultPresenterId, value.presenters]);
  const selectedPresenterSelected = presenterSelected(selectedPresenter);
  const selectedPresenterReady = presenterReady(selectedPresenter);
  const selectedVoiceReady = voiceReady(selectedPresenter);
  const selectedHeyGenReady = heyGenReady(selectedPresenter);
  const selectedArkReady = arkReady(selectedPresenter);
  const selectedPresenterSetupReady = selectedPresenterReady && selectedVoiceReady && selectedArkReady;
  const selectedReferenceMaterials = useMemo(() => [...(selectedPresenter?.referenceMaterialIds || [])]
    .reverse()
    .map(id => materials.find(item => item.id === id))
    .filter((item): item is Material => Boolean(item)), [materials, selectedPresenter]);
  const selectedCreationId = selectedPresenter?.rightsEvidence?.authorizationRef
    ?.match(/^document:\/\/studio_presenter_assets\/([^/]+)\//)?.[1];
  const selectedPreparedArk = (preparedArk?.presenterId === selectedPresenter?.id ? preparedArk : undefined)
    || (selectedCreationId ? creationPreparations[selectedCreationId] : undefined);
  const reusablePhotoMaterialId = selectedPreparedArk?.photoMaterialId
    || selectedReferenceMaterials.find(item => item.type === 'image')?.id;
  const reusableVideoMaterialId = selectedPreparedArk?.videoMaterialId
    || selectedReferenceMaterials.find(item => item.type === 'video')?.id;

  useEffect(() => {
    if (initialConfiguration && loaded && selectedPresenterSetupReady && !initialReadyNotified.current) {
      initialReadyNotified.current = true;
      onInitialSelection?.();
    }
  }, [initialConfiguration, loaded, onInitialSelection, selectedPresenterSetupReady]);

  const openPresenterManager = () => {
    setShowArkSetup(false);
    setShowVoiceRecorder(false);
    setShowHeyGenManager(true);
  };

  const openVoiceRecorder = () => {
    setShowArkSetup(false);
    setShowHeyGenManager(false);
    setShowVoiceRecorder(true);
  };

  const refresh = async (successMessage?: string) => {
    const next = await load();
    notifyPresenterAssetsUpdated();
    if (successMessage) setMessage(successMessage);
    return next;
  };

  const startArkEnrollment = async (input: {
    name: string;
    photo?: File;
    video?: File;
    photoMaterialId?: string;
    videoMaterialId?: string;
    requestId: string;
  }, targetPresenterId?: string) => {
    const current = await productionApi.defaults();
    const presenter = (targetPresenterId ? current.presenters.find(item => item.id === targetPresenterId) : undefined)
      || current.presenters.find(item => item.id === current.defaultPresenterId) || current.presenters[0];
    if (!presenter || !heyGenReady(presenter)) throw new Error('请先在左侧完成 HeyGen 人物和声音接入。');
    const photoMaterialId = input.photo
      ? (await productionApi.uploadArkMaterial(input.photo, 'image')).id
      : String(input.photoMaterialId || '');
    const videoMaterialId = input.video
      ? (await productionApi.uploadArkMaterial(input.video, 'video')).id
      : String(input.videoMaterialId || '');
    if (!photoMaterialId || !videoMaterialId) throw new Error('请同时提供清晰正面照片和本人视频。');
    const referenceMaterialIds = [...new Set([...(presenter.referenceMaterialIds || []), photoMaterialId, videoMaterialId])];
    const saved = await productionApi.saveDefaults({
      ...current,
      defaultPresenterId: presenter.id,
      presenters: current.presenters.map(item => item.id === presenter.id ? { ...item, referenceMaterialIds } : item),
    });
    setValue(saved);
    return productionApi.startArkEnrollment({
      requestId: input.requestId,
      presenterId: presenter.id,
      photoMaterialId,
      videoMaterialId,
      subjectAdultConfirmed: true,
      arkProcessingAuthorized: true,
    });
  };

  const finishUnifiedPresenterSetup = async (next: ProductionDefaults, context?: PresenterSaveContext) => {
    setValue(next); notifyPresenterAssetsUpdated(); setShowHeyGenManager(false); setShowVoiceRecorder(false); setError('');
    const preparation = context?.arkPreparation;
    if (preparation) {
      const presenter = next.presenters.find(item => item.id === next.defaultPresenterId) || next.presenters[0];
      if (presenter) {
        const referenceMaterialIds = [...new Set([...(presenter.referenceMaterialIds || []), preparation.photoMaterialId, preparation.videoMaterialId])];
        const saved = await productionApi.saveDefaults({
          ...next,
          defaultPresenterId: presenter.id,
          presenters: next.presenters.map(item => item.id === presenter.id ? { ...item, referenceMaterialIds } : item),
        });
        setValue(saved);
        notifyPresenterAssetsUpdated();
      }
      if (presenter) setPreparedArk({ ...preparation, presenterId: presenter.id });
    }
    setShowArkSetup(false);
    setMessage(preparation
      ? '人物与声音已保存，认证资料也已保留。请继续完成 HeyGen 与方舟认证。'
      : '人物与声音已保存。请继续完成 HeyGen 与方舟认证；三项全部完成后才能进入生产。');
  };

  const saveName = async () => {
    const name = editingName.trim();
    if (!editingId || !name) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await productionApi.saveDefaults({
        ...value,
        presenters: value.presenters.map(item => item.id === editingId ? { ...item, name } : item),
      });
      setValue(next); setEditingId(''); setEditingName('');
      notifyPresenterAssetsUpdated(); setMessage('人物名称已更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const revoke = (presenter: PresenterAsset) => {
    Modal.confirm({
      title: `取消“${presenter.name}”的使用授权？`,
      content: '取消后，灵枢会立即停止在新任务中使用该人物；供应商账户中的原始资产不会被删除。',
      okText: '取消授权',
      cancelText: '保留授权',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          const next = await presenterApi.revoke(presenter.id);
          setValue(next); notifyPresenterAssetsUpdated(); setMessage('人物授权已取消，后续任务不会再使用该人物。');
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
        finally { setBusy(false); }
      },
    });
  };

  if (initialConfiguration) return <section className="space-y-4" aria-label="数字人统一接入">
    <div>
      <h3 className="text-base font-semibold text-text-primary">数字人接入</h3>
      <p className="mt-1 text-xs leading-5 text-text-muted">选择数字人、录入声音、完成 HeyGen 与方舟认证可分别处理；三项都完成后，数字人才能进入生产。</p>
    </div>
    {!loaded ? loadError
      ? <Alert
        type="error"
        showIcon
        title="数字人配置读取失败"
        description={loadError}
        action={<Button className="min-h-11 text-xs" onClick={() => { setLoadError(''); void load().catch(cause => setLoadError(cause instanceof Error ? cause.message : String(cause))); }}>重新读取</Button>}
      />
      : <LsLoadingState loading label="正在读取数字人配置"><span /></LsLoadingState>
    : <>
      {error && <Alert type="error" showIcon title={error} />}
      {message && <Alert type="success" showIcon title={message} />}
      <section className="grid gap-3 md:grid-cols-3" aria-label="数字人生产准备">
        <article className={`flex min-h-48 flex-col rounded-lg border p-4 ${selectedPresenterSelected ? 'border-accent/30 bg-accent-glow' : 'border-border bg-surface'}`}>
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-accent"><UserRound size={18} aria-hidden="true" /></span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${selectedPresenterSelected ? 'text-green' : 'text-text-muted'}`}>{selectedPresenterSelected && <CheckCircle2 size={14} aria-hidden="true" />}{selectedPresenterSelected ? '已完成' : '待完成'}</span>
          </div>
          <div className="mt-4 flex-1"><p className="text-sm font-semibold text-text-primary">1. 选择数字人</p><p className="mt-1 text-xs leading-5 text-text-muted">{selectedPresenterSelected ? `当前人物：${selectedPresenter?.name}` : '选择 HeyGen 已有人物，或上传本人素材创建。'}</p></div>
          <Button block className="mt-4 min-h-10 text-xs" onClick={openPresenterManager}>{selectedPresenterSelected ? '更换数字人' : '选择数字人'}</Button>
        </article>
        <article className={`flex min-h-48 flex-col rounded-lg border p-4 ${selectedVoiceReady ? 'border-accent/30 bg-accent-glow' : 'border-border bg-surface'}`}>
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-accent"><Mic2 size={18} aria-hidden="true" /></span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${selectedVoiceReady ? 'text-green' : 'text-text-muted'}`}>{selectedVoiceReady && <CheckCircle2 size={14} aria-hidden="true" />}{selectedVoiceReady ? '已完成' : '待完成'}</span>
          </div>
          <div className="mt-4 flex-1"><p className="text-sm font-semibold text-text-primary">2. 录入声音</p><p className="mt-1 text-xs leading-5 text-text-muted">{selectedVoiceReady ? '本人声音已绑定到当前数字人。' : selectedPresenterSelected ? '录制或上传本人声音，并完成使用授权。' : '选择数字人后即可录入本人声音。'}</p></div>
          <Button block className="mt-4 min-h-10 text-xs" disabled={!selectedPresenterSelected} onClick={openVoiceRecorder}>{selectedVoiceReady ? '重新录入声音' : '录入本人声音'}</Button>
        </article>
        <article className={`flex min-h-48 flex-col rounded-lg border p-4 ${selectedPresenterReady && selectedArkReady ? 'border-accent/30 bg-accent-glow' : 'border-border bg-surface'}`}>
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-accent"><ShieldCheck size={18} aria-hidden="true" /></span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${selectedPresenterReady && selectedArkReady ? 'text-green' : 'text-text-muted'}`}>{selectedPresenterReady && selectedArkReady && <CheckCircle2 size={14} aria-hidden="true" />}{selectedPresenterReady && selectedArkReady ? '已完成' : '待完成'}</span>
          </div>
          <div className="mt-4 flex-1"><p className="text-sm font-semibold text-text-primary">3. 完成平台认证</p><div className="mt-2 space-y-1 text-xs text-text-muted"><p className="flex items-center justify-between gap-2"><span>HeyGen 本人授权</span><strong className={selectedPresenterReady ? 'text-green' : 'text-text-secondary'}>{selectedPresenterReady ? '已完成' : '待完成'}</strong></p><p className="flex items-center justify-between gap-2"><span>方舟人物认证</span><strong className={selectedArkReady ? 'text-green' : 'text-text-secondary'}>{selectedArkReady ? '已完成' : '待完成'}</strong></p></div></div>
          <Button block className="mt-4 min-h-10 text-xs" disabled={!selectedHeyGenReady || selectedArkReady} onClick={() => setShowArkSetup(current => !current)}>{selectedArkReady ? '双平台认证已完成' : showArkSetup ? '收起认证资料' : '完成双平台认证'}</Button>
        </article>
      </section>
      {showArkSetup && selectedPresenter && <ArkPresenterEnrollmentPanel
        presenterId={selectedPresenter.id}
        photos={materials.filter(item => item.type === 'image').map(item => ({ id: item.id, name: item.name }))}
        videos={materials.filter(item => item.type === 'video').map(item => ({ id: item.id, name: item.name }))}
        initialPhotoMaterialId={reusablePhotoMaterialId}
        initialVideoMaterialId={reusableVideoMaterialId}
        authorizationConfirmed={selectedPreparedArk?.processingAuthorized === true}
        onStart={startArkEnrollment}
        onReady={async () => { await refresh('方舟人物认证已完成，当前人物可以用于人物替换。'); onInitialSelection?.(); }}
      />}
      {selectedPresenterSetupReady && <div className="flex items-center gap-2 rounded-lg bg-green/10 px-4 py-3 text-xs font-semibold text-green"><CheckCircle2 size={16} />数字人、声音和双平台认证均已完成，可以进入生产。</div>}
      {showHeyGenManager && <PresenterManager initialConfiguration onClose={() => setShowHeyGenManager(false)} onSynced={next => { setValue(next); notifyPresenterAssetsUpdated(); }} onSaved={(next, context) => finishUnifiedPresenterSetup(next, context)} />}
      {showVoiceRecorder && selectedPresenter && <PresenterManager initialConfiguration voiceOnlyPresenter={selectedPresenter} onClose={() => setShowVoiceRecorder(false)} onSaved={next => finishUnifiedPresenterSetup(next)} />}
    </>}
  </section>;

  return <section className="rounded-lg border border-border bg-white p-5" aria-label={contentProduction ? '内容制作人物管理' : '人物与出镜'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-base font-semibold text-text-primary">人物与出镜</h3><p className="mt-1 text-xs text-text-muted">这里可以修改已接入人物、补全声音和方舟认证，或取消授权。</p></div>
      {contentProduction && <Button onClick={openDigitalHumanOnboarding}>打开数字人接入</Button>}
    </div>
    {error && <Alert className="mt-4" type="error" showIcon title={error} />}
    {message && <Alert className="mt-4" type="success" showIcon title={message} />}
    {!loaded ? <p role="status" className="mt-5 text-sm text-text-muted">正在读取已授权人物…</p> : !value.presenters.length ? <div className="mt-5 rounded-lg border border-dashed border-border p-8 text-center"><UserRound className="mx-auto text-text-muted" /><p className="mt-3 text-sm font-semibold">暂无已授权人物</p><p className="mt-1 text-xs text-text-muted">请前往数字员工新手引导完成首次接入。</p><Button className="mt-4" onClick={openDigitalHumanOnboarding}>打开数字人接入</Button></div> : <div className="mt-5 divide-y divide-border rounded-lg border border-border">
      {value.presenters.map(presenter => {
        const referenceIds = presenter.referenceMaterialIds || [];
        const creationId = presenter.rightsEvidence?.authorizationRef?.match(/^document:\/\/studio_presenter_assets\/([^/]+)\//)?.[1];
        const creationPreparation = creationId ? creationPreparations[creationId] : undefined;
        const initialPhotoMaterialId = materials.find(item => item.type === 'image' && referenceIds.includes(item.id))?.id
          || creationPreparation?.photoMaterialId;
        const initialVideoMaterialId = materials.find(item => item.type === 'video' && referenceIds.includes(item.id))?.id
          || creationPreparation?.videoMaterialId;
        const certificationOpen = certifyingPresenterId === presenter.id;
        return <article key={presenter.id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-sm font-semibold text-text-secondary">{presenter.name.slice(0, 1)}{presenter.imageUrl && <img src={presenter.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}</span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-text-primary">{presenter.name}</p><div className="mt-1 flex flex-wrap gap-1.5"><Tag color={heyGenReady(presenter) ? 'success' : 'default'}>HeyGen {heyGenReady(presenter) ? '已接入' : '未接入'}</Tag><Tag color={arkReady(presenter) ? 'success' : 'default'}>方舟 {arkReady(presenter) ? '已认证' : '未认证'}</Tag>{value.defaultPresenterId === presenter.id && <Tag color="blue">当前默认</Tag>}</div></div>
          </div>
          <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { setEditingId(presenter.id); setEditingName(presenter.name); }}>修改人物</Button>{heyGenReady(presenter) && !arkReady(presenter) && <Button disabled={busy} onClick={() => setCertifyingPresenterId(current => current === presenter.id ? '' : presenter.id)}>{certificationOpen ? '收起认证' : '完成方舟认证'}</Button>}<Button danger disabled={busy} onClick={() => revoke(presenter)}>取消授权</Button></div>
        </div>
        {editingId === presenter.id && <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-3"><label className="min-w-56 flex-1 text-xs font-semibold text-text-secondary">人物显示名称<input autoFocus value={editingName} maxLength={100} onChange={event => setEditingName(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary" /></label><LsBrandAction loading={busy} disabled={!editingName.trim()} onClick={() => void saveName()}>保存修改</LsBrandAction><Button disabled={busy} onClick={() => { setEditingId(''); setEditingName(''); }}>取消</Button></div>}
        {certificationOpen && <div className="mt-4"><ArkPresenterEnrollmentPanel
          presenterId={presenter.id}
          photos={materials.filter(item => item.type === 'image').map(item => ({ id: item.id, name: item.name }))}
          videos={materials.filter(item => item.type === 'video').map(item => ({ id: item.id, name: item.name }))}
          initialPhotoMaterialId={initialPhotoMaterialId}
          initialVideoMaterialId={initialVideoMaterialId}
          authorizationConfirmed={false}
          onStart={input => startArkEnrollment(input, presenter.id)}
          onReady={async () => { await refresh('方舟人物认证已完成，当前人物可以用于人物替换。'); setCertifyingPresenterId(''); }}
        /></div>}
      </article>;
      })}
    </div>}
    {contentProduction && <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted"><ShieldCheck size={14} />制作页面不再重复承载人物供应商配置。</p>}
  </section>;
}
