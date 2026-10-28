/** Per-provider deadlines remain bounded; a source-first workflow contains several sequential calls. */
export function chatWorkflowDeadlines(input: { timeoutMs?: number; configuredTimeout?: string; backend: string; requireSources?: boolean; webSearch?: boolean; searchEvidenceFirst?: boolean }) {
 const configured=Number(input.timeoutMs ?? input.configuredTimeout ?? 90_000);
 const requestMs=Number.isFinite(configured)?Math.max(1000,Math.min(configured,120_000)):90_000;
 const sourceWorkflow=input.backend==='qwen' && (input.requireSources===true||input.webSearch===true) && input.searchEvidenceFirst===true;
 return {requestMs,workflowMs:sourceWorkflow?Math.min(420_000,requestMs*3+60_000):requestMs};
}
