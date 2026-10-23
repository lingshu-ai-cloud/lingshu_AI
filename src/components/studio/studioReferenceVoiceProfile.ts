import type { VideoKickoff } from './studioVideoKickoff';


export function referenceVoiceProfile(kickoff: VideoKickoff | null) {
  const ref = kickoff?.referenceAnalysis;
  const details = ref?.details || [];
  const audioNotes = details.map(item => item.audio || item.bgm || '').filter(Boolean).slice(0, 3);
  const hasFastCue = /快|高能|紧凑|卡点|加速|fast|upbeat/i.test(`${ref?.coreEmotion || ''} ${audioNotes.join(' ')}`);
  return {
    available: Boolean(ref && (ref.coreEmotion || details.length)),
    emotion: ref?.coreEmotion || '沿用对标视频的情绪推进，但不复制原台词和声音身份',
    summary: [ref?.coreEmotion, hasFastCue ? '快开场与紧凑推进' : '按原片信息密度自然推进', audioNotes[0]].filter(Boolean).join(' · '),
    baseSpeed: hasFastCue ? 1.1 : 1.02,
  };
}
