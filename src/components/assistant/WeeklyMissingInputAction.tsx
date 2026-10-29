import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Select } from 'antd';
import type { DigitalEmployeeConfig, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { digitalEmployeeApi } from '../../lib/digitalEmployees';
import { safeProductionOnboarding } from '../smartBusiness/digitalEmployeeConfigRules';
import HomeIntroduction from '../HomeIntroduction';
import type { ProductionContactKind, ProductionOnboardingPreferences } from '../../../shared/contracts/productionOnboarding';
import { authHeader } from '../../lib/auth';
import { openAssistantWeeklyPlan } from '../../lib/assistantWeeklyPlanEvents';
import { DigitalEmployeeApiError } from '../../lib/digitalEmployeeApi';
import { showWeeklyReadinessGuidance } from '../../lib/weeklyReadinessGuidance';
import { notifyWeeklyWorkUpdated } from '../../lib/weeklyWorkEvents';
import { synchronizeWeeklyPlanFacts } from '../../lib/weeklyFactsSync';
import { studioApi } from '../../lib/studioApi';
import { probeMedia } from '../studio/studioMediaProbes';
import { STUDIO_MATERIAL_VIDEO_ACCEPT, studioMaterialFileKind } from '../../lib/studioMaterialFile';
import type { WeeklyMaterialGap } from '../../lib/weeklyMaterialGap';
import WeeklyMaterialGapCards from './WeeklyMaterialGapCards';

type EnterpriseProfileForInput = {
  company?: { name?: string; industry?: string; description?: string };
  brand?: { name?: string; tone?: string; style?: string; usp?: string };
  factVersion?: { contentHash?: string };
};
type FocusedEnterpriseField = { section: 'company' | 'brand'; field: string; label: string };
const focusedEnterpriseFields: FocusedEnterpriseField[] = [
  { section: 'company', field: 'name', label: '企业名称' },
  { section: 'company', field: 'industry', label: '主营行业' },
  { section: 'company', field: 'description', label: '企业主营业务介绍' },
  { section: 'brand', field: 'name', label: '品牌名称' },
];
export function firstMissingEnterpriseField(profile: EnterpriseProfileForInput): FocusedEnterpriseField | null {
  const missing = focusedEnterpriseFields.find(item => !String(profile[item.section]?.[item.field as keyof (typeof profile)[typeof item.section]] || '').trim());
  if (missing) return missing;
  if (!['tone', 'style', 'usp'].some(field => String(profile.brand?.[field as 'tone' | 'style' | 'usp'] || '').trim()))
    return { section: 'brand', field: 'tone', label: '品牌表达风格' };
  return null;
}

export type WeeklyMissingInputKind = 'company' | 'facts' | 'products' | 'presenter' | 'materials' | 'preferences' | 'contact';

export function weeklyMissingInputKind(content: string): WeeklyMissingInputKind | null {
  if (!content.startsWith('本周计划还没有开始，因为制作资料还缺：')
    && !content.startsWith('本周计划还没有开始。')
    && !content.startsWith('本周计划还没有开始。当前不是缺少某个企业资料输入框')
    && !content.startsWith('本周生产需要处理：')) return null;
  if (content.includes('点击“同步周计划”') || content.includes('先同步周计划。')) return 'facts';
  if (content.includes('先补齐企业与品牌资料。') || content.includes('先核对企业与品牌资料。')) return 'company';
  if (content.includes('先补齐主推产品资料和图片。')) return 'products';
  if (content.includes('先录入数字人物与声音。')) return 'presenter';
  if (content.includes('先上传对应镜头的视频素材。') || content.includes('先补充视频素材。')) return 'materials';
  if (content.includes('先填写对外联系方式。')) return 'contact';
  if (content.includes('先确认制作偏好。') || content.includes('请先确认生产偏好')) return 'preferences';
  return null;
}

const actionLabel: Record<WeeklyMissingInputKind, string> = {
  company: '补齐企业与品牌资料', facts: '同步周计划', products: '补全主推产品资料', presenter: '录入数字人',
  materials: '补充视频素材', preferences: '确认制作偏好', contact: '填写对外联系方式',
};

function checkedPreferences(config: DigitalEmployeeConfig): ProductionOnboardingPreferences {
  return safeProductionOnboarding(config, config.videoDefaults?.language || 'en');
}

export default function WeeklyMissingInputAction({ kind }: { kind: WeeklyMissingInputKind }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mayRecheck, setMayRecheck] = useState(false);
  const [mayConfirm, setMayConfirm] = useState(false);
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [preferences, setPreferences] = useState<ProductionOnboardingPreferences | null>(null);
  const [enterpriseProfile, setEnterpriseProfile] = useState<EnterpriseProfileForInput | null>(null);
  const [focusedValue, setFocusedValue] = useState('');
  const [materialGaps, setMaterialGaps] = useState<WeeklyMaterialGap[]>([]);
  const [selectedGapId, setSelectedGapId] = useState('');
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [materialRightsConfirmed, setMaterialRightsConfirmed] = useState(false);
  const [materialGoalId, setMaterialGoalId] = useState('');
  const [materialPreviewLoading, setMaterialPreviewLoading] = useState(false);
  const [materialPreviewError, setMaterialPreviewError] = useState('');
  const focusedField = enterpriseProfile ? firstMissingEnterpriseField(enterpriseProfile) : null;
  const priorityMaterialGaps = materialGaps.filter((gap, index) =>
    materialGaps.findIndex(candidate => candidate.video === gap.video) === index);

  useEffect(() => {
    if (kind !== 'materials') return;
    let cancelled = false;
    setMaterialPreviewLoading(true);
    void (async () => {
      try {
        const latest = await digitalEmployeeApi.overview();
        if (!latest.goal) throw new Error('当前没有可核验的周计划。');
        const readiness = await digitalEmployeeApi.weeklyProductionReadiness(latest.goal.id);
        if (cancelled) return;
        setMaterialGaps(readiness.materialGaps || []);
        setMaterialGoalId(latest.goal.id);
        setMaterialPreviewError('');
      } catch {
        if (!cancelled) setMaterialPreviewError('镜头暂时无法读取，请刷新页面重试。');
      } finally { if (!cancelled) setMaterialPreviewLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  const begin = async (targetGapId?: string) => {
    setLoading(true); setError(''); setNotice(''); setMayRecheck(false); setMayConfirm(false);
    try {
      if (kind === 'materials') {
        const latest = await digitalEmployeeApi.overview();
        if (!latest.goal) throw new Error('当前没有可补录的周计划。');
        const readiness = await digitalEmployeeApi.weeklyProductionReadiness(latest.goal.id);
        const gaps = readiness.materialGaps || [];
        if (!gaps.length) {
          if (readiness.ready) { setMayConfirm(true); setNotice('视频素材已通过核验，请确认周计划。'); return; }
          throw new Error('当前缺口暂时无法定位到具体视频镜头，请稍后重新核验。');
        }
        const selected = targetGapId ? gaps.find(gap => gap.requirementId === targetGapId) : gaps[0];
        if (!selected) {
          setMaterialGaps(gaps); setMayRecheck(true);
          setNotice('这处镜头缺口已变化，请按最新列表重新选择。');
          return;
        }
        setMaterialGaps(gaps); setSelectedGapId(selected.requirementId);
        setMaterialGoalId(latest.goal.id);
        setMaterialFile(null); setMaterialRightsConfirmed(false); setOpen(true);
        return;
      }
      if (kind === 'facts') {
        const latest = await digitalEmployeeApi.overview();
        if (!latest.goal || !latest.plan || latest.run) throw new Error('当前没有可同步的待确认周计划。');
        const readiness = await digitalEmployeeApi.weeklyProductionReadiness(latest.goal.id);
        if (!readiness.blockers.some(item => item.code === 'enterprise_facts_mismatch')) {
          setMayConfirm(true);
          setNotice('周计划已是最新资料，请核对后决定是否开始生产。');
          return;
        }
        if (!readiness.recovery) throw new Error('暂时无法读取同步所需的计划版本，请重新读取当前周计划。');
        const rebuilt = await synchronizeWeeklyPlanFacts(latest.goal, readiness.recovery);
        notifyWeeklyWorkUpdated({ source: 'assistant', goalId: rebuilt.goal.id, factsSynchronized: true });
        setMayConfirm(true);
        setNotice('已按最新企业资料更新周计划。请重新核对并确认；生产尚未开始。');
        return;
      }
      if (kind === 'company') {
        const response = await fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || '企业资料暂时无法读取。');
        const profile = (body.profile || body) as EnterpriseProfileForInput;
        setEnterpriseProfile(profile); setFocusedValue(''); setOpen(true);
        return;
      }
      const latest = await digitalEmployeeApi.overview();
      if (!latest.config) throw new Error('企业配置暂时无法读取，请稍后重试。');
      setOverview(latest);
      setPreferences(checkedPreferences(latest.config));
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '资料暂时无法读取，请稍后重试。');
    } finally { setLoading(false); }
  };

  const uploadMaterial = async () => {
    const gap = materialGaps.find(item => item.requirementId === selectedGapId);
    if (!gap || !materialFile || saving) return;
    if (studioMaterialFileKind(materialFile) !== 'video') { setError('请选择 MP4、MOV 或 WebM 视频。'); return; }
    if (!materialRightsConfirmed) { setError('请确认这段视频可供本企业营销制作使用。'); return; }
    setSaving(true); setError('');
    try {
      const media = await probeMedia(materialFile);
      if (!media.duration || media.duration < gap.minimumSeconds) throw new Error(`这段视频至少需要 ${gap.minimumSeconds} 秒。`);
      const result = await studioApi.uploadMaterialFile(materialFile, {
        folder: 'social', type: 'video', sourceType: 'local-upload', duration: media.duration,
        width: media.width, height: media.height, productId: gap.productId || undefined, rightsConfirmed: true,
      });
      if (!result.ok || !result.material?.id) throw new Error(result.error || '视频上传失败，请重试。');
      setMaterialFile(null); setMaterialRightsConfirmed(false); setOpen(false);
      setNotice(`「${materialFile.name}」已入库并提交后台分析。分析完成后请重新核验周计划；上传不代表镜头已经匹配。`);
      setMayRecheck(true);
      notifyWeeklyWorkUpdated({ source: 'assistant', goalId: materialGoalId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '视频上传失败，请重试。'); }
    finally { setSaving(false); }
  };

  const saveEnterpriseField = async () => {
    if (!enterpriseProfile || !focusedField || !focusedValue.trim() || saving) return;
    const hash = enterpriseProfile.factVersion?.contentHash;
    if (!hash) { setError('资料版本暂时无法核验，请刷新后重试。'); return; }
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/overseas/enterprise/profile', {
        method: 'PATCH', credentials: 'same-origin',
        headers: { ...authHeader(), 'Content-Type': 'application/json', 'If-Match': `"${hash}"` },
        body: JSON.stringify({ [focusedField.section]: { [focusedField.field]: focusedValue.trim() } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '保存失败，请重试。');
      const verification = await fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin', cache: 'no-store' });
      if (!verification.ok) throw new Error('资料已提交，但暂时无法核验保存结果；请刷新后核对。');
      const checkedBody = await verification.json();
      const checked = (checkedBody.profile || checkedBody) as EnterpriseProfileForInput;
      if (String(checked[focusedField.section]?.[focusedField.field as keyof (typeof checked)[typeof focusedField.section]] || '').trim() !== focusedValue.trim())
        throw new Error('保存结果与填写内容不一致，请刷新后核对。');
      setOpen(false);
      setNotice(`${focusedField.label}已保存到企业知识库。周计划仍需核对后再启动。`);
      setMayRecheck(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { setSaving(false); }
  };

  const savePreferences = async () => {
    if (!overview?.config || !preferences || saving) return;
    if (kind === 'contact' && preferences.contact.kind !== 'none'
      && (!preferences.contact.value.trim() || !preferences.contact.primaryCta.trim())) {
      setError('请填写公开联系方式和行动引导。'); return;
    }
    setSaving(true); setError('');
    try {
      await digitalEmployeeApi.completeOnboarding({
        ...overview.config,
        productionOnboarding: { ...preferences, confirmedAt: new Date().toISOString() },
      });
      setOpen(false);
      setNotice('资料已保存。现在可以重新核验周计划。');
      setMayRecheck(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，资料尚未更新。');
    } finally { setSaving(false); }
  };

  const recheck = async () => {
    if (loading) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const latest = await digitalEmployeeApi.overview();
      if (!latest.goal || !latest.plan) throw new Error('当前没有可核验的周计划。');
      const result = await digitalEmployeeApi.weeklyProductionReadiness(latest.goal.id);
      if (kind === 'materials') setMaterialGaps(result.materialGaps || []);
      if (result.ready) {
        setMayConfirm(true);
        setNotice('制作资料已通过核验。周计划仍需你确认才会开始生产。');
      } else {
        setMayConfirm(false);
        showWeeklyReadinessGuidance(new DigitalEmployeeApiError(409, 'production_onboarding_preflight_blocked',
          '制作资料尚未齐全', { blockers: result.blockers, materialGaps: result.materialGaps }));
        setNotice('已重新核验。请按最新对话补齐下一项资料。');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '周计划暂时无法核验，请稍后重试。'); }
    finally { setLoading(false); }
  };

  return <>
    {kind === 'materials' ? <>
      {materialPreviewLoading ? <p role="status" className="my-2 text-xs text-text-muted">正在读取镜头预览…</p> : null}
      {!materialPreviewLoading && materialPreviewError ? <p role="status" className="my-2 text-xs text-text-secondary">{materialPreviewError}</p> : null}
      {!materialPreviewLoading ? <WeeklyMaterialGapCards gaps={materialGaps} uploadBusy={loading} onUpload={gap => void begin(gap.requirementId)} /> : null}
    </> : null}
    {kind !== 'materials' && !(kind === 'facts' && mayConfirm) ? <Button loading={loading} onClick={() => void begin()} className="!h-auto min-h-9 whitespace-normal">{actionLabel[kind]}</Button> : null}
    {mayRecheck && <Button loading={loading} onClick={() => void recheck()} className="!h-auto min-h-9 whitespace-normal">重新核验周计划</Button>}
    {mayConfirm && <Button onClick={openAssistantWeeklyPlan} className="!h-auto min-h-9 whitespace-normal">查看并确认周计划</Button>}
    {error && !open ? <Alert type="error" showIcon title={error} className="mt-2" /> : null}
    {notice ? <p role="status" className="mt-2 text-xs text-text-secondary">{notice}</p> : null}
    {open && overview?.config && ['products', 'presenter'].includes(kind) ? <HomeIntroduction
      open initialConfig={overview.config}
      initialStep={kind === 'products' ? 'products' : kind === 'presenter' ? 'presenter' : 'start'}
      onClose={() => setOpen(false)} onComplete={() => {
        setOpen(false);
        setNotice('录入流程已完成。现在可以重新核验周计划。');
        setMayRecheck(true);
      }} /> : null}
    <Modal open={open && kind === 'materials'} title="补充本周视频素材" onCancel={() => { if (!saving) setOpen(false); }}
      footer={<><Button disabled={saving} onClick={() => setOpen(false)}>稍后再补</Button><Button type="primary" loading={saving} disabled={!materialFile || !materialRightsConfirmed} onClick={() => void uploadMaterial()}>上传并分析</Button></>}>
      <p className="mb-3 text-sm text-text-secondary">先为每条视频补最早缺少的镜头。上传后会分析匹配，其他缺口随后继续提示。</p>
      <ol className="max-h-56 list-decimal space-y-2 overflow-y-auto pl-5 text-sm text-text-primary">
        {priorityMaterialGaps.map(gap => <li key={gap.requirementId} className="leading-5">
          <span className="font-medium">{gap.video}</span> · 镜头 {gap.shot} · {gap.footage.split('（参考画面：')[0]}
        </li>)}
      </ol>
      <label className="mt-4 block text-sm text-text-primary">选择要补的镜头
        <Select className="mt-1 w-full" aria-label="选择要补的镜头" value={selectedGapId}
          options={priorityMaterialGaps.map(gap => ({ value: gap.requirementId, label: `${gap.video} · 镜头 ${gap.shot}` }))}
          onChange={value => { setSelectedGapId(value); setMaterialFile(null); setError(''); }} />
      </label>
      <label className="mt-3 block text-sm text-text-primary">上传对应视频（MP4、MOV 或 WebM，最多 100 MB）
        <input className="mt-1 block w-full text-sm" type="file" accept={STUDIO_MATERIAL_VIDEO_ACCEPT}
          onChange={event => setMaterialFile(event.target.files?.[0] || null)} />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-text-secondary"><input type="checkbox" className="mt-1" checked={materialRightsConfirmed}
        onChange={event => setMaterialRightsConfirmed(event.target.checked)} />确认这段视频可供本企业营销制作使用</label>
      {error ? <Alert type="error" showIcon title={error} className="mt-3" /> : null}
    </Modal>
    <Modal open={open && kind === 'company'} title={focusedField ? `补充${focusedField.label}` : '核对周计划资料'}
      onCancel={() => { if (!saving) setOpen(false); }}
      footer={focusedField ? <><Button disabled={saving} onClick={() => setOpen(false)}>稍后再填</Button><Button type="primary" loading={saving} disabled={!focusedValue.trim()} onClick={() => void saveEnterpriseField()}>保存到企业知识库</Button></>
        : <><Button onClick={() => setOpen(false)}>关闭</Button><Button type="primary" onClick={() => { setOpen(false); openAssistantWeeklyPlan(); }}>核对当前周计划</Button></>}>
      {focusedField ? <label className="block py-3 text-sm text-text-primary">{focusedField.label}
        <Input className="mt-2" aria-label={focusedField.label} value={focusedValue} maxLength={focusedField.field === 'description' ? 2000 : 120}
          onChange={event => setFocusedValue(event.target.value)} />
      </label> : <p className="py-3 text-sm text-text-secondary">企业与品牌资料没有空缺字段。当前问题是周计划引用的资料版本与已确认版本不一致，需要核对并更新周计划，而不是重新填写整套企业资料。</p>}
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
    <Modal open={open && (kind === 'preferences' || kind === 'contact')}
      title={actionLabel[kind]} onCancel={() => { if (!saving) setOpen(false); }}
      footer={<><Button disabled={saving} onClick={() => setOpen(false)}>稍后再填</Button><Button type="primary" loading={saving} onClick={() => void savePreferences()}>保存资料</Button></>}>
      {kind === 'preferences' && preferences ? <div className="space-y-4 py-3">
        <label className="block text-sm text-text-primary">成片语言
          <Input className="mt-1" aria-label="成片语言" value={preferences.output.primaryLanguage} maxLength={20}
            onChange={event => setPreferences(current => current && ({ ...current, output: { ...current.output, primaryLanguage: event.target.value } }))} />
        </label>
        <label className="block text-sm text-text-primary">成片画幅
          <Select className="mt-1 w-full" aria-label="成片画幅" value={preferences.output.aspectRatio} options={['9:16', '16:9', '1:1'].map(value => ({ value, label: value }))}
            onChange={value => setPreferences(current => current && ({ ...current, output: { ...current.output, aspectRatio: value } }))} />
        </label>
      </div> : null}
      {kind === 'contact' && preferences ? <div className="space-y-4 py-3">
        <label className="block text-sm text-text-primary">对外联系渠道
          <Select className="mt-1 w-full" aria-label="对外联系渠道" value={preferences.contact.kind}
            options={([['whatsapp', 'WhatsApp'], ['email', '电子邮件'], ['phone', '电话'], ['website', '网站'], ['wechat', '微信'], ['none', '暂不展示联系方式']] as const).map(([value, label]) => ({ value, label }))}
            onChange={(value: ProductionContactKind) => setPreferences(current => current && ({ ...current, contact: { ...current.contact, kind: value } }))} />
        </label>
        {preferences.contact.kind !== 'none' ? <>
          <label className="block text-sm text-text-primary">公开联系方式
            <Input className="mt-1" aria-label="公开联系方式" value={preferences.contact.value} maxLength={300}
              onChange={event => setPreferences(current => current && ({ ...current, contact: { ...current.contact, value: event.target.value } }))} />
          </label>
          <label className="block text-sm text-text-primary">内容中的行动引导
            <Input className="mt-1" aria-label="内容中的行动引导" value={preferences.contact.primaryCta} maxLength={240}
              onChange={event => setPreferences(current => current && ({ ...current, contact: { ...current.contact, primaryCta: event.target.value } }))} />
          </label>
        </> : null}
      </div> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  </>;
}
