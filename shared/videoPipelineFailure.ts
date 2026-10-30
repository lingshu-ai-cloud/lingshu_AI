export type VideoPipelineFailure = {
  code: 'none' | 'media_missing' | 'collection_quota' | 'content_rejected' | 'timeout' | 'queue_admission' | 'source_unavailable' | 'analysis_failed';
  stage: 'media' | 'collection' | 'queue' | 'analysis';
  message: string;
  action: string;
  retryable: boolean;
};

/** Public, actionable copy only: never expose provider errors or credentials. */
export function videoPipelineFailure(error: unknown): VideoPipelineFailure {
  const text = String(error || '');
  if (!text) return { code: 'none', stage: 'analysis', message: '', action: '', retryable: false };
  if (/COS video not found|video_media_missing|queued_local_material_missing|^media_missing$/i.test(text)) return {
    code: 'media_missing', stage: 'media', message: '视频文件缺失，当前保存的播放地址不可用。', action: '请重新上传原视频或联系管理员核对存储；原站可用时仍可查看。', retryable: false,
  };
  if (/Monthly usage hard limit exceeded|platform-feature-disabled|^collection_quota$/i.test(text)) return {
    code: 'collection_quota', stage: 'collection', message: '采集服务月度用量达到上限，原视频尚未获取。', action: '请管理员核对当前采集额度，再确认是否重新采集。', retryable: false,
  };
  if (/DataInspectionFailed|content[_ -]?(?:policy|filter)|inappropriate content|^content_rejected$/i.test(text)) return {
    code: 'content_rejected', stage: 'analysis', message: '分析服务的内容检查未通过，本次未返回有效分析结果。', action: '请人工核对素材或向供应商申请复核，勿直接重复提交。', retryable: false,
  };
  if (/queue.*(?:persistence_failed|not_accepted|receipt_missing)|入队失败|^queue_admission$/i.test(text)) return {
    code: 'queue_admission', stage: 'queue', message: '素材已保存，但分析任务未成功提交。', action: '请重新提交分析任务；未显示排队回执前不代表已开始。', retryable: true,
  };
  if (/timeout|timed out|超时/i.test(text)) return {
    code: 'timeout', stage: 'analysis', message: '本次分析请求超时，未取得完整结果。', action: '请先核对本次调用结果，再决定是否重新分析。', retryable: true,
  };
  if (/404|not found|unable to download|download webpage|unsupported url|yt_dlp|yt-dlp|^source_unavailable$/i.test(text)) return {
    code: 'source_unavailable', stage: 'collection', message: '原视频获取失败，尚未完成视频分析。', action: '请确认来源链接可用，或上传原视频后再分析。', retryable: true,
  };
  return { code: 'analysis_failed', stage: 'analysis', message: '视频分析未完成。', action: '请查看任务状态后重新提交，持续失败时联系管理员。', retryable: true };
}

/** Re-projecting an already public record must preserve its safe classification. */
export function videoPipelineFailureForAnalysis(analysis: { analysisError?: unknown; videoLevelFailureStatus?: unknown; downloadError?: unknown; pipelineFailure?: unknown }): VideoPipelineFailure {
  const raw = analysis.analysisError || analysis.videoLevelFailureStatus || analysis.downloadError;
  if (raw) return videoPipelineFailure(raw);
  const previous = analysis.pipelineFailure;
  const code = previous && typeof previous === 'object' && 'code' in previous ? previous.code : '';
  return videoPipelineFailure(typeof code === 'string'
    && /^(media_missing|collection_quota|content_rejected|timeout|queue_admission|source_unavailable|analysis_failed)$/.test(code) ? code : '');
}
