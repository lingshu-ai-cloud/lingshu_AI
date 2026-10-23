import { readFileSync } from 'node:fs';
import ts from 'typescript';

const supportFiles = [
  new URL('../../src/components/studio/studioWorkspaceConfig.ts', import.meta.url),
  new URL('../../src/components/studio/studioManagedPresenter.ts', import.meta.url),
  new URL('../../src/components/studio/studioProjectNavigation.ts', import.meta.url),
  new URL('../../src/components/studio/studioMediaProbes.ts', import.meta.url),
  new URL('../../src/components/studio/studioWorkspaceCatalog.ts', import.meta.url),
  new URL('../../src/components/studio/studioMaterialPresentation.ts', import.meta.url),
  new URL('../../src/components/studio/studioStoryboardParsing.ts', import.meta.url),
  new URL('../../src/components/studio/studioFontCatalog.ts', import.meta.url),
  new URL('../../src/components/studio/studioScriptAdmission.ts', import.meta.url),
  new URL('../../src/components/studio/studioReferenceVoiceProfile.ts', import.meta.url),
  new URL('../../src/components/studio/studioScriptQualityPresentation.ts', import.meta.url),
  new URL('../../src/components/studio/studioAsyncSupport.ts', import.meta.url),
  new URL('../../src/components/studio/studioProductSelection.ts', import.meta.url),
  new URL('../../src/components/studio/studioCloneReference.ts', import.meta.url),
  new URL('../../src/components/studio/studioMaterialScriptEvidence.ts', import.meta.url),
  new URL('../../src/components/studio/studioScriptSanitization.ts', import.meta.url),
  new URL('../../src/components/studio/studioVoiceTranslation.ts', import.meta.url),
  new URL('../../src/components/studio/studioWorkspaceContracts.ts', import.meta.url),
  new URL('../../src/components/studio/studioLazyPanels.ts', import.meta.url),
];
const viewFiles = [
  new URL('../../src/components/studio/StudioStepView.tsx', import.meta.url),
  new URL('../../src/components/studio/StudioLanguageSwitcherView.tsx', import.meta.url),
  new URL('../../src/components/studio/StudioProductionPanelView.tsx', import.meta.url),
  new URL('../../src/components/studio/StudioPropertyPanelView.tsx', import.meta.url),
  new URL('../../src/components/studio/StudioShotLibraryView.tsx', import.meta.url),
  new URL('../../src/components/studio/StudioProductionEditorView.tsx', import.meta.url),
];

/** Assemble the real render bodies for existing page contracts. Validate every
 * call's shorthand wiring before restoring its helper, so a swapped binding
 * cannot disappear behind source composition. No baseline source is used. */
export function readAiStudioApplicationSources(): string {
  const helpers = new Map<string, { body: string; arrow: boolean; inputs: string[] }>();
  for (const url of viewFiles) {
    const text = readFileSync(url, 'utf8');
    const parsed = ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fn = parsed.statements.find(ts.isFunctionDeclaration);
    if (!fn?.name || !fn.body) throw Error('Missing Studio view: ' + url.pathname);
    const [binding, ...body] = fn.body.statements;
    if (!binding || !ts.isVariableStatement(binding)) throw Error('Missing Studio view inputs');
    const pattern = binding.declarationList.declarations[0]?.name;
    if (!pattern || !ts.isObjectBindingPattern(pattern)) throw Error('Invalid Studio view binding');
    const inputs = pattern.elements.map(item => item.name.getText(parsed));
    const arrow = fn.name.text === 'renderStudioStep';
    const returned = body[0];
    if (!arrow && (!returned || !ts.isReturnStatement(returned) || !returned.expression || !ts.isParenthesizedExpression(returned.expression))) throw Error('Invalid Studio view return');
    helpers.set(fn.name.text, { inputs, arrow, body: arrow
      ? '() => {\n' + body.map(item => item.getText(parsed)).join('\n') + '\n}'
      : (returned as ts.ReturnStatement).expression!.getText(parsed).slice(1, -1) });
  }
  let source = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('AiCreateStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const helper = helpers.get(node.expression.getText(parsed));
      if (helper) {
        const object = node.arguments[0];
        if (node.arguments.length !== 1 || !object || !ts.isObjectLiteralExpression(object)
          || object.properties.some(item => !ts.isShorthandPropertyAssignment(item))) throw Error('Studio view wiring must be explicit');
        const actual = object.properties.map(item => (item as ts.ShorthandPropertyAssignment).name.text).sort();
        if (JSON.stringify(actual) !== JSON.stringify([...helper.inputs].sort())) throw Error('Studio view input mismatch');
        const target = helper.arrow ? node.parent : node;
        if (helper.arrow && !ts.isArrowFunction(target)) throw Error('Studio step rendering must remain deferred');
        edits.push({ start: target.getStart(parsed), end: target.end, text: helper.body });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (edits.length !== viewFiles.length) throw Error('Missing or duplicated Studio view assembly');
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return [...supportFiles.map(url => readFileSync(url, 'utf8')), source].join('\n');
}
