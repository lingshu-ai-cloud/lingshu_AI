import { isSyntheticMaterial } from './materialTruthfulness.js';
import { officialIndustryMaterialVisible } from './industryMaterialAccess.js';

export interface ReplicationMaterialMatch {
  materialId: string; trimStart: number; trimEnd: number; evidence: string; contentSha256?: string;
}
export interface ReplicationMaterialMatchingInput {
  tenantId: string; shotDescription: string; duration: number;
  materials: Array<Record<string, unknown>>; requiredProductId?: string;
  scope?: 'own' | 'shared'; excludeMaterialIds?: string[];
}
// Closed semantic vocabulary: generic words such as 产品/展示/工厂 never establish a match.
const actions: Record<string, RegExp> = {
  filling: /灌装|注入|加液|注液|滴入|滴加|向.{0,8}(?:瓶|烧杯).{0,8}(?:滴|倒)|fill(?:ing)?|dispens(?:e|ing)/i,
  pipette: /滴管|移液|pipett|dropper/i,
  conveyor: /传送带|输送带|输送线|conveyor/i,
  mixing: /搅拌|混合|搅动|mix(?:ing)?|stirr?/i,
  application: /涂抹|点涂|推抹|敷面膜|上脸|apply|applying|rub(?:bing)?/i,
  capping: /拧盖|旋盖|封盖|压盖|装瓶盖|capping|screw.{0,8}cap/i,
  packing: /装盒|装箱|封箱|包装工序|packing|boxing/i,
  weighing: /称重|电子秤|秤盘|weigh/i,
  holding: /手持|双手持|手握|托举|握持|持瓶|hold(?:ing)?/i,
};
const subjects: Record<string, RegExp> = {
  bottle: /瓶|bottle/i, jar: /罐|膏霜|jar/i, box: /盒|box|carton/i,
  mask: /面膜|mask/i, beaker: /烧杯|beaker/i, powder: /粉饼|粉体|compact|powder/i,
  fluid: /液体|液|膏体|fluid|liquid|cream/i, lamp: /灯具|灯饰|吊灯|lamp|lighting/i,
  device: /设备|机械|旋钮|装置|机器|machine|equipment/i,
};
const concepts = (value: string, vocabulary: Record<string, RegExp>) => Object.entries(vocabulary).filter(([,pattern]) => pattern.test(value)).map(([key]) => key);
const texts = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === 'string').join('；') : typeof value === 'string' ? value : '';
const visibleEvidence = (row: Record<string, unknown>) => [texts(row.action), texts(row.subject), texts(row.visual), texts(row.observedFacts), texts(row.visualObservations)].filter(Boolean).join('；');
const affirmative = (value: string) => value.split(/[；;。\n]/).filter(clause => !/(?:没有|并未|未见|未进行|未发生|无新增|不包含|without|not\s)/i.test(clause)).join('；');

function eligibleMaterial(material: Record<string, unknown>, input: ReplicationMaterialMatchingInput): boolean {
  if (input.excludeMaterialIds?.includes(String(material.id || ''))) return false;
  const shared = material.scope === 'shared';
  if (input.scope === 'shared' ? !shared : shared) return false;
  if (shared ? !officialIndustryMaterialVisible(material, '')
    : String(material.tenantId || material.tenant_id || '') !== input.tenantId) return false;
  return material.type === 'video' && !isSyntheticMaterial(material)
    && material.usage !== 'analysis' && material.usage !== 'reference_only'
    && material.mayUseInProduction !== false && Boolean(material.id && (material.file || material.objectKey))
    && !/reference|benchmark|tiktok|youtube|third_party/i.test(String(material.sourceType || material.source || ''));
}

/** Conservative visual matching only. The caller must still validate the returned actual video bytes. */
export function matchReplicationMaterial(input: ReplicationMaterialMatchingInput): ReplicationMaterialMatch | null {
  if (!input.tenantId || !(input.duration > 0) || !Number.isFinite(input.duration)) return null;
  const requested = affirmative(input.shotDescription);
  const requiredActions = concepts(requested, actions);
  const requiredSubjects = concepts(requested, subjects);
  if (!requiredActions.length || !requiredSubjects.length) return null;
  const candidates: Array<ReplicationMaterialMatch & { score: number }> = [];
  for (const material of input.materials) {
    if (!eligibleMaterial(material, input)) continue;
    if (input.requiredProductId && String(material.productId || '') !== input.requiredProductId) continue;
    const duration = Number(material.duration);
    if (!Number.isFinite(duration) || duration < input.duration) continue;
    const segments = Array.isArray(material.segments) ? material.segments.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
    // Whole-clip observations are usable only when no timed segmentation exists.
    const rows = segments.length ? segments : Array.isArray(material.visualObservations) && material.visualObservations.length
      ? [{ start: 0, end: duration, visualObservations: material.visualObservations }] : [];
    for (const row of rows) {
      const start = Math.max(0, Number(row.cleanStart ?? row.start));
      const end = Math.min(duration, Number(row.cleanEnd ?? row.end));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start + 0.001 < input.duration) continue;
      const evidence = affirmative(visibleEvidence(row));
      if (/对镜口播|面对镜头.{0,12}(?:讲解|说话)|主持人|主播|talking to camera/i.test(evidence)) continue;
      const observedActions = concepts(evidence, actions);
      const observedSubjects = concepts(evidence, subjects);
      // Require every requested specific action, rather than accepting "holding" against an unrelated factory clip.
      if (!requiredActions.every(key => observedActions.includes(key))) continue;
      if (!requiredSubjects.every(key => observedSubjects.includes(key))) continue;
      const score = requiredActions.length * 10 + requiredSubjects.length * 5 + (input.requiredProductId ? 20 : 0);
      candidates.push({ materialId: String(material.id), trimStart: start, trimEnd: start + input.duration,
        evidence: `视觉证据匹配：动作[${requiredActions.join(',')}]，主体[${requiredSubjects.join(',')}]；素材段${start}-${end}s；${evidence.slice(0, 500)}`,
        ...(/^[a-f0-9]{64}$/i.test(String(material.contentSha256 || '')) ? { contentSha256: String(material.contentSha256) } : {}), score });
    }
  }
  candidates.sort((a,b) => b.score - a.score || a.materialId.localeCompare(b.materialId) || a.trimStart - b.trimStart);
  const match = candidates[0];
  if (!match) return null;
  const { score: _, ...result } = match;
  return result;
}

export interface ReplicationMaterialFallback extends ReplicationMaterialMatch {
  tier: 'product' | 'public' | 'generic';
  /** Only observed footage may be described in a downgraded shot. */
  visualDescription: string;
}

/** Product evidence first, then semantically related public footage, finally
 * ordinary non-product B-roll. The last two tiers are illustrative footage,
 * never evidence of a particular product or enterprise capability. */
export function matchReplicationMaterialFallback(input: ReplicationMaterialMatchingInput): ReplicationMaterialFallback | null {
  const own = matchReplicationMaterial({ ...input, scope: 'own' });
  if (own) return { ...own, tier: input.requiredProductId ? 'product' : 'generic',
    visualDescription: input.requiredProductId ? input.shotDescription : '企业素材示意画面，不证明特定产品的外观或效果' };
  const publicMatch = matchReplicationMaterial({ ...input, requiredProductId: undefined, scope: 'shared' });
  if (publicMatch) return { ...publicMatch, tier: 'public', visualDescription: '公共素材示意画面，不展示或证明本产品及本企业能力' };
  const ordinary = input.materials.filter(material => !material.productId && eligibleMaterial(material, { ...input, scope: material.scope === 'shared' ? 'shared' : 'own' }))
    .sort((left, right) => Number(left.scope === 'shared') - Number(right.scope === 'shared')
      || String(left.id).localeCompare(String(right.id)));
  for (const material of ordinary) {
    const segments = Array.isArray(material.segments) ? material.segments as Array<Record<string, unknown>> : [];
    const observations = segments.length ? segments : [{ start: 0, end: Number(material.duration), visualObservations: material.visualObservations }];
    for (const observation of observations) {
      const observed = affirmative(visibleEvidence(observation));
      if (!concepts(observed, actions).length || !concepts(observed, subjects).length) continue;
      const match = matchReplicationMaterial({ ...input, shotDescription: observed, materials: [material], requiredProductId: undefined,
        scope: material.scope === 'shared' ? 'shared' : 'own' });
      if (match) return { ...match, tier: 'generic', visualDescription: `通用素材示意画面：${observed.slice(0, 180)}。不展示或证明本产品及本企业能力` };
    }
  }
  return null;
}
