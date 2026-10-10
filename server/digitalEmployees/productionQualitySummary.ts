/** Public monitor fields deliberately omit file paths, raw provider output and credentials. */
export function productionQualitySummary(spec: Record<string, any>) {
  const automation = spec.automation || {};
  const quality = automation.quality || {};
  const diagnostics = quality.sceneDiagnostics;
  const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues : [];
  const history = Array.isArray(automation.sceneRepairHistory) ? automation.sceneRepairHistory : [];
  const lastRepair = history.at(-1);
  return {
    stage: String(automation.stage || ''),
    analysisMessage: String(automation.materialAnalysisProgress || ''),
    repairAttempts: Number(automation.sceneRepairAttempts || 0),
    ...(typeof quality.passed === 'boolean' ? { passed: quality.passed } : {}),
    problems: issues.map((issue: any) => ({ shot: Number(issue.sceneIndex) + 1, timeRange: `${Number(issue.start).toFixed(1)}–${Number(issue.end).toFixed(1)} 秒`, reason: String(issue.reason || '') })),
    lastRepair: lastRepair ? { shots: (lastRepair.replacements || []).map((item: any) => Number(item.sceneIndex) + 1),
      message: quality.passed === true ? '替换镜头后已通过成片质检' : quality.passed === false ? '替换镜头后仍有问题，请查看质检原因' : '已替换问题镜头，等待重新渲染与质检' } : undefined,
  };
}
