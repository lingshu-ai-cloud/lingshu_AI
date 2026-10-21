import type { PresenterCreation, PresenterLook, PresenterVoiceCandidate } from '../../lib/presenterAssets';

export const field = 'w-full rounded-lg border border-border bg-white p-2 text-sm';
export const button = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';

export const statusText = (job: PresenterCreation) => job.status === 'pending_consent'
  ? job.consentRequestedAt ? '授权已发起 · HeyGen 确认中' : '待发起本人授权'
  : ({ submitting: '正在提交', processing: '处理中', completed: '可用', failed: '创建未受理', uncertain: '提交结果待核实' } as const)[job.status];

type PresenterLookGroup = { id: string; name: string; representative: PresenterLook; looks: PresenterLook[] };
export const groupPresenterLooks = (looks: PresenterLook[]): PresenterLookGroup[] => {
  const groups = new Map<string, PresenterLook[]>();
  for (const look of looks) {
    const id = look.groupId || `look:${look.id}`;
    groups.set(id, [...(groups.get(id) || []), look]);
  }
  return [...groups].map(([id, groupLooks]) => {
    const representative = groupLooks.find(look => look.imageUrl) || groupLooks[0];
    const commonName = groupLooks.length > 1
      ? groupLooks.map(look => look.name.trim().split(/\s+/)[0]).find(Boolean) || representative.name
      : representative.name;
    return { id, name: commonName, representative, looks: groupLooks };
  });
};

export type VoiceCloneJob = { id: string; status: string; voiceId: string; candidates?: PresenterVoiceCandidate[]; arkVoice?: { speakerId?: string; status: string; error?: string } };
export const storedVoiceCloneJob = (lookId: string): VoiceCloneJob | undefined => {
  if (!lookId || typeof window === 'undefined') return undefined;
  try {
    const saved = JSON.parse(sessionStorage.getItem(`presenter-voice-job:${lookId}`) || 'null');
    return saved && typeof saved.id === 'string' && ['processing', 'submitting', 'completed', 'failed', 'uncertain'].includes(saved.status)
      ? saved as VoiceCloneJob
      : undefined;
  } catch { return undefined; }
};
