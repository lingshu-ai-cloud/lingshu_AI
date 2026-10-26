/** Product route availability, separate from credentials, spending permission
 * and asset rights. Changing a frozen route always requires a new decision. */
export function presenterProductionRoute(input: {
  sourceStrategy?: string | null;
  method?: string | null;
  silentMotion?: boolean;
  provider?: string;
  speechReviewPolicy?: string;
}): { kind: 'real_material' | 'silent_motion' | 'generated_speech' | 'other'; executable: boolean; code: string | null; message: string; nextActions: string[] } {
  if (input.sourceStrategy === 'customer_real_asset' || input.sourceStrategy === 'owned_exact_local_video') {
    return { kind: 'real_material', executable: true, code: null,
      message: '复用已授权、已核验的真实口播素材；继续检查时长、身份和声音。', nextActions: [] };
  }
  if (input.sourceStrategy !== 'authorized_digital_presenter') return {
    kind: 'other', executable: true, code: null, message: '', nextActions: [],
  };
  if (input.method === 'reenact' && input.silentMotion === true) return {
    kind: 'silent_motion', executable: true, code: null,
    message: '无口型要求的人物动作；仍需动作测量、人物授权和动态质检。', nextActions: [],
  };
  if (input.provider === 'heygen' && input.speechReviewPolicy === 'heygen_native_human_review') return {
    kind: 'generated_speech', executable: true, code: null,
    message: 'HeyGen 原生口播；口型效果待成片人工验收，未通过独立口型自动检测。', nextActions: [],
  };
  return { kind: 'generated_speech', executable: false,
    code: 'presenter_speech_route_unavailable',
    message: '生成式人物口播尚无已获商业授权的独立口型验收能力，当前不能开工。',
    nextActions: ['上传已授权的真实口播素材并重新确认逐镜方案', '改为产品展示配音并重新确认脚本与制作方案', '保留人物口播方案，等待该路线具备可验证的验收能力'],
  };
}
