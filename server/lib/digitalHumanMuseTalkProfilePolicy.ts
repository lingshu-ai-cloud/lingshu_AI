export type MuseTalkProfileId = 'jaw-padding-2-2' | 'raw-padding-0-0';

export interface MuseTalkRenderProfile {
  id: MuseTalkProfileId;
  parsingMode: 'jaw' | 'raw';
  audioPaddingLeft: number;
  audioPaddingRight: number;
}

export type MuseTalkProfileAttemptOutcome =
  | 'passed'
  | 'final_quality_rejected'
  | 'performance_quality_rejected'
  | 'execution_failed';

export interface MuseTalkProfileAttemptSummary {
  profileId: MuseTalkProfileId;
  outcome: MuseTalkProfileAttemptOutcome;
  failure?: string;
}

const preferredProfile: MuseTalkRenderProfile = Object.freeze({
  id: 'jaw-padding-2-2',
  parsingMode: 'jaw',
  audioPaddingLeft: 2,
  audioPaddingRight: 2,
});

const fallbackProfile: MuseTalkRenderProfile = Object.freeze({
  id: 'raw-padding-0-0',
  parsingMode: 'raw',
  audioPaddingLeft: 0,
  audioPaddingRight: 0,
});

/**
 * The order is a production policy, not a quality preference supplied by the
 * caller. Keeping it outside the API input prevents callers from selecting a
 * weaker or untested MuseTalk path.
 */
export const MUSE_TALK_RENDER_PROFILES = Object.freeze([
  preferredProfile,
  fallbackProfile,
] as const);

export const MUSE_TALK_PROFILE_POLICY_VERSION = 'musetalk-profile-policy-v1' as const;

/**
 * Select the only profile that may run next. The raw profile is available
 * exactly once and exclusively after the preferred profile produced a video
 * that was explicitly rejected by the unchanged final media quality gate.
 */
export function nextMuseTalkProfile(
  attempts: readonly MuseTalkProfileAttemptSummary[],
): MuseTalkRenderProfile | undefined {
  if (attempts.length === 0) return preferredProfile;
  if (attempts.length !== 1) return undefined;
  const first = attempts[0]!;
  if (first.profileId !== preferredProfile.id || first.outcome !== 'final_quality_rejected') return undefined;
  return fallbackProfile;
}

export function museTalkRunnerProfileArguments(profile: MuseTalkRenderProfile): string[] {
  return [
    '-ParsingMode', profile.parsingMode,
    '-AudioPaddingLeft', String(profile.audioPaddingLeft),
    '-AudioPaddingRight', String(profile.audioPaddingRight),
  ];
}

function compactFailure(value: string | undefined): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 600 ? `${normalized.slice(0, 597)}...` : normalized;
}

export function buildMuseTalkProfileSelectionNotes(
  attempts: readonly MuseTalkProfileAttemptSummary[],
  selectedProfileId?: MuseTalkProfileId,
): string[] {
  const notes = [
    `MuseTalk自适应档位策略：${MUSE_TALK_PROFILE_POLICY_VERSION}；首选 jaw + audio padding 2/2，仅在最终基础质量门禁明确拒绝时允许一次 raw + padding 0/0 重做；V2 分镜 SyncNet 门槛与三语整片验收统一为3.0。`,
  ];
  for (const attempt of attempts) {
    const failure = compactFailure(attempt.failure);
    if (attempt.outcome === 'final_quality_rejected') {
      notes.push(`MuseTalk档位 ${attempt.profileId} 经未降低阈值的最终基础质量门禁拒绝${failure ? `：${failure}` : '。'}`);
    } else if (attempt.outcome === 'performance_quality_rejected') {
      notes.push(`MuseTalk档位 ${attempt.profileId} 的表演执行回执门禁未通过；未触发档位重试${failure ? `：${failure}` : '。'}`);
    } else if (attempt.outcome === 'execution_failed') {
      notes.push(`MuseTalk档位 ${attempt.profileId} 执行失败；未触发质量档位重试${failure ? `：${failure}` : '。'}`);
    }
  }
  if (selectedProfileId) {
    const selected = MUSE_TALK_RENDER_PROFILES.find(profile => profile.id === selectedProfileId)!;
    notes.push(`MuseTalk最终档位：${selected.id}（${selected.parsingMode}，音频上下文 ${selected.audioPaddingLeft}/${selected.audioPaddingRight}）；该档位的解码、MediaPipe、SyncNet、卡帧与表演回执门禁已使用原阈值重新执行。`);
  } else {
    notes.push('MuseTalk未选出通过全部门禁的档位，任务保持 fail-closed。');
  }
  return notes;
}
