import { normalizeFreeCreationState } from './freeCreationProject';
/** An editable first-step draft, with no frozen assets or production confirmation. */
export function platformRewriteDraft(script: string, platform: string, language: string) {
  const chunks = script.match(/[\s\S]{1,5000}/gu) || [];
  return normalizeFreeCreationState({
    currentStep: 1, hookSource: 'none',
    brief: { platform: platform.toLowerCase(), language, durationSeconds: 30,
      notes: '平台改写草稿：请确认产品、目标、受众、画面和时长后继续。' },
    script: { status: 'draft', lines: chunks.map((narration, index) => ({
      id: `adaptation-${index + 1}`, start: index * 30 / chunks.length, end: (index + 1) * 30 / chunks.length,
      narration, silent: false, visualIntent: '', shotType: 'product', factReferences: [], primaryHook: index === 0,
    })) },
  });
}
