/** Settings navigation is distinct from admission to paid generation or rendering. */
export function canOpenWorkbenchRenderSettings(input: {
  shotCount: number; replication: boolean; freeCreation: boolean; freeCreationReady: boolean;
}): boolean {
  return input.shotCount > 0 && (input.replication || !input.freeCreation || input.freeCreationReady);
}

/** Replication exports the current rendered file without a human signature.
 * Callers resolve currentOutputPath from the current input signature, never historical output.
 */
export function workbenchExportBlockReason(input: {
  replication: boolean; currentOutputPath?: string | null; reviewedPath?: string | null; qualityRecordPath?: string | null;
}): string {
  if (!input.currentOutputPath) return '成片尚未生成';
  if (input.replication) return '';
  if (input.reviewedPath !== input.currentOutputPath) return '请先完整检查并确认当前成片';
  if (input.qualityRecordPath !== input.currentOutputPath) return '当前版本尚未重新质检，请先点击“重新质检并签发”';
  return '';
}
