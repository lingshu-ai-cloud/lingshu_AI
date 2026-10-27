import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../../../shared/contracts/socialImageCreation';
import { socialImageApi } from '../../lib/socialImageApi';

/** Save the user's requested change without issuing another paid image request. */
export async function saveNaturalLanguageRegeneration(task: SocialImageCreationTask, request: string) {
  const output = task.outputs.filter(item => item.mediaUrl && item.state !== 'superseded')
    .sort((a, b) => b.version - a.version)[0];
  if (!output) throw new Error('当前没有可修改的图片版本。');
  const existing = task.repairInstructions.find(item => item.outputNodeId === output.id && item.status === 'pending');
  const instruction = `用户要求：${request.trim()}`;
  const repairs = existing ? task.repairInstructions.map(item => item.id === existing.id
    ? { ...item, targetLayer: 'full_composite' as const, instruction: `${item.instruction}；${instruction}` } : item)
    : [...task.repairInstructions, {
      id: crypto.randomUUID(), outputNodeId: output.id, failedChecks: SOCIAL_IMAGE_HARD_CHECKS.filter(key =>
        output.qualityChecks.some(check => check.key === key && check.verdict !== 'pass' && check.verdict !== 'not_applicable')),
      targetLayer: 'full_composite' as const, instruction, status: 'pending' as const, fromVersion: output.version,
    }];
  return socialImageApi.updateTask(task, {
    status: 'planned', step: 'generate', repairInstructions: repairs,
    outputs: task.outputs.map(item => item.id === output.id ? { ...item, state: 'repair_required' as const } : item),
  });
}
