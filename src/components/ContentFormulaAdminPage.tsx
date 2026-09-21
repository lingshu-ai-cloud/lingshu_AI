import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Beaker,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleOff,
  Clapperboard,
  FlaskConical,
  Loader2,
  Mic2,
  Music2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Subtitles,
  Trash2,
} from 'lucide-react';
import { PAGE_REGISTRY } from '../pageRegistry';
import {
  createContentFormula,
  createDefaultContentFormulaNode,
  DEFAULT_CONTENT_FORMULA_DIRECTION,
  disableContentFormula,
  listContentFormulas,
  publishContentFormula,
  startContentFormulaTrial,
  type ContentFormula,
  type ContentFormulaDirection,
  type ContentFormulaNode,
  type ContentFormulaStatus,
  type ContentThemeId,
  validateContentFormulaDraft,
} from '../lib/contentFormulas';

const THEME_LABELS: Record<ContentThemeId, string> = {
  product_value: '产品与卖点',
  scenario_solution: '场景与解决方案',
  supplier_capability: '企业与供应保障',
  customization_process: '定制与合作流程',
  customer_case: '客户案例与合作成果',
};

const STATUS_LABELS: Record<ContentFormulaStatus, string> = {
  draft: '草稿', internal_trial: '内测', gray: '灰度中', active: '已启用', disabled: '已停用',
};

const STATUS_TONES: Record<ContentFormulaStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  internal_trial: 'bg-violet-100 text-violet-800',
  gray: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  disabled: 'bg-red-100 text-red-700',
};

type DraftNode = ContentFormulaNode;

const NEW_NODE = (index: number): DraftNode => createDefaultContentFormulaNode(index);
const NEW_DIRECTION = (): ContentFormulaDirection => structuredClone(DEFAULT_CONTENT_FORMULA_DIRECTION);
function nextNode(nodes: DraftNode[]): DraftNode {
  const existing = new Set(nodes.map(node => node.nodeId));
  let index = 0;
  while (existing.has(`shot_${index + 1}`)) index += 1;
  return NEW_NODE(index);
}

const PACE_OPTIONS: Array<[ContentFormulaDirection['pace'], string]> = [
  ['fast', '快节奏'], ['balanced', '均衡'], ['steady', '稳健'],
];
const VOICE_PRESET_OPTIONS: Array<[ContentFormulaDirection['voiceover']['preset'], string]> = [
  ['professional_b2b', '专业 B2B'], ['authentic_review', '真实测评'], ['tiktok_excited', '短视频高能'], ['warm_story', '温暖叙事'], ['urgent_cta', '强行动号召'],
];
const PAUSE_OPTIONS: Array<[ContentFormulaDirection['voiceover']['pauseStyle'], string]> = [
  ['few', '少停顿'], ['natural', '自然停顿'], ['dramatic', '强调停顿'],
];
const MUSIC_SOURCE_OPTIONS: Array<[ContentFormulaDirection['music']['sourceType'], string]> = [
  ['licensed_library', '已授权音乐库'], ['original', '原创音乐'], ['none', '不使用音乐'],
];
const FALLBACK_OPTIONS: Array<[ContentFormulaDirection['materialFallback']['insufficientMaterialAction'], string]> = [
  ['adapt_with_verified_assets', '用已核验素材调整方案'], ['request_reshoot', '请求补拍'], ['block', '阻断生产'],
];
const ORIENTATION_OPTIONS: Array<[ContentFormulaNode['orientation'], string]> = [
  ['portrait', '竖屏'], ['landscape', '横屏'], ['either', '不限'],
];
const SHOT_TYPE_OPTIONS: Array<[ContentFormulaNode['shotType'], string]> = [
  ['live_action', '真人实拍'], ['product_demo', '产品演示'], ['process', '流程展示'], ['talking_head', '人物口播'], ['graphic', '图形画面'],
];
const SHOT_SIZE_OPTIONS: Array<[ContentFormulaNode['shotSize'], string]> = [
  ['extreme_close_up', '特写'], ['close_up', '近景'], ['medium', '中景'], ['wide', '全景'], ['detail', '细节镜头'],
];
const CAMERA_MOVEMENT_OPTIONS: Array<[ContentFormulaNode['cameraMovement'], string]> = [
  ['static', '固定'], ['pan', '水平摇镜'], ['tilt', '上下摇镜'], ['push_in', '推近'], ['pull_out', '拉远'], ['tracking', '跟拍'], ['handheld', '手持'],
];
const TRANSITION_OPTIONS: Array<[ContentFormulaNode['transition'], string]> = [
  ['cut', '硬切'], ['match_cut', '匹配剪辑'], ['dissolve', '叠化'], ['fade', '淡入淡出'], ['wipe', '擦除'],
];
const TEMPLATE_FIELDS = [
  { key: 'scriptTemplate', label: '脚本模板', icon: Clapperboard },
  { key: 'voiceoverTemplate', label: '口播模板', icon: Mic2 },
  { key: 'captionTemplate', label: '字幕模板', icon: Subtitles },
] as const;

const fieldClass = 'mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent';
const compactFieldClass = 'w-full rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent';

function directionSummary(direction: ContentFormulaDirection): string {
  const pace = PACE_OPTIONS.find(([value]) => value === direction.pace)?.[1] || direction.pace;
  const preset = VOICE_PRESET_OPTIONS.find(([value]) => value === direction.voiceover.preset)?.[1] || direction.voiceover.preset;
  return `${pace} · ${direction.visualStyle} · ${direction.music.mood} ${direction.music.volume}% · ${preset} ${direction.voiceover.speed}× · 字幕 ${direction.subtitles.fontScale}× / 底部 ${Math.round(direction.subtitles.bottomRatio * 100)}%`;
}

const textToDraftLines = (value: string): string[] => value.split(/\r?\n/);
const normalizeLines = (values: string[]): string[] => [...new Set(values.map(item => item.trim()).filter(Boolean))];
function nextGateId(gates: ContentFormulaDirection['acceptanceGates']): string {
  const existing = new Set(gates.map(gate => gate.gateId));
  let index = 1;
  while (existing.has(`gate_${index}`)) index += 1;
  return `gate_${index}`;
}

function nextFormulaId(name: string) {
  const seed = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `custom.${seed || `formula-${Date.now().toString(36)}`}`;
}

function statusHint(formula: ContentFormula) {
  if (!formula.recordId) return '系统内置，只读';
  if (formula.status === 'draft') return '可先进入内测，不会影响客户';
  if (formula.status === 'internal_trial') return '内测通过后可灰度或全量发布';
  if (formula.status === 'gray') return `当前仅覆盖 ${formula.rollout.tenantAllowlist.length} 个指定租户`;
  if (formula.status === 'active') return '主题匹配时可被正式选中';
  return '已从匹配池移除';
}

export default function ContentFormulaAdminPage() {
  const [items, setItems] = useState<ContentFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingKey, setActingKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [grayTenantInputs, setGrayTenantInputs] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [formulaId, setFormulaId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [themeId, setThemeId] = useState<ContentThemeId>('product_value');
  const [direction, setDirection] = useState<ContentFormulaDirection>(NEW_DIRECTION);
  const [nodes, setNodes] = useState<DraftNode[]>([NEW_NODE(0), NEW_NODE(1), NEW_NODE(2)]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setItems(await listContentFormulas()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : '无法读取爆款公式'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    active: items.filter(item => item.status === 'active').length,
    testing: items.filter(item => item.status === 'internal_trial' || item.status === 'gray').length,
    draft: items.filter(item => item.status === 'draft').length,
  }), [items]);

  const resetEditor = () => {
    setName(''); setFormulaId(''); setVersion('1.0.0'); setThemeId('product_value');
    setDirection(NEW_DIRECTION());
    setNodes([NEW_NODE(0), NEW_NODE(1), NEW_NODE(2)]);
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanId = (formulaId.trim() || nextFormulaId(cleanName)).toLowerCase();
    const issues = validateContentFormulaDraft({ formulaId: cleanId, name: cleanName, version, direction, nodes });
    if (issues.length) { setError(issues.join('；')); return; }
    setActingKey('create'); setError(''); setNotice('');
    try {
      await createContentFormula({
        formulaId: cleanId,
        name: cleanName,
        version: version.trim(),
        themeId,
        direction: {
          ...direction,
          visualStyle: direction.visualStyle.trim(),
          music: {
            ...direction.music,
            mood: direction.music.mood.trim(),
            strategy: direction.music.strategy.trim(),
            licenseReference: direction.music.licenseReference?.trim() || null,
          },
          voiceover: { ...direction.voiceover, voice: direction.voiceover.voice.trim() },
          subtitles: { ...direction.subtitles, styleIntent: direction.subtitles.styleIntent.trim() },
          cover: {
            ...direction.cover,
            intent: direction.cover.intent.trim(),
            headlineTemplate: { zh: direction.cover.headlineTemplate.zh.trim(), en: direction.cover.headlineTemplate.en.trim() },
            subject: direction.cover.subject.trim(),
            composition: direction.cover.composition.trim(),
          },
          risks: {
            prohibitedClaims: normalizeLines(direction.risks.prohibitedClaims),
            prohibitedVisuals: normalizeLines(direction.risks.prohibitedVisuals),
            mandatoryDisclosures: normalizeLines(direction.risks.mandatoryDisclosures),
          },
          acceptanceGates: direction.acceptanceGates.map(gate => ({
            ...gate, gateId: gate.gateId.trim(), name: gate.name.trim(), rule: gate.rule.trim(),
          })),
        },
        nodes: nodes.map(node => ({
          ...node,
          nodeId: node.nodeId.trim(),
          shotFunction: node.shotFunction.trim(),
          subject: node.subject.trim(),
          action: node.action.trim(),
          environment: node.environment?.trim() || null,
          composition: node.composition.trim(),
          scriptTemplate: { zh: node.scriptTemplate.zh.trim(), en: node.scriptTemplate.en.trim() },
          voiceoverTemplate: { zh: node.voiceoverTemplate.zh.trim(), en: node.voiceoverTemplate.en.trim() },
          captionTemplate: { zh: node.captionTemplate.zh.trim(), en: node.captionTemplate.en.trim() },
        })),
        note: '由爆款公式库创建',
      });
      setNotice('公式草稿已保存。先内测，再灰度或正式启用。');
      setShowEditor(false); resetEditor(); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '公式保存失败'); }
    finally { setActingKey(''); }
  };

  const act = async (formula: ContentFormula, action: 'trial' | 'gray' | 'active' | 'disable') => {
    const key = `${formula.formulaId}:${formula.version}:${action}`;
    const formulaKey = `${formula.formulaId}:${formula.version}`;
    const grayTenantAllowlist = action === 'gray'
      ? [...new Set((grayTenantInputs[formulaKey] ?? formula.rollout.tenantAllowlist.join(',')).split(/[,，\s]+/).map(item => item.trim()).filter(Boolean))]
      : [];
    if (action === 'gray' && grayTenantAllowlist.length === 0) {
      setError('灰度发布前，请至少填写一个明确的租户 ID。'); return;
    }
    setActingKey(key); setError(''); setNotice('');
    try {
      if (action === 'trial') await startContentFormulaTrial(formula);
      if (action === 'gray') await publishContentFormula(formula, 'gray', { percentage: 0, tenantAllowlist: grayTenantAllowlist });
      if (action === 'active') await publishContentFormula(formula, 'active');
      if (action === 'disable') await disableContentFormula(formula);
      setNotice(action === 'trial' ? '已进入内测，不影响普通用户。' : action === 'gray' ? `已仅向 ${grayTenantAllowlist.length} 个指定租户开放。` : action === 'active' ? '公式已正式启用。' : '公式已停用。');
      await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : '操作失败'); }
    finally { setActingKey(''); }
  };

  const updateNode = <K extends keyof DraftNode,>(index: number, key: K, value: DraftNode[K]) => {
    setNodes(current => current.map((node, nodeIndex) => nodeIndex === index ? { ...node, [key]: value } : node));
  };

  const updateNodeTemplate = (
    index: number,
    key: 'scriptTemplate' | 'voiceoverTemplate' | 'captionTemplate',
    language: 'zh' | 'en',
    value: string,
  ) => {
    setNodes(current => current.map((node, nodeIndex) => nodeIndex === index
      ? { ...node, [key]: { ...node[key], [language]: value } }
      : node));
  };

  const updateGate = (index: number, patch: Partial<ContentFormulaDirection['acceptanceGates'][number]>) => {
    setDirection(current => ({
      ...current,
      acceptanceGates: current.acceptanceGates.map((gate, gateIndex) => gateIndex === index ? { ...gate, ...patch } : gate),
    }));
  };

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-surface-2 p-4 md:p-6">
      <div className="mx-auto flex max-w-[1450px] flex-col gap-5">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold text-accent">平台管理员专用</p>
            <h1 className="mt-1 text-2xl font-black text-text-primary">{PAGE_REGISTRY.contentFormulaAdmin.canonicalTitle}</h1>
            <p className="mt-1 text-sm text-text-muted">用户只会看到可审核的导演方案摘要；公式名称、模板原文、版本与灰度策略不会出现在用户账号。</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新</button>
            <button type="button" onClick={() => setShowEditor(value => !value)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-black text-white"><Plus size={15} />录入公式</button>
          </div>
        </header>

        {(error || notice) && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white p-4"><p className="text-xs font-bold text-text-muted">正式启用</p><p className="mt-2 text-2xl font-black text-emerald-700">{counts.active}</p></div>
          <div className="rounded-2xl border border-border bg-white p-4"><p className="text-xs font-bold text-text-muted">内测 / 灰度</p><p className="mt-2 text-2xl font-black text-violet-700">{counts.testing}</p></div>
          <div className="rounded-2xl border border-border bg-white p-4"><p className="text-xs font-bold text-text-muted">待验证草稿</p><p className="mt-2 text-2xl font-black text-slate-700">{counts.draft}</p></div>
        </section>

        {showEditor && (
          <section className="rounded-2xl border border-accent/30 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3"><FlaskConical size={20} className="mt-0.5 text-accent" /><div><h2 className="text-base font-black text-text-primary">录入一个新公式草稿</h2><p className="mt-1 text-xs text-text-muted">公式需要同时定义导演风格与每个镜头的脚本、口播和字幕。保存后不会直接给客户使用。</p></div></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-bold text-text-secondary">公式名称<input value={name} onChange={event => { setName(event.target.value); if (!formulaId) setFormulaId(nextFormulaId(event.target.value)); }} maxLength={160} placeholder="例如：工厂实力证据链" className={fieldClass} /></label>
              <label className="text-xs font-bold text-text-secondary">内部编号<input value={formulaId} onChange={event => setFormulaId(event.target.value)} maxLength={120} placeholder="custom.factory-proof" className={fieldClass} /></label>
              <label className="text-xs font-bold text-text-secondary">版本<input value={version} onChange={event => setVersion(event.target.value)} maxLength={80} className={fieldClass} /></label>
              <label className="text-xs font-bold text-text-secondary">匹配主题<select value={themeId} onChange={event => setThemeId(event.target.value as ContentThemeId)} className={fieldClass}>{Object.entries(THEME_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            </div>

            <section data-content-formula-direction className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/35 p-4">
              <div className="flex items-start gap-2"><Music2 size={17} className="mt-0.5 text-emerald-700" /><div><h3 className="text-sm font-black text-text-primary">导演参数</h3><p className="mt-0.5 text-[11px] text-text-muted">这组参数会随导演方案一起交给内容 Agent。</p></div></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <label className="text-xs font-bold text-text-secondary">视频节奏<select aria-label="视频节奏" value={direction.pace} onChange={event => setDirection(current => ({ ...current, pace: event.target.value as ContentFormulaDirection['pace'] }))} className={fieldClass}>{PACE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-xs font-bold text-text-secondary sm:col-span-2 xl:col-span-2">视觉风格<input aria-label="视觉风格" value={direction.visualStyle} maxLength={500} onChange={event => setDirection(current => ({ ...current, visualStyle: event.target.value }))} placeholder="例如：真实工厂纪录感，低饱和度" className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary">音乐情绪<input aria-label="音乐情绪" value={direction.music.mood} maxLength={160} onChange={event => setDirection(current => ({ ...current, music: { ...current.music, mood: event.target.value } }))} className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary">音乐音量（0–100）<input aria-label="音乐音量" type="number" min={0} max={100} value={direction.music.volume} onChange={event => setDirection(current => ({ ...current, music: { ...current.music, volume: Number(event.target.value) } }))} className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary">配音音色<input aria-label="配音音色" value={direction.voiceover.voice} maxLength={80} onChange={event => setDirection(current => ({ ...current, voiceover: { ...current.voiceover, voice: event.target.value } }))} placeholder="例如 v1" className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary">配音风格<select aria-label="配音风格" value={direction.voiceover.preset} onChange={event => setDirection(current => ({ ...current, voiceover: { ...current.voiceover, preset: event.target.value as ContentFormulaDirection['voiceover']['preset'] } }))} className={fieldClass}>{VOICE_PRESET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-xs font-bold text-text-secondary">配音语速（0.75–1.5）<input aria-label="配音语速" type="number" min={0.75} max={1.5} step={0.05} value={direction.voiceover.speed} onChange={event => setDirection(current => ({ ...current, voiceover: { ...current.voiceover, speed: Number(event.target.value) } }))} className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary">口播停顿<select aria-label="口播停顿" value={direction.voiceover.pauseStyle} onChange={event => setDirection(current => ({ ...current, voiceover: { ...current.voiceover, pauseStyle: event.target.value as ContentFormulaDirection['voiceover']['pauseStyle'] } }))} className={fieldClass}>{PAUSE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-xs font-bold text-text-secondary">字幕字号（0.75–1.5）<input aria-label="字幕字号" type="number" min={0.75} max={1.5} step={0.05} value={direction.subtitles.fontScale} onChange={event => setDirection(current => ({ ...current, subtitles: { ...current.subtitles, fontScale: Number(event.target.value) } }))} className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary">字幕底部位置（8%–35%）<input aria-label="字幕底部位置" type="number" min={8} max={35} step={1} value={Math.round(direction.subtitles.bottomRatio * 100)} onChange={event => setDirection(current => ({ ...current, subtitles: { ...current.subtitles, bottomRatio: Number(event.target.value) / 100 } }))} className={fieldClass} /></label>
                <label className="text-xs font-bold text-text-secondary sm:col-span-2 xl:col-span-3">字幕风格意图<input aria-label="字幕风格意图" value={direction.subtitles.styleIntent} maxLength={300} onChange={event => setDirection(current => ({ ...current, subtitles: { ...current.subtitles, styleIntent: event.target.value } }))} placeholder="字体、颜色、高亮和换行要求" className={fieldClass} /></label>
              </div>

              <details className="mt-4 rounded-xl border border-emerald-100 bg-white">
                <summary className="cursor-pointer list-none px-4 py-3 text-xs font-black text-text-secondary">高级导演配置：音乐版权、封面、素材降级、风险与验收门槛</summary>
                <div className="space-y-5 border-t border-emerald-100 p-4">
                  <fieldset>
                    <legend className="text-xs font-black text-text-primary">音乐策略与授权</legend>
                    <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-xs font-bold text-text-secondary md:col-span-2">音乐策略<textarea aria-label="音乐策略" value={direction.music.strategy} maxLength={500} rows={2} onChange={event => setDirection(current => ({ ...current, music: { ...current.music, strategy: event.target.value } }))} className={`${fieldClass} resize-y`} /></label>
                      <label className="text-xs font-bold text-text-secondary">音乐来源<select aria-label="音乐来源" value={direction.music.sourceType} onChange={event => setDirection(current => ({ ...current, music: { ...current.music, sourceType: event.target.value as ContentFormulaDirection['music']['sourceType'] } }))} className={fieldClass}>{MUSIC_SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label className="flex items-center gap-2 self-end rounded-xl border border-border bg-slate-50 px-3 py-2.5 text-xs font-bold text-text-secondary"><input aria-label="已核验音乐授权" type="checkbox" checked={direction.music.licenseVerified} onChange={event => setDirection(current => ({ ...current, music: { ...current.music, licenseVerified: event.target.checked } }))} />已核验音乐授权</label>
                      <label className="text-xs font-bold text-text-secondary md:col-span-2 xl:col-span-4">授权依据<input aria-label="音乐授权依据" value={direction.music.licenseReference ?? ''} maxLength={500} disabled={direction.music.sourceType === 'none'} onChange={event => setDirection(current => ({ ...current, music: { ...current.music, licenseReference: event.target.value } }))} placeholder="许可证、资产编号或内部授权记录" className={fieldClass} /></label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-xs font-black text-text-primary">封面设计</legend>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-bold text-text-secondary">封面目标<input aria-label="封面目标" value={direction.cover.intent} maxLength={500} onChange={event => setDirection(current => ({ ...current, cover: { ...current.cover, intent: event.target.value } }))} className={fieldClass} /></label>
                      <label className="text-xs font-bold text-text-secondary">封面主体<input aria-label="封面主体" value={direction.cover.subject} maxLength={300} onChange={event => setDirection(current => ({ ...current, cover: { ...current.cover, subject: event.target.value } }))} className={fieldClass} /></label>
                      <label className="text-xs font-bold text-text-secondary md:col-span-2">封面构图<input aria-label="封面构图" value={direction.cover.composition} maxLength={500} onChange={event => setDirection(current => ({ ...current, cover: { ...current.cover, composition: event.target.value } }))} className={fieldClass} /></label>
                      <label className="text-xs font-bold text-text-secondary">封面标题中文<textarea aria-label="封面标题中文" value={direction.cover.headlineTemplate.zh} maxLength={1000} rows={2} onChange={event => setDirection(current => ({ ...current, cover: { ...current.cover, headlineTemplate: { ...current.cover.headlineTemplate, zh: event.target.value } } }))} className={`${fieldClass} resize-y`} /></label>
                      <label className="text-xs font-bold text-text-secondary">封面标题英文<textarea aria-label="封面标题英文" value={direction.cover.headlineTemplate.en} maxLength={1000} rows={2} onChange={event => setDirection(current => ({ ...current, cover: { ...current.cover, headlineTemplate: { ...current.cover.headlineTemplate, en: event.target.value } } }))} className={`${fieldClass} resize-y`} /></label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-xs font-black text-text-primary">素材不足时怎么做</legend>
                    <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <label className="text-xs font-bold text-text-secondary">最少可用素材数<input aria-label="最少可用素材数" type="number" min={1} max={12} step={1} value={direction.materialFallback.minimumUsableClips} onChange={event => setDirection(current => ({ ...current, materialFallback: { ...current.materialFallback, minimumUsableClips: Number(event.target.value) } }))} className={fieldClass} /></label>
                      <label className="text-xs font-bold text-text-secondary">单条最多重复次数<input aria-label="单条素材最多重复次数" type="number" min={0} max={12} step={1} value={direction.materialFallback.maxRepeatCount} onChange={event => setDirection(current => ({ ...current, materialFallback: { ...current.materialFallback, maxRepeatCount: Number(event.target.value) } }))} className={fieldClass} /></label>
                      <label className="text-xs font-bold text-text-secondary xl:col-span-2">不足时的动作<select aria-label="素材不足动作" value={direction.materialFallback.insufficientMaterialAction} onChange={event => setDirection(current => ({ ...current, materialFallback: { ...current.materialFallback, insufficientMaterialAction: event.target.value as ContentFormulaDirection['materialFallback']['insufficientMaterialAction'] } }))} className={fieldClass}>{FALLBACK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <div className="flex flex-col justify-end gap-2 rounded-xl border border-border bg-slate-50 px-3 py-2.5 text-xs font-bold text-text-secondary"><label className="flex items-center gap-2"><input aria-label="允许静帧" type="checkbox" checked={direction.materialFallback.allowStillFrames} onChange={event => setDirection(current => ({ ...current, materialFallback: { ...current.materialFallback, allowStillFrames: event.target.checked } }))} />允许静帧</label><label className="flex items-center gap-2"><input aria-label="允许重复素材" type="checkbox" checked={direction.materialFallback.allowRepeatedClips} onChange={event => setDirection(current => ({ ...current, materialFallback: { ...current.materialFallback, allowRepeatedClips: event.target.checked } }))} />允许重复素材</label></div>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-xs font-black text-text-primary">风险清单（每行一项）</legend>
                    <div className="mt-2 grid gap-3 lg:grid-cols-3">
                      <label className="text-xs font-bold text-text-secondary">禁用表述<textarea aria-label="禁用表述列表" value={direction.risks.prohibitedClaims.join('\n')} maxLength={10049} rows={4} onChange={event => setDirection(current => ({ ...current, risks: { ...current.risks, prohibitedClaims: textToDraftLines(event.target.value) } }))} className={`${fieldClass} resize-y`} /></label>
                      <label className="text-xs font-bold text-text-secondary">禁用画面<textarea aria-label="禁用画面列表" value={direction.risks.prohibitedVisuals.join('\n')} maxLength={10049} rows={4} onChange={event => setDirection(current => ({ ...current, risks: { ...current.risks, prohibitedVisuals: textToDraftLines(event.target.value) } }))} className={`${fieldClass} resize-y`} /></label>
                      <label className="text-xs font-bold text-text-secondary">必须披露<textarea aria-label="必须披露列表" value={direction.risks.mandatoryDisclosures.join('\n')} maxLength={10049} rows={4} onChange={event => setDirection(current => ({ ...current, risks: { ...current.risks, mandatoryDisclosures: textToDraftLines(event.target.value) } }))} className={`${fieldClass} resize-y`} /></label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-text-primary">验收门槛</span><button type="button" disabled={direction.acceptanceGates.length >= 20} onClick={() => setDirection(current => ({ ...current, acceptanceGates: [...current.acceptanceGates, { gateId: nextGateId(current.acceptanceGates), name: '', rule: '', blocking: false }] }))} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-text-secondary disabled:opacity-40">+增加门槛</button></div>
                    <div className="mt-2 space-y-2">{direction.acceptanceGates.map((gate, index) => <div key={index} className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 md:grid-cols-[140px_1fr_2fr_auto_auto]">
                      <input aria-label={`验收门槛 ${index + 1} 编号`} value={gate.gateId} maxLength={120} onChange={event => updateGate(index, { gateId: event.target.value })} placeholder="gate_id" className={compactFieldClass} />
                      <input aria-label={`验收门槛 ${index + 1} 名称`} value={gate.name} maxLength={160} onChange={event => updateGate(index, { name: event.target.value })} placeholder="门槛名称" className={compactFieldClass} />
                      <input aria-label={`验收门槛 ${index + 1} 规则`} value={gate.rule} maxLength={1000} onChange={event => updateGate(index, { rule: event.target.value })} placeholder="可判断的验收规则" className={compactFieldClass} />
                      <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-bold text-text-secondary"><input aria-label={`验收门槛 ${index + 1} 阻断`} type="checkbox" checked={gate.blocking} onChange={event => updateGate(index, { blocking: event.target.checked })} />阻断项</label>
                      <button type="button" aria-label={`删除验收门槛 ${index + 1}`} disabled={direction.acceptanceGates.length <= 1} onClick={() => setDirection(current => ({ ...current, acceptanceGates: current.acceptanceGates.filter((_, gateIndex) => gateIndex !== index) }))} className="rounded-lg border border-border bg-white p-2 text-text-muted disabled:opacity-30"><Trash2 size={14} /></button>
                    </div>)}</div>
                  </fieldset>
                </div>
              </details>
            </section>

            <div className="mt-5 space-y-3">
              <div><h3 className="text-sm font-black text-text-primary">镜头与台词模板</h3><p className="mt-1 text-[11px] text-text-muted">可用变量：{'{{product}}、{{topic}}、{{callToAction}}、{{shotFunction}}、{{subject}}、{{action}}'}。中英文都需填写。</p></div>
              {nodes.map((node, index) => <article key={index} className="rounded-xl border border-border bg-slate-50 p-3 sm:p-4">
                <header className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black text-accent">镜头 {index + 1}</p><p className="mt-0.5 text-xs font-bold text-text-secondary">定义画面功能与可执行台词</p></div><button type="button" aria-label={`删除节点 ${index + 1}`} disabled={nodes.length <= 1} onClick={() => setNodes(current => current.filter((_, nodeIndex) => nodeIndex !== index))} className="rounded-lg border border-border bg-white p-2 text-text-muted disabled:opacity-30"><Trash2 size={15} /></button></header>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <input value={node.nodeId} maxLength={120} onChange={event => updateNode(index, 'nodeId', event.target.value)} aria-label={`节点 ${index + 1} 编号`} placeholder="节点编号" className={compactFieldClass} />
                  <input value={node.shotFunction} maxLength={200} onChange={event => updateNode(index, 'shotFunction', event.target.value)} aria-label={`节点 ${index + 1} 镜头用途`} placeholder="镜头用途：证明什么" className={compactFieldClass} />
                  <input value={node.subject} maxLength={200} onChange={event => updateNode(index, 'subject', event.target.value)} aria-label={`节点 ${index + 1} 拍摄对象`} placeholder="拍什么" className={compactFieldClass} />
                  <input value={node.action} maxLength={200} onChange={event => updateNode(index, 'action', event.target.value)} aria-label={`节点 ${index + 1} 拍摄动作`} placeholder="怎么拍 / 做什么" className={compactFieldClass} />
                </div>
                <details className="mt-3 rounded-lg border border-border bg-white">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-black text-text-secondary">镜头执行参数</summary>
                  <div className="grid gap-2 border-t border-border p-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="text-[10px] font-bold text-text-muted md:col-span-2">拍摄环境<input aria-label={`镜头 ${index + 1} 拍摄环境`} value={node.environment ?? ''} maxLength={300} onChange={event => updateNode(index, 'environment', event.target.value)} className={`${compactFieldClass} mt-1`} /></label>
                    <label className="text-[10px] font-bold text-text-muted">画面方向<select aria-label={`镜头 ${index + 1} 画面方向`} value={node.orientation} onChange={event => updateNode(index, 'orientation', event.target.value as ContentFormulaNode['orientation'])} className={`${compactFieldClass} mt-1`}>{ORIENTATION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="text-[10px] font-bold text-text-muted">最短秒数<input aria-label={`镜头 ${index + 1} 最短秒数`} type="number" min={0.01} max={600} step={0.1} value={node.durationSeconds?.minimum ?? ''} onChange={event => updateNode(index, 'durationSeconds', { minimum: Number(event.target.value), maximum: node.durationSeconds?.maximum ?? Number(event.target.value) })} className={`${compactFieldClass} mt-1`} /></label>
                    <label className="text-[10px] font-bold text-text-muted">最长秒数<input aria-label={`镜头 ${index + 1} 最长秒数`} type="number" min={0.01} max={600} step={0.1} value={node.durationSeconds?.maximum ?? ''} onChange={event => updateNode(index, 'durationSeconds', { minimum: node.durationSeconds?.minimum ?? Number(event.target.value), maximum: Number(event.target.value) })} className={`${compactFieldClass} mt-1`} /></label>
                    <label className="text-[10px] font-bold text-text-muted">镜头类型<select aria-label={`镜头 ${index + 1} 镜头类型`} value={node.shotType} onChange={event => updateNode(index, 'shotType', event.target.value as ContentFormulaNode['shotType'])} className={`${compactFieldClass} mt-1`}>{SHOT_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="text-[10px] font-bold text-text-muted">景别<select aria-label={`镜头 ${index + 1} 景别`} value={node.shotSize} onChange={event => updateNode(index, 'shotSize', event.target.value as ContentFormulaNode['shotSize'])} className={`${compactFieldClass} mt-1`}>{SHOT_SIZE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="text-[10px] font-bold text-text-muted">运镜<select aria-label={`镜头 ${index + 1} 运镜`} value={node.cameraMovement} onChange={event => updateNode(index, 'cameraMovement', event.target.value as ContentFormulaNode['cameraMovement'])} className={`${compactFieldClass} mt-1`}>{CAMERA_MOVEMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="text-[10px] font-bold text-text-muted">转场<select aria-label={`镜头 ${index + 1} 转场`} value={node.transition} onChange={event => updateNode(index, 'transition', event.target.value as ContentFormulaNode['transition'])} className={`${compactFieldClass} mt-1`}>{TRANSITION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="flex items-end gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-[11px] font-bold text-text-secondary"><input aria-label={`镜头 ${index + 1} 必须`} type="checkbox" checked={node.required} onChange={event => updateNode(index, 'required', event.target.checked)} />必须镜头</label>
                    <label className="text-[10px] font-bold text-text-muted md:col-span-2 xl:col-span-5">构图说明<input aria-label={`镜头 ${index + 1} 构图说明`} value={node.composition} maxLength={500} onChange={event => updateNode(index, 'composition', event.target.value)} className={`${compactFieldClass} mt-1`} /></label>
                  </div>
                </details>
                <details className="mt-3 rounded-lg border border-border bg-white">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-black text-text-secondary">脚本、口播与字幕模板</summary>
                  <div className="space-y-3 border-t border-border p-3">
                    {TEMPLATE_FIELDS.map(field => <fieldset key={field.key}><legend className="flex items-center gap-1.5 text-[11px] font-black text-text-primary"><field.icon size={13} />{field.label}</legend><div className="mt-2 grid gap-2 lg:grid-cols-2"><label className="text-[10px] font-bold text-text-muted">中文<textarea aria-label={`镜头 ${index + 1} ${field.label} 中文`} value={node[field.key].zh} maxLength={1000} rows={2} onChange={event => updateNodeTemplate(index, field.key, 'zh', event.target.value)} className={`${compactFieldClass} mt-1 resize-y leading-5`} /></label><label className="text-[10px] font-bold text-text-muted">英文<textarea aria-label={`镜头 ${index + 1} ${field.label} 英文`} value={node[field.key].en} maxLength={1000} rows={2} onChange={event => updateNodeTemplate(index, field.key, 'en', event.target.value)} className={`${compactFieldClass} mt-1 resize-y leading-5`} /></label></div></fieldset>)}
                  </div>
                </details>
              </article>)}
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-2"><button type="button" disabled={nodes.length >= 12} onClick={() => setNodes(current => [...current, nextNode(current)])} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-bold text-text-secondary disabled:opacity-40">+ 增加镜头节点</button><div className="flex gap-2"><button type="button" onClick={() => setShowEditor(false)} className="rounded-xl border border-border bg-white px-4 py-2 text-xs font-bold text-text-secondary">取消</button><button type="button" onClick={() => void submit()} disabled={actingKey === 'create'} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-black text-white disabled:opacity-50">{actingKey === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存草稿</button></div></div>
          </section>
        )}

        <section className="space-y-3">
          {loading && !items.length ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-white p-16 text-sm text-text-muted"><Loader2 size={18} className="animate-spin" />正在读取公式库</div> : items.map(formula => {
            const key = `${formula.formulaId}:${formula.version}`;
            const open = expanded.includes(key);
            const busy = actingKey.startsWith(`${key}:`);
            return <article key={key} className="overflow-hidden rounded-2xl border border-border bg-white">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-black text-text-primary">{formula.name}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${STATUS_TONES[formula.status]}`}>{STATUS_LABELS[formula.status]}</span>{!formula.recordId && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700"><ShieldCheck size={11} className="mr-1 inline" />系统内置</span>}</div>
                  <p className="mt-1 text-xs text-text-muted">{THEME_LABELS[formula.themeId]} · {formula.formulaId} · v{formula.version} · {formula.nodes.length} 个镜头节点</p>
                  <p className="mt-1 text-[11px] text-text-muted">{directionSummary(formula.direction)}</p>
                  <p className="mt-2 text-xs font-bold text-text-secondary">{statusHint(formula)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {formula.recordId && formula.status === 'draft' && <button type="button" disabled={busy} onClick={() => void act(formula, 'trial')} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Beaker size={13} />进入内测</button>}
                  {formula.recordId && ['internal_trial', 'gray'].includes(formula.status) && <input aria-label={`${formula.name} 灰度租户 ID`} value={grayTenantInputs[key] ?? formula.rollout.tenantAllowlist.join(', ')} onChange={event => setGrayTenantInputs(current => ({ ...current, [key]: event.target.value }))} placeholder="灰度租户 ID，逗号分隔" className="min-w-[220px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs outline-none focus:border-amber-500" />}
                  {formula.recordId && ['internal_trial', 'gray'].includes(formula.status) && <button type="button" disabled={busy} onClick={() => void act(formula, 'gray')} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><Rocket size={13} />按名单灰度</button>}
                  {formula.recordId && ['internal_trial', 'gray'].includes(formula.status) && <button type="button" disabled={busy} onClick={() => void act(formula, 'active')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"><CheckCircle2 size={13} />正式启用</button>}
                  {formula.recordId && formula.status !== 'disabled' && <button type="button" disabled={busy} onClick={() => void act(formula, 'disable')} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50"><CircleOff size={13} />停用</button>}
                  <button type="button" onClick={() => setExpanded(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">查看导演配置{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
                </div>
              </div>
              {open && <div className="border-t border-border bg-slate-50 p-5">
                <section className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"><div className="flex items-center gap-2"><Music2 size={15} className="text-emerald-700" /><h3 className="text-xs font-black text-text-primary">导演参数</h3></div><p className="mt-2 text-xs leading-5 text-text-secondary">{directionSummary(formula.direction)}</p><div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold text-emerald-800"><span className="rounded-full bg-white px-2.5 py-1">音色 {formula.direction.voiceover.voice}</span><span className="rounded-full bg-white px-2.5 py-1">停顿 {PAUSE_OPTIONS.find(([value]) => value === formula.direction.voiceover.pauseStyle)?.[1]}</span><span className="rounded-full bg-white px-2.5 py-1">字幕字号 {formula.direction.subtitles.fontScale}×</span></div></section>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">{formula.nodes.map((node, index) => <article key={node.nodeId} className="rounded-xl border border-border bg-white p-4"><p className="text-[10px] font-black text-accent">镜头 {index + 1} · {node.required ? '必拍' : '选拍'}</p><p className="mt-1 text-sm font-black text-text-primary">{node.shotFunction}</p><p className="mt-2 text-xs text-text-secondary">对象：{node.subject}</p><p className="mt-1 text-xs text-text-secondary">动作：{node.action}</p><div className="mt-3 space-y-2 border-t border-border pt-3">{TEMPLATE_FIELDS.map(field => <div key={field.key} className="rounded-lg bg-surface-2 p-2.5"><p className="flex items-center gap-1.5 text-[10px] font-black text-text-secondary"><field.icon size={12} />{field.label}</p><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-primary">中：{node[field.key].zh}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">EN: {node[field.key].en}</p></div>)}</div></article>)}</div>
                {formula.audit.length > 0 && <p className="mt-4 text-[11px] text-text-muted">最近记录：{formula.audit.at(-1)?.event} · {formula.audit.at(-1)?.at}</p>}
              </div>}
            </article>;
          })}
          {!loading && !items.length && <div className="rounded-2xl border border-border bg-white p-14 text-center"><AlertCircle size={30} className="mx-auto text-slate-300" /><p className="mt-3 text-sm font-black text-text-primary">暂未配置爆款公式</p><p className="mt-1 text-xs text-text-muted">当前保持空白；未来由平台管理员录入，并经过内测与灰度后启用。</p></div>}
        </section>
      </div>
    </main>
  );
}
