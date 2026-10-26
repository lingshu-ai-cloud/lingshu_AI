import { presenterVoicePolicy } from '../../shared/contracts/presenterVoicePolicy.js';
import { VIDEO_LANGUAGES } from '../../shared/contracts/videoLanguages.js';
import { recordContentFormat } from '../lib/socialContentLegacyPorts.js';
import type { CreationEvidencePorts } from '../assistantContext/contentCreationDialogue.js';
import { enterpriseProductIdentity } from '../lib/enterpriseProductIdentity.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { productionBudgetLimitCny } from '../../shared/contracts/productionBudgetPolicy.js';
import type { ContentCreationOptions, SingleContentPreparation, SingleContentSelection } from '../../shared/contracts/singleContentCreation.js';
import type { DataStore } from '../storage/datastore.js';
import { readContentPreferences } from './singleContentPreferences.js';
import { parseSocialSource, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';

const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((row): row is Record<string, unknown> => Boolean(socialObject(row))) : [];

/** Read-only evidence: no generated scripts, provider requests, queue or task writes. */
export async function readSingleContentContext(input: { store: DataStore; evidence: CreationEvidencePorts; tenantId: string }) {
  const [settings, profileValue, inventory, referenceRows, presenters] = await Promise.all([
    readContentPreferences(input.store, input.tenantId), input.evidence.profile(input.tenantId),
    input.evidence.materials(input.tenantId), input.evidence.references?.(input.tenantId) ?? Promise.resolve([]),
    input.evidence.presenters(input.tenantId),
  ]);
  const references = referenceRows.filter(row => {
    if (recordContentFormat(row) !== 'video') return false;
    try { parseSocialSource({ kind: 'reference_link', sourceRef: singleContentReferenceSourceRef(row), cachedReferenceRecordId: row.id, label: socialText(row.title).slice(0, 160) || '对标参考' }); return true; }
    catch { return false; }
  });
  const profile = socialObject(profileValue);
  const products = records(socialObject(profile?.products)?.items).map((product, index) => ({
    id: enterpriseProductIdentity(product, index), name: socialText(product.name), record: product,
  })).filter(product => product.name);
  // Reuse existing enterprise facts before offering system recommendations.
  const languageText = socialText(socialObject(profile?.brand)?.preferredLanguages || socialObject(profile?.company)?.primaryLanguages).toLowerCase();
  const inheritedLanguage = /英语|english|\ben\b/.test(languageText) ? 'en' : /中文|chinese|\bzh\b/.test(languageText) ? 'zh' : settings.preferences.languages[0]!;
  const inheritedMarket = socialText(socialObject(profile?.strategy)?.focusMarkets || socialObject(profile?.company)?.mainMarkets).slice(0, 80);
  const inheritedAudience = socialText(socialObject(profile?.customers)?.targetProfiles).slice(0, 500);
  const initialPreferences = settings.saved ? settings.preferences : { ...settings.preferences, languages: [inheritedLanguage],
    ...(inheritedMarket ? { market: inheritedMarket } : {}), ...(inheritedAudience ? { audience: inheritedAudience } : {}) };
  const options: ContentCreationOptions = {
    preferences: initialPreferences, preferencesVersion: settings.version, preferencesSaved: settings.saved,
    defaultPresenterId: socialText(settings.payload.defaultPresenterId),
    products: products.map(({ id, name }) => ({ id, name })),
    presenters: presenters.map(row => ({ id: socialText(row.id), name: socialText(row.name),
      authorized: validateHeyGenPresenterRecord(row).ok,
      avatarId: socialText(socialObject(socialObject(row.toolMappings)?.heygen)?.avatarId || row.avatarId),
      voiceId: socialText(socialObject(socialObject(row.toolMappings)?.heygen)?.voiceId || row.voiceId), presenterSource: presenterVoicePolicy(row).presenterSource, voiceSelectionMode: presenterVoicePolicy(row).voiceSelectionMode })),
    references: references.map(row => ({ id: socialText(row.id), title: socialText(row.title) || '未命名参考', durationSeconds: referenceDurationSeconds(row), platform: socialText(row.platform) })),
  };
  return { settings, options, profile, products, inventory, references, presenters };
}
export type SingleContentContext = Awaited<ReturnType<typeof readSingleContentContext>>;

export function prepareSingleContent(context: SingleContentContext, selection: SingleContentSelection, runtime: {
  now: Date; executionAvailable: boolean; localPreview: boolean;
}): SingleContentPreparation {
  const checks: SingleContentPreparation['checks'] = [];
  const add = (key: string, label: string, state: 'ready' | 'warning' | 'blocked', message: string) => checks.push({ key, label, state, message });
  const unsupported = selection.preferences.languages.filter(language => !['en', 'zh'].includes(language));
  if (unsupported.length) add('languages', '输出语种', 'blocked', `已保存所选语种；当前短视频脚本链尚未适配 ${unsupported.map(language => VIDEO_LANGUAGES[language]).join('、')}，请先选择中文或英语。`);
  else add('languages', '输出语种', 'ready', `按 ${selection.preferences.languages.length} 个语种分别建立制作任务，每个版本独立制作与交付`);
  const product = context.products.find(row => row.id === selection.productId);
  add('product', '产品与企业资料', product ? 'ready' : 'blocked', product ? `已绑定「${product.name}」` : '产品已变化，请重新选择企业产品');
  const governance = socialObject(context.profile?.dataGovernance);
  if (!context.profile || governance?.aiAccessEnabled === false) add('facts', '企业知识', 'blocked', '请先在企业知识库允许 AI 使用当前企业资料');
  add('delivery', '预计交付时间', Date.parse(selection.dueAt) > runtime.now.getTime() ? 'ready' : 'blocked',
    Date.parse(selection.dueAt) > runtime.now.getTime() ? '已记录交付目标；实际完成时间受素材和执行情况影响' : '请选择未来的预计交付时间');
  const presenter = context.presenters.find(row => row.id === selection.presenterId);
  const presenterTrust = presenter ? validateHeyGenPresenterRecord(presenter, runtime.now) : null;
  if (selection.usePresenter) add('presenter', '企业数字人', presenterTrust?.ok ? 'ready' : 'blocked',
    presenterTrust?.ok ? `已复用「${socialText(presenter?.name)}」的 HeyGen 授权，${presenterVoicePolicy(presenter!).voiceSelectionMode === 'follow_avatar' ? '跟随人物原配音色' : '沿用已绑定音色'}，无需再次授权`
      : !presenter ? '所选人物不在当前企业可用资产中，请刷新企业人物列表后重新选择'
      : presenterTrust && !presenterTrust.ok && presenterTrust.reasons.includes('heygen_voice_id_missing') ? '所选人物尚未绑定音色，请补齐声音设置；无需重复人物授权'
      : presenterTrust && !presenterTrust.ok && presenterTrust.reasons.includes('rights_expired') ? '所选人物的授权已过期，请更新有效授权记录'
      : presenterTrust && !presenterTrust.ok && presenterTrust.reasons.includes('rights_revoked') ? '所选人物的授权已被撤销，请选择有效的人物资产'
      : '所选人物的授权凭据与资产信息不一致，请在企业人物配置中核对原记录');
  else add('presenter', '企业数字人', 'ready', '本条不使用数字人');
  if (selection.usePresenter && selection.preferences.materialPolicy !== 'ai_enhanced') add('presenter_route', '数字人制作方式', 'blocked', '数字人需要 AI 辅助制作，请使用对应制作方式');
  const reference = selection.referenceId ? context.references.find(row => row.id === selection.referenceId) : null;
  if (selection.referenceId) add('reference', '对标参考', reference ? 'ready' : 'blocked', reference ? '已绑定参考记录；启动时沿用原精确分析与脚本审核门禁' : '参考已删除或不可访问，请重新选择');
  if (reference) {
    try { parseSocialSource({ kind: 'reference_link', sourceRef: singleContentReferenceSourceRef(reference), cachedReferenceRecordId: selection.referenceId, label: socialText(reference.title).slice(0, 160) || '对标参考' }); }
    catch { add('reference_input', '参考来源', 'blocked', '参考记录缺少可用来源，请在灵感中心完善后再选择'); }
  }
  const ownMaterials = context.inventory.items.filter(row => row.productId === selection.productId || row.productRef === selection.productId);
  if (context.inventory.status !== 'ready') add('materials', '可用素材', 'blocked', '素材库存未完整读取，请重试');
  else add('materials', '可用素材', ownMaterials.length ? 'ready' : 'warning', ownMaterials.length
    ? `匹配到 ${ownMaterials.length} 条产品素材；逐镜可用性由原生产检查核验`
    : '将检查产品图与企业素材；若不足且未允许 AI 补充，任务停下等待补充，不虚构素材');
  add('execution', '自动执行', runtime.executionAvailable && !runtime.localPreview ? 'ready' : 'warning', runtime.localPreview
    ? '本地预览可以建立任务，不调用付费制作；成片链路需在执行环境验证'
    : runtime.executionAvailable ? '提交后进入现有生产队列，仍执行预算、素材和质检门禁' : '执行器未配置，任务会保存为待启动');
  const fingerprint = socialRequestHash({ selection, profile: context.profile, settingsVersion: context.settings.version,
    presenters: selection.usePresenter ? presenter : null, reference,
    inventoryStatus: context.inventory.status, materials: context.inventory.items.map(row => ({ id: row.id,
      revision: row.sourceRevision || row.updatedAt || row.contentSha256 })),
    executionAvailable: runtime.executionAvailable, localPreview: runtime.localPreview });
  return { fingerprint, checks, canCreate: !checks.some(row => row.state === 'blocked'),
    executionAvailable: runtime.executionAvailable && !runtime.localPreview,
    budgetLimitCny: productionBudgetLimitCny(referenceDurationSeconds(reference) ?? undefined) * selection.preferences.languages.length };
}

/** The reference is the duration source; no short-video product duration cap. */
export function referenceDurationSeconds(reference: Record<string, unknown> | null | undefined): number | null {
  const value = Number(reference?.duration);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Existing reference resolver accepts local://recordId for uploaded inspiration videos. */
export function singleContentReferenceSourceRef(reference: Record<string, unknown>): string {
  return socialText(reference.sourceUrl) || `local://${socialText(reference.id)}`;
}
