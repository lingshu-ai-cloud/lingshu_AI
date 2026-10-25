/** Translate observed refusal codes; never turn unknown failures into success. */
export function creationAdmissionMessage(reason: string | undefined): string {
  if (reason === 'social_reference_critical_analysis_outcome_unknown') {
    return '关键镜头分析请求超时，调用结果待核对。任务已保留，确认结果前暂停重复提交。';
  }
  if (reason?.startsWith('social_replication_system_review_blocked:')) {
    const labels: Record<string,string> = {
      product_identity_unresolved: '产品身份与逐镜方案尚未完成关联',
      expression_failed: '参考视频的分镜、口播或授权证据尚未完整',
      capability_mismatch: '部分镜头尚无可执行的素材或制作路线',
      scene_review_incomplete: '逐镜方案尚未通过系统审核',
      reference_analysis_incomplete: '参考视频全片分析尚未完成',
      script_analysis_mismatch: '脚本与参考分析版本尚未匹配',
    };
    return [...new Set(reason.split(':').slice(1).join(':').split(',').map(code=>labels[code]||'执行方案需要进一步检查'))].join('；');
  }
  return '执行启动受阻，需核对制作条件；任务已保留。';
}
