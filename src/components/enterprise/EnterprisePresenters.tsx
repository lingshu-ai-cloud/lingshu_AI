import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Tag } from 'antd';
import { CheckCircle2, ShieldCheck, UserRound } from 'lucide-react';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, presenterHasAppearance, type ProductionDefaults, type PresenterAsset } from '../../lib/shotProduction';
import { fetchMaterialLibrary, type Material } from '../../lib/studioApi';
import { presenterApi } from '../../lib/presenterApi';
import { notifyPresenterAssetsUpdated } from '../../lib/presenterAssetsUpdated';
import type { ArkPresenterPreparation } from '../../lib/presenterAssets';
import { LsBrandAction } from '../ui/LsExperiencePrimitives';
import ArkPresenterEnrollmentPanel from '../studio/ArkPresenterEnrollmentPanel';
import PresenterManager, { type PresenterSaveContext } from './PresenterManager';

function heyGenReady(presenter?: PresenterAsset): boolean {
  return Boolean(presenter?.authorized && (presenter.toolMappings?.heygen?.avatarId || presenter.avatarId)
    && (presenter.toolMappings?.heygen?.voiceId || presenter.voiceId));
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
  const [preparedArk, setPreparedArk] = useState<ArkPresenterPreparation>();
  const [certifyingPresenterId, setCertifyingPresenterId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');

  const load = useCallback(async () => {
    const next = await productionApi.defaults();
    setValue({ ...EMPTY_DEFAULTS, ...next, presenterRoutes: next.presenterRoutes || [] });
    setLoaded(true);
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    void load().catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [load]);

  useEffect(() => {
    let live = true;
    void fetchMaterialLibrary().then(result => {
      if (live) setMaterials(result.items.filter(item => item.type === 'image' || item.type === 'video'));
    }).catch(() => { if (live) setError('人物素材暂时无法读取，请稍后重试。'); });
    return () => { live = false; };
  }, []);

  const selectedPresenter = useMemo(() => value.presenters.find(item => item.id === value.defaultPresenterId), [value.defaultPresenterId, value.presenters]);
  const selectedHeyGenReady = heyGenReady(selectedPresenter);
  const selectedArkReady = arkReady(selectedPresenter);

  const openPresenterManager = () => {
    setShowArkSetup(false);
    setShowHeyGenManager(true);
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
    setValue(next); notifyPresenterAssetsUpdated(); setShowHeyGenManager(false); setError('');
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
      setPreparedArk(preparation);
    }
    setShowArkSetup(false);
    setMessage(preparation
      ? '口播人物与声音已保存，现在即可使用。照片和视频也已保留；需要高级人物替换时，再点击“完善人物替换认证”单独授权。'
      : '口播人物与声音已保存，现在即可使用。高级人物替换为可选功能，可稍后在企业知识库补充认证。');
    onInitialSelection?.();
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

  const selectForProduction = async (presenter: PresenterAsset) => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (!presenter.authorized || !presenterHasAppearance(presenter)) throw new Error('请先为该人物补齐已授权的照片、视频或数字人形象。');
      const next = await productionApi.saveDefaults({ ...value, preference: 'avatar', defaultPresenterId: presenter.id });
      setValue(next); notifyPresenterAssetsUpdated(); setMessage(`已选择“${presenter.name}”作为生产数字人形象。`); onInitialSelection?.();
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
      <p className="mt-1 text-xs leading-5 text-text-muted">选择 HeyGen 已有人物，或上传本人资料创建。人物替换认证是可选能力，不影响 HeyGen 口播。</p>
    </div>
    {error && <Alert type="error" showIcon title={error} />}
    {message && <Alert type="success" showIcon title={message} />}
    <section className={`rounded-lg border p-4 ${selectedHeyGenReady && selectedArkReady ? 'border-emerald-200 bg-emerald-50/60' : 'border-border bg-white'}`} aria-label="统一人物接入状态">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-text-primary">人物、声音与本人认证</p>{selectedPresenter && <p className="mt-2 text-xs text-text-secondary">当前人物：<strong>{selectedPresenter.name}</strong></p>}<div className="mt-3 flex flex-wrap gap-2"><Tag color={selectedHeyGenReady ? 'success' : 'default'}>口播人物与声音 {selectedHeyGenReady ? '已完成' : '待配置'}</Tag><Tag color={selectedArkReady ? 'success' : 'default'}>人物替换认证 {selectedArkReady ? '已完成' : selectedHeyGenReady ? '可选' : '等待人物'}</Tag></div></div>
        <div className="flex flex-wrap gap-2">
          {selectedHeyGenReady ? <Button onClick={openPresenterManager}>更换数字人</Button> : <LsBrandAction onClick={openPresenterManager}>设置数字人</LsBrandAction>}
          {selectedHeyGenReady && !selectedArkReady && <LsBrandAction onClick={() => setShowArkSetup(current => !current)}>{showArkSetup ? '收起人物替换认证' : '完善人物替换认证'}</LsBrandAction>}
        </div>
      </div>
    </section>
    {showArkSetup && selectedPresenter && <ArkPresenterEnrollmentPanel
      presenterId={selectedPresenter.id}
      photos={materials.filter(item => item.type === 'image').map(item => ({ id: item.id, name: item.name }))}
      videos={materials.filter(item => item.type === 'video').map(item => ({ id: item.id, name: item.name }))}
      initialPhotoMaterialId={preparedArk?.photoMaterialId}
      initialVideoMaterialId={preparedArk?.videoMaterialId}
      authorizationConfirmed={preparedArk?.processingAuthorized === true}
      onStart={startArkEnrollment}
      onReady={async () => { await refresh('方舟人物认证已完成，当前人物可以用于人物替换。'); onInitialSelection?.(); }}
    />}
    {selectedHeyGenReady && selectedArkReady && <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800"><CheckCircle2 size={16} />数字人口播与人物替换条件均已准备完成。</div>}
    {showHeyGenManager && <PresenterManager initialConfiguration onClose={() => setShowHeyGenManager(false)} onSynced={next => { setValue(next); notifyPresenterAssetsUpdated(); }} onSaved={(next, context) => finishUnifiedPresenterSetup(next, context)} />}
  </section>;

  return <section className="rounded-lg border border-border bg-white p-5" aria-label={contentProduction ? '内容制作人物管理' : '人物与出镜'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-base font-semibold text-text-primary">人物与出镜</h3><p className="mt-1 text-xs text-text-muted">这里可以修改已接入人物、补充可选的人物替换认证，或取消授权。</p></div>
      {contentProduction && <Button onClick={openPresenterManager}>录入数字人形象</Button>}
    </div>
    {error && <Alert className="mt-4" type="error" showIcon title={error} />}
    {message && <Alert className="mt-4" type="success" showIcon title={message} />}
    {!loaded ? <p role="status" className="mt-5 text-sm text-text-muted">正在读取已授权人物…</p> : !value.presenters.length ? <div className="mt-5 rounded-lg border border-dashed border-border p-8 text-center"><UserRound className="mx-auto text-text-muted" /><p className="mt-3 text-sm font-semibold">暂无已授权人物</p><p className="mt-1 text-xs text-text-muted">数字人形象是生产必填项，请选择已有形象或录入自己的形象。</p><Button className="mt-4" type="primary" onClick={contentProduction ? openPresenterManager : openDigitalHumanOnboarding}>录入数字人形象</Button></div> : <div className="mt-5 divide-y divide-border rounded-lg border border-border">
      {value.presenters.map(presenter => {
        const referenceIds = presenter.referenceMaterialIds || [];
        const initialPhotoMaterialId = materials.find(item => item.type === 'image' && referenceIds.includes(item.id))?.id;
        const initialVideoMaterialId = materials.find(item => item.type === 'video' && referenceIds.includes(item.id))?.id;
        const certificationOpen = certifyingPresenterId === presenter.id;
        return <article key={presenter.id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-sm font-semibold text-text-secondary">{presenter.name.slice(0, 1)}{presenter.imageUrl && <img src={presenter.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}</span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-text-primary">{presenter.name}</p><div className="mt-1 flex flex-wrap gap-1.5"><Tag color={heyGenReady(presenter) ? 'success' : 'default'}>HeyGen {heyGenReady(presenter) ? '已接入' : '未接入'}</Tag><Tag color={arkReady(presenter) ? 'success' : 'default'}>方舟 {arkReady(presenter) ? '已认证' : '未认证'}</Tag>{value.defaultPresenterId === presenter.id && <Tag color="blue">当前默认</Tag>}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">{value.defaultPresenterId !== presenter.id && <Button type="primary" disabled={busy || !presenterHasAppearance(presenter)} onClick={() => void selectForProduction(presenter)}>选择此形象</Button>}<Button disabled={busy} onClick={() => { setEditingId(presenter.id); setEditingName(presenter.name); }}>修改人物</Button>{heyGenReady(presenter) && !arkReady(presenter) && <Button disabled={busy} onClick={() => setCertifyingPresenterId(current => current === presenter.id ? '' : presenter.id)}>{certificationOpen ? '收起认证' : '人物替换认证'}</Button>}<Button danger disabled={busy} onClick={() => revoke(presenter)}>取消授权</Button></div>
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
    {contentProduction && <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><ShieldCheck size={14} />必须明确选择一个已授权数字人形象才能进入下一步；系统不会改用素材匹配或其他路线。</p>}
  </section>;
}
