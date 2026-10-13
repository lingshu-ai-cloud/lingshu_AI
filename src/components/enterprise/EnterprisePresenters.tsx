import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Tag } from 'antd';
import { CheckCircle2, ShieldCheck, UserRound } from 'lucide-react';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, type ProductionDefaults, type PresenterAsset } from '../../lib/shotProduction';
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
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'digitalEmployees' } }));
  window.requestAnimationFrame?.(() => window.dispatchEvent(new CustomEvent(
    'lingshu:open-digital-employee-guide',
    { detail: { step: 'presenter' } },
  )));
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
    if (!initialConfiguration) return;
    let live = true;
    void fetchMaterialLibrary().then(result => {
      if (live) setMaterials(result.items.filter(item => item.type === 'image' || item.type === 'video'));
    }).catch(() => { if (live) setError('人物素材暂时无法读取，请稍后重试。'); });
    return () => { live = false; };
  }, [initialConfiguration]);

  const selectedPresenter = useMemo(() => value.presenters.find(item => item.id === value.defaultPresenterId)
    || value.presenters[0], [value.defaultPresenterId, value.presenters]);
  const selectedHeyGenReady = heyGenReady(selectedPresenter);
  const selectedArkReady = arkReady(selectedPresenter);

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
  }) => {
    const current = await productionApi.defaults();
    const presenter = current.presenters.find(item => item.id === current.defaultPresenterId) || current.presenters[0];
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
    if (!preparation) {
      setShowArkSetup(true);
      setMessage('人物与声音已保存。这个人物还没有可复用的方舟认证资料，只需再补充一次照片和本人视频。');
      return;
    }
    setPreparedArk(preparation);
    try {
      const enrollment = await startArkEnrollment({
        name: '',
        photoMaterialId: preparation.photoMaterialId,
        videoMaterialId: preparation.videoMaterialId,
        requestId: `unified-${context?.creationId || next.defaultPresenterId}`,
      });
      setShowArkSetup(true);
      setMessage(enrollment.state === 'needs_verification'
        ? '人物与声音已保存，同一套照片和视频已自动提交方舟。请完成人验证。'
        : '人物与声音已保存，同一套资料已自动进入方舟认证。');
    } catch (cause) {
      setShowArkSetup(true);
      setMessage('人物、声音和复用资料均已保存，不需要再次上传。');
      setError(`方舟认证暂未启动：${cause instanceof Error ? cause.message : String(cause)}`);
    }
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
      <p className="mt-1 text-xs leading-5 text-text-muted">在这里一次完成口播人物、声音和人物替换认证。以后企业资料只用于修改人物或取消授权。</p>
    </div>
    {error && <Alert type="error" showIcon title={error} />}
    {message && <Alert type="success" showIcon title={message} />}
    <section className={`rounded-lg border p-4 ${selectedHeyGenReady && selectedArkReady ? 'border-emerald-200 bg-emerald-50/60' : 'border-border bg-white'}`} aria-label="统一人物接入状态">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-text-primary">人物、声音与本人认证</p>{selectedPresenter && <p className="mt-2 text-xs text-text-secondary">当前人物：<strong>{selectedPresenter.name}</strong></p>}<div className="mt-3 flex flex-wrap gap-2"><Tag color={selectedHeyGenReady ? 'success' : 'default'}>口播人物与声音 {selectedHeyGenReady ? '已完成' : '待配置'}</Tag><Tag color={selectedArkReady ? 'success' : 'default'}>人物替换认证 {selectedArkReady ? '已完成' : selectedHeyGenReady ? '待继续' : '等待人物'}</Tag></div></div>
        {!selectedHeyGenReady ? <LsBrandAction onClick={() => setShowHeyGenManager(true)}>开始统一接入</LsBrandAction> : !selectedArkReady ? <LsBrandAction onClick={() => setShowArkSetup(current => !current)}>{showArkSetup ? '收起认证状态' : '继续人物认证'}</LsBrandAction> : <Button onClick={() => setShowHeyGenManager(true)}>更换人物</Button>}
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
      <div><h3 className="text-base font-semibold text-text-primary">人物与出镜</h3><p className="mt-1 text-xs text-text-muted">这里只维护已接入人物。新增人物、声音和认证统一在数字员工新手引导中完成。</p></div>
      {contentProduction && <Button onClick={openDigitalHumanOnboarding}>打开数字人接入</Button>}
    </div>
    {error && <Alert className="mt-4" type="error" showIcon title={error} />}
    {message && <Alert className="mt-4" type="success" showIcon title={message} />}
    {!loaded ? <p role="status" className="mt-5 text-sm text-text-muted">正在读取已授权人物…</p> : !value.presenters.length ? <div className="mt-5 rounded-lg border border-dashed border-border p-8 text-center"><UserRound className="mx-auto text-text-muted" /><p className="mt-3 text-sm font-semibold">暂无已授权人物</p><p className="mt-1 text-xs text-text-muted">请前往数字员工新手引导完成首次接入。</p><Button className="mt-4" onClick={openDigitalHumanOnboarding}>打开数字人接入</Button></div> : <div className="mt-5 divide-y divide-border rounded-lg border border-border">
      {value.presenters.map(presenter => <article key={presenter.id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-sm font-semibold text-text-secondary">{presenter.name.slice(0, 1)}{presenter.imageUrl && <img src={presenter.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}</span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-text-primary">{presenter.name}</p><div className="mt-1 flex flex-wrap gap-1.5"><Tag color={heyGenReady(presenter) ? 'success' : 'default'}>HeyGen {heyGenReady(presenter) ? '已接入' : '未接入'}</Tag><Tag color={arkReady(presenter) ? 'success' : 'default'}>方舟 {arkReady(presenter) ? '已认证' : '未认证'}</Tag>{value.defaultPresenterId === presenter.id && <Tag color="blue">当前默认</Tag>}</div></div>
          </div>
          <div className="flex gap-2"><Button disabled={busy} onClick={() => { setEditingId(presenter.id); setEditingName(presenter.name); }}>修改人物</Button><Button danger disabled={busy} onClick={() => revoke(presenter)}>取消授权</Button></div>
        </div>
        {editingId === presenter.id && <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-3"><label className="min-w-56 flex-1 text-xs font-semibold text-text-secondary">人物显示名称<input autoFocus value={editingName} maxLength={100} onChange={event => setEditingName(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary" /></label><LsBrandAction loading={busy} disabled={!editingName.trim()} onClick={() => void saveName()}>保存修改</LsBrandAction><Button disabled={busy} onClick={() => { setEditingId(''); setEditingName(''); }}>取消</Button></div>}
      </article>)}
    </div>}
    {contentProduction && <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted"><ShieldCheck size={14} />制作页面不再重复承载人物供应商配置。</p>}
  </section>;
}
