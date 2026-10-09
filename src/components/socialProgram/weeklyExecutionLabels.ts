import type { WeeklyProductionStepKind } from '../../../shared/contracts/socialProgram';

export const STEP_LABEL: Record<WeeklyProductionStepKind, string> = {
  business_outline: '1. 生成任务总纲',
  benchmark_collection: '2. 采集对标账号与视频',
  benchmark_scoring: '3. 服务端评分与筛选',
  director_analysis: '4. 编导拆解对标结论',
  business_schedule: '5. 合并详细内容排期',
  material_readiness: '6. 核对素材与授权',
  script: '7. 生成口播与脚本',
  storyboard: '8. 生成逐镜分镜',
  asset_generation: '9. 匹配或生成素材',
  video_generation: '10. 合成、配音与渲染',
  quality_check: '11. 事实、画面、音频与版权质检',
  rework: '12. 按质检结果局部返工',
  user_approval: '13. 用户确认成片',
  publishing: '14. 发布到目标账号',
  performance_monitoring: '15. 回传表现与线索',
  weekly_review: '16. 周复盘与下轮建议',
};
