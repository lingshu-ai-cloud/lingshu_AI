/** Describe the same safety gates used by the step-three render action. */
export function studioPreviewRenderBlockers(input: {
  busy: boolean;
  ready: boolean;
  canGenerateVoiceover: boolean;
  readinessIssues: string[];
  subtitleReason: string;
  alignmentReason: string;
  renderableVersions: number;
  needsVoiceover: boolean;
  timingBlocked: boolean;
  preparationError?: string;
}): string[] {
  const reasons: string[] = [];
  if (input.busy) reasons.push('配音或成片正在生成，请等待当前任务完成。');
  if (!input.ready && !input.canGenerateVoiceover) reasons.push(...(input.readinessIssues.length ? input.readinessIssues : ['请先完成全部分镜。']));
  if (input.subtitleReason && !input.canGenerateVoiceover) reasons.push(input.subtitleReason);
  if (input.alignmentReason) reasons.push(input.alignmentReason);
  if (input.renderableVersions === 0 && !input.needsVoiceover) reasons.push('当前没有可渲染的语言版本，请检查口播与分镜素材。');
  if (input.timingBlocked) reasons.push(input.preparationError || '参考视频时间线仍在准备，请等待完成。');
  return [...new Set(reasons.filter(Boolean))];
}
