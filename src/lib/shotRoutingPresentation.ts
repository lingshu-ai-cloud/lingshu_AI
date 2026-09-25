import type { ShotContentType, ShotProduction, ShotSource } from './shotProduction';

/**
 * The browser-safe projection of the routing contract.  The first version is
 * derived from the editable shot; a later routing service may populate the
 * same fields without changing the storyboard UI.
 */
export type ShotRoutingDecision = {
  route: 'presenter_talking' | 'first_frame_video' | 'ugc_actor' | 'material_edit' | 'ai_broll';
  confidence: number;
  reasons: string[];
  requiresUserConfirmation: boolean;
  missing: string[];
  alternatives: Array<{ route: ShotRoutingDecision['route']; label: string; source: ShotSource; description: string }>;
};

const typeOf = (shot: ShotProduction): ShotContentType => shot.contentType || (shot.source === 'avatar' ? 'enterprise_presenter' : 'product');

export function routeLabel(route: ShotRoutingDecision['route']): string {
  return ({ presenter_talking: '企业人物口播', first_frame_video: '目标人物首帧驱动', ugc_actor: 'AI 行业角色', material_edit: '素材剪辑', ai_broll: 'AI 补镜' } as const)[route];
}

export function presentShotRouting(shot: ShotProduction, input: { hasPresenter: boolean; hasMaterial: boolean; recommendation?: string }): ShotRoutingDecision {
  const contentType = typeOf(shot);
  const alternatives: ShotRoutingDecision['alternatives'] = [];
  if (contentType === 'enterprise_presenter') {
    const useFirstFrame = shot.digitalHuman?.workflow === 'viral_replication' && shot.digitalHuman.method === 'reenact';
    const missing = [!input.hasPresenter ? '缺少已授权的企业人物资产' : '', !shot.narration.trim() ? '缺少确认口播' : ''].filter(Boolean);
    if (useFirstFrame) missing.push(!shot.digitalHuman?.reference?.materialId ? '缺少参考视频素材' : '');
    alternatives.push(
      { route: 'presenter_talking', label: '企业人物口播', source: 'avatar', description: '适合稳定口播和轻微手势。' },
      { route: 'material_edit', label: '已有企业人物视频', source: 'material', description: '优先剪辑已拍摄的企业人物素材。' },
      { route: 'ai_broll', label: '人物口播 + 工厂 B-roll', source: 'material', description: '将复杂背景或动作拆为无人物镜头。' },
    );
    return { route: useFirstFrame ? 'first_frame_video' : 'presenter_talking', confidence: missing.length ? 0.55 : 0.88,
      reasons: useFirstFrame
        ? ['需要保留参考镜头的背景、设备或机位，同时替换为企业人物。', '默认按句提取源首帧，再审核目标人物首帧。']
        : ['本镜头需要企业人物身份与可编辑口播。', '背景或产品可作为独立素材与人物镜头组合。'],
      requiresUserConfirmation: useFirstFrame || Boolean(missing.length), missing, alternatives };
  }
  if (contentType === 'ugc') {
    const missing = [!shot.ugcRole?.trim() ? '缺少行业角色设定' : '', !shot.ugcScenario?.trim() ? '缺少场景与动作说明' : ''].filter(Boolean);
    alternatives.push(
      { route: 'ugc_actor', label: 'AI 行业角色', source: 'ai', description: '生成新角色，只借鉴参考的镜头语言与结构。' },
      { route: 'material_edit', label: '已授权达人／泛素材', source: 'material', description: '使用已取得授权的真人素材。' },
      { route: 'material_edit', label: '无人物操作镜头', source: 'material', description: '改用手部、产品或场景来承接叙事。' },
    );
    return { route: 'ugc_actor', confidence: missing.length ? 0.62 : 0.86,
      reasons: ['本镜头需要行业真实感，而非指定企业人物。', '参考真人的脸、声音和身份不会作为模型输入。'],
      requiresUserConfirmation: Boolean(missing.length), missing, alternatives };
  }
  const useAi = shot.source === 'ai' || !input.hasMaterial;
  alternatives.push(
    { route: 'material_edit', label: '企业素材／授权片段', source: 'material', description: '优先复用产品、工厂或操作实拍。' },
    { route: 'ai_broll', label: 'AI 补镜', source: 'ai', description: '在缺少必要镜头时生成补充画面。' },
    { route: 'material_edit', label: '安排补拍', source: 'shoot', description: '需要真实证据或指定操作时补拍。' },
  );
  return { route: useAi ? 'ai_broll' : 'material_edit', confidence: input.hasMaterial ? 0.93 : 0.76,
    reasons: ['这是产品、场景或信息镜头，不需要企业人物口播。', input.hasMaterial ? '已有可用素材，优先剪辑以保留真实产品与环境。' : '当前缺少匹配素材，可先使用 AI 补镜或安排补拍。'],
    requiresUserConfirmation: !input.hasMaterial, missing: input.hasMaterial ? [] : ['缺少可用的企业或授权素材'], alternatives };
}
