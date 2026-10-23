import { readFileSync } from 'node:fs';
import ts from 'typescript';

function parse(source: string) {
  return ts.createSourceFile('studio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Follow the current lifecycle implementation for page source contracts.
 * Assert the real port/return wiring before composing it. No saved baseline,
 * duplicated implementation, or permissive placeholder bodies are used. */
export function restoreStudioBoundaryComposition(source: string, options: {
  moduleNames: string[];
  portBinding: string;
  actionFactories: string[];
  lexicalDefaults?: string[];
}): string {
  const functions = new Map<string, { body: string; outputs: string[] }>();
  const actions = new Map<string, string>();
  const factories = new Set<string>();
  for (const name of options.moduleNames) {
    const original = readFileSync(new URL('../../src/components/studio/' + name, import.meta.url), 'utf8');
    const parsed = parse(original);
    const removals: Array<{ start: number; end: number }> = [];
    function visit(node: ts.Node) {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
        const item = node.declarationList.declarations[0];
        if (item && ts.isObjectBindingPattern(item.name) && item.initializer?.getText(parsed) === 'ports') {
          if (item.name.elements.some(field => field.propertyName || field.dotDotDotToken || field.initializer)) throw Error('Studio ports must preserve binding names');
          removals.push({ start: node.getStart(parsed), end: node.end });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    let cleaned = original;
    for (const edit of removals.sort((a, b) => b.start - a.start)) cleaned = cleaned.slice(0, edit.start) + cleaned.slice(edit.end);
    // Optional defaults retain the same originating render's lexical binding.
    for (const field of options.lexicalDefaults || []) cleaned = cleaned.replace('= ports.' + field, '= ' + field);
    const file = parse(cleaned);
    for (const fn of file.statements.filter(ts.isFunctionDeclaration)) {
      if (!fn.name || !fn.body) continue;
      const name = fn.name.text;
      const statements = [...fn.body.statements];
      const last = statements.at(-1);
      let outputs: string[] = [];
      if (last && ts.isReturnStatement(last) && last.expression && ts.isObjectLiteralExpression(last.expression)) {
        if (last.expression.properties.some(item => !ts.isShorthandPropertyAssignment(item))) throw Error('Studio outputs must preserve binding names');
        outputs = last.expression.properties.map(item => (item as ts.ShorthandPropertyAssignment).name.text);
        statements.pop();
      }
      if (options.actionFactories.includes(name)) {
        factories.add(name);
        for (const statement of statements.filter(ts.isVariableStatement)) {
          const binding = statement.declarationList.declarations[0];
          if (binding && ts.isIdentifier(binding.name) && outputs.includes(binding.name.text)) actions.set(binding.name.text, statement.getFullText(file));
        }
      } else {
        functions.set(name, { body: statements.map(item => item.getFullText(file)).join('\n'), outputs });
      }
    }
  }
  const parsed = parse(source);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const instances = new Map<string, string>();
  const composedFunctions = new Set<string>();
  const composedActions = new Set<string>();
  let bridgeCount = 0;
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
      const binding = node.declarationList.declarations[0];
      if (!binding) return;
      const value = binding.initializer;
      const name = binding.name.getText(parsed);
      if (name === options.portBinding) {
        if (!value || !ts.isObjectLiteralExpression(value)) throw Error('Missing boundary port bridge');
        for (const field of value.properties) {
          if (!ts.isGetAccessorDeclaration(field) || field.body?.statements.length !== 1) throw Error('Studio ports must be lazy getters');
          const returned = field.body.statements[0];
          if (!returned || !ts.isReturnStatement(returned) || returned.expression?.getText(parsed) !== field.name.getText(parsed)) throw Error('Studio port binding mismatch');
        }
        bridgeCount++;
        edits.push({ start: node.getStart(parsed), end: node.end, text: '' });
        return;
      }
      if (value && ts.isCallExpression(value) && factories.has(value.expression.getText(parsed))) {
        if (value.arguments.length !== 1 || value.arguments[0]?.getText(parsed) !== options.portBinding) throw Error('Invalid boundary factory wiring');
        instances.set(name, value.expression.getText(parsed));
        edits.push({ start: node.getStart(parsed), end: node.end, text: '' });
        return;
      }
      if (value && ts.isPropertyAccessExpression(value) && instances.has(value.expression.getText(parsed))) {
        if (name !== value.name.text || !actions.has(name)) throw Error('Studio action binding mismatch');
        if (composedActions.has(name)) throw Error('Duplicated Studio action binding');
        composedActions.add(name);
        edits.push({ start: node.getStart(parsed), end: node.end, text: actions.get(name)! });
        return;
      }
      if (value && ts.isCallExpression(value)) {
        const fn = functions.get(value.expression.getText(parsed));
        if (fn) {
          markFunction(value.expression.getText(parsed));
          if (!ts.isObjectBindingPattern(binding.name) || binding.name.elements.some(item => item.propertyName || item.initializer)
            || JSON.stringify(binding.name.elements.map(item => item.name.getText(parsed)).sort()) !== JSON.stringify([...fn.outputs].sort())) throw Error('Studio hook return mismatch');
          validateArguments(value);
          edits.push({ start: node.getStart(parsed), end: node.end, text: fn.body });
          return;
        }
      }
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const fn = functions.get(node.expression.expression.getText(parsed));
      if (fn) {
        markFunction(node.expression.expression.getText(parsed));
        if (fn.outputs.length) throw Error('Unbound boundary hook output');
        validateArguments(node.expression);
        edits.push({ start: node.getStart(parsed), end: node.end, text: fn.body });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  function validateArguments(call: ts.CallExpression) {
    if (call.arguments.length > 1 || (call.arguments.length === 1 && call.arguments[0]?.getText(parsed) !== options.portBinding)) throw Error('Studio hook port mismatch');
  }
  function markFunction(name: string) {
    if (composedFunctions.has(name)) throw Error('Duplicated Studio Hook/model binding');
    composedFunctions.add(name);
  }
  visit(parsed);
  if (bridgeCount !== 1 || instances.size !== factories.size) throw Error('Incomplete boundary composition');
  if (composedFunctions.size !== functions.size || composedActions.size !== actions.size) throw Error('Missing Studio Hook/model/action binding');
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
