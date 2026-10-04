/** A read-only snapshot of the media and decisions needed to render one storyboard shot. */
export interface RenderReadyShot {
  id: string;
  index: number;
  title?: string;
  duration: number;
  route: 'local' | 'ai' | 'presenter' | 'shoot';
  material?: { id: string; url?: string; type: 'video' | 'image' | 'audio'; usableDuration?: number };
  /** Set only after the generated video, rather than its first frame, passes review. */
  generatedVideoAccepted?: boolean;
  digitalHumanAccepted?: boolean;
  quality?: { passed: boolean; findings?: Array<{ message: string }> };
  qualityError?: string;
  qualityChecking?: boolean;
  productRequired?: boolean;
  productIds?: string[];
  productMappingAmbiguous?: boolean;
  productionBlockers?: string[];
}

export type RenderReadinessIssueCode =
  | 'no_shots' | 'script_missing' | 'voiceover_missing' | 'material_missing'
  | 'material_unusable' | 'material_too_short' | 'video_not_accepted'
  | 'presenter_not_accepted' | 'quality_pending' | 'quality_failed'
  | 'product_unresolved' | 'production_blocked';

export interface RenderReadinessIssue {
  slotId?: string;
  index?: number;
  code: RenderReadinessIssueCode;
  message: string;
}

export interface RenderReadiness {
  ready: boolean;
  readyCount: number;
  totalCount: number;
  issues: RenderReadinessIssue[];
  /** Every unready shot appears once here, with its own actionable reasons. */
  unreadyShots: Array<{ slotId: string; index: number; title: string; issues: RenderReadinessIssue[] }>;
}

export function evaluateStoryboardRenderReadiness(input: {
  shots: RenderReadyShot[];
  scriptReady: boolean;
  voiceoverRequired?: boolean;
  voiceoverReady?: boolean;
}): RenderReadiness {
  const issues: RenderReadinessIssue[] = [];
  if (!input.shots.length) issues.push({ code: 'no_shots', message: '请先生成分镜' });
  if (!input.scriptReady) issues.push({ code: 'script_missing', message: '请先确认成片脚本' });
  if (input.voiceoverRequired && !input.voiceoverReady) issues.push({ code: 'voiceover_missing', message: '口播配音或时间码尚未就绪' });

  const unreadyShots = input.shots.flatMap(shot => {
    const shotIssues: RenderReadinessIssue[] = [];
    const add = (code: RenderReadinessIssueCode, message: string) => shotIssues.push({ slotId: shot.id, index: shot.index, code, message });
    const name = `分镜 ${shot.index}${shot.title ? `「${shot.title}」` : ''}`;
    const material = shot.material;
    if (!material?.id || !material.url) add('material_missing', `${name}缺少可用于成片的画面`);
    else if (material.type === 'audio' || ((shot.route === 'ai' || shot.route === 'presenter') && material.type !== 'video')) {
      add('material_unusable', `${name}需要已验收的视频画面`);
    }
    else if (material.type === 'video' && Number.isFinite(material.usableDuration) && (material.usableDuration || 0) + 0.05 < shot.duration) {
      add('material_too_short', `${name}素材可用时长不足 ${shot.duration.toFixed(1)} 秒`);
    }
    if (shot.route === 'ai' && !shot.generatedVideoAccepted) add('video_not_accepted', `${name}生成视频尚未通过验收`);
    if (shot.route === 'presenter' && !shot.digitalHumanAccepted) add('presenter_not_accepted', `${name}数字人视频尚未通过验收`);
    if (shot.qualityChecking) add('quality_pending', `${name}仍在质检中`);
    if (shot.qualityError || (shot.quality && !shot.quality.passed)) {
      const finding = shot.quality?.findings?.map(item => item.message).filter(Boolean).join('、');
      add('quality_failed', `${name}质检未通过：${shot.qualityError || finding || '请检查画面'}`);
    }
    if (shot.productRequired && (!shot.productIds?.length || shot.productMappingAmbiguous)) add('product_unresolved', `${name}尚未确定对应产品`);
    for (const blocker of shot.productionBlockers || []) add('production_blocked', `${name}：${blocker}`);
    issues.push(...shotIssues);
    return shotIssues.length ? [{ slotId: shot.id, index: shot.index, title: shot.title || `分镜 ${shot.index}`, issues: shotIssues }] : [];
  });
  return { ready: issues.length === 0, readyCount: input.shots.length - unreadyShots.length,
    totalCount: input.shots.length, issues, unreadyShots };
}
