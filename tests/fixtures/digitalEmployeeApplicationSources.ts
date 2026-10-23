import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Select the real registration expression, never a slice that leaks into a neighboring use case. */
export function digitalEmployeeRouteBlock(source: string, start: string): string {
  const parsed = ts.createSourceFile('digitalEmployeeContract.ts', source, ts.ScriptTarget.Latest, true);
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.getText(parsed).startsWith(start)) result = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!result) throw new Error(`Missing route registration: ${start}`);
  return result;
}

export function digitalEmployeeFunction(source: string, name: string): string {
  const parsed = ts.createSourceFile('digitalEmployeeContract.ts', source, ts.ScriptTarget.Latest, true);
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.getText(parsed).length > result.length) result = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!result) throw new Error(`Missing application function: ${name}`);
  return result;
}

/** Read the actual composed application when a cross-area source contract spans the old route file. */
export function readDigitalEmployeeApplicationSources(): string {
  return [
    new URL('../../server/digitalEmployees/workflowRepository.ts', import.meta.url),
    new URL('../../server/digitalEmployees/runtimeConfiguration.ts', import.meta.url),
    new URL('../../server/digitalEmployees/goalFactRebuildReadModel.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeFactRebuildRoutes.ts', import.meta.url),
    new URL('../../server/digitalEmployees/weeklyPackagePreparation.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeePackageRoutes.ts', import.meta.url),
    new URL('../../server/digitalEmployees/taskApprovalPreparation.ts', import.meta.url),
    new URL('../../server/digitalEmployees/runCoordinator.ts', import.meta.url),
    new URL('../../server/digitalEmployees/workflowEvents.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeBrowserRoutes.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeAssistantDecisionRoutes.ts', import.meta.url),
    new URL('../../server/digitalEmployees/initialPreparationRuntime.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeOnboardingRoutes.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeContentProjectRoutes.ts', import.meta.url),
    new URL('../../server/digitalEmployees/goalActivationApplication.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeGoalRoutes.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeCustomerWorkflowRoutes.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeRunControlRoutes.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployeeOverviewRoutes.ts', import.meta.url),
    new URL('../../server/routes/digitalEmployees.ts', import.meta.url),
  ].map(file => readFileSync(file, 'utf8')).join('\n');
}
