import { storyboardFactoryReferenceRequired } from '../../shared/storyboardFactoryReference';

export interface EnvironmentReferenceCandidate {
  id: string;
  type: string;
  name?: string;
  folder?: string;
  tags?: string;
  shotFunction?: string;
  applicability?: string;
  sourceType?: string;
}

const factoryPattern = /工厂|车间|产线|流水线|生产线|传送带|输送带|设备|工人|质检|包装线|装配|焊接|factory|workshop|conveyor|production line|machine|worker|assembly/i;
const details = [
  /工人|员工|操作员|worker|operator/i,
  /质检|检测|inspection|quality control/i,
  /传送带|输送带|conveyor/i,
  /流水线|生产线|产线|production line/i,
  /包装线|包装|packaging/i,
  /装配|组装|assembly/i,
  /焊接|welding/i,
  /设备|机器|machine|equipment/i,
];

/** Auto-pick only a unique, scene-specific image from materials selected for
 * this video. Ambiguous matches leave the choice empty for a local correction. */
export function matchStoryboardEnvironmentImage(
  shotDescription: string,
  selected: EnvironmentReferenceCandidate[],
): string | undefined {
  if (!factoryPattern.test(shotDescription)) return undefined;
  const required = details.filter(pattern => pattern.test(shotDescription));
  const ranked = selected.filter(item => item.type === 'image' && item.sourceType !== 'ai-storyboard-first-frame')
    .map(item => {
      const text = [item.name, item.folder, item.tags, item.shotFunction, item.applicability].filter(Boolean).join(' ');
      if (!factoryPattern.test(text)) return { id: item.id, score: 0 };
      const specific = required.filter(pattern => pattern.test(text)).length;
      return { id: item.id, score: required.length ? specific * 3 : 1 };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  return ranked.length && ranked[0]!.score > (ranked[1]?.score || 0) ? ranked[0]!.id : undefined;
}

/** Matching assigns clips to shots but preserves already selected image inputs
 * that may be needed by an AI shot later in the same video. */
export function retainStoryboardReferenceImages(
  assignedIds: string[], previouslySelectedIds: string[],
  materials: Array<Pick<EnvironmentReferenceCandidate, 'id' | 'type' | 'sourceType'>>,
): string[] {
  const imageIds = new Set(materials.filter(item => item.type === 'image' && item.sourceType !== 'ai-storyboard-first-frame').map(item => item.id));
  return [...new Set([...assignedIds, ...previouslySelectedIds.filter(id => imageIds.has(id))])];
}

/** Batch production keeps an unmatched specific factory shot in the existing
 * material/shoot path until an enterprise environment reference is available. */
export function factoryAiAutoPromotionReady(
  description: string, selected: EnvironmentReferenceCandidate[],
  choice: { environmentMaterialId?: string; environmentReferenceDisabled?: boolean; environmentReferenceManual?: boolean },
): boolean {
  if (!storyboardFactoryReferenceRequired(description)) return true;
  if (choice.environmentReferenceDisabled) return false;
  if (choice.environmentReferenceManual) return selected.some(item => item.id === choice.environmentMaterialId && item.type === 'image');
  return Boolean(matchStoryboardEnvironmentImage(description, selected));
}
