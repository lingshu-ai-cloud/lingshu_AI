import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { lsMotion } from '../../lib/designTokens';

type Node = { type: unknown; props: Record<string, any> };
type Cell = { value?: any; deps?: unknown[]; cleanup?: () => void };
const compiled = ts.transpileModule(fs.readFileSync('src/components/ui/LsExperiencePrimitives.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness(component: string) {
  let cursor = 0;
  let reducedMotion = false;
  let canceled = 0;
  const cells: Cell[] = [];
  const effects: Array<() => void> = [];
  const animations: Array<{ frames: any; options: any }> = [];
  const element = { animate(frames: any, options: any) { animations.push({ frames, options }); return { cancel() { canceled += 1; } }; } };
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const hooks = {
    useState(initial: unknown) { const entry = cell(); if (!('value' in entry)) entry.value = initial; return [entry.value, (value: unknown) => { entry.value = value; }]; },
    useRef(initial: unknown) { const entry = cell(); return entry.value ?? (entry.value = { current: initial }); },
    useEffect(run: () => (() => void) | undefined, deps: unknown[]) {
      const entry = cell();
      if (!entry.deps || deps.some((value, index) => !Object.is(value, entry.deps?.[index]))) {
        entry.deps = deps;
        effects.push(() => { entry.cleanup?.(); entry.cleanup = run(); });
      }
    },
  };
  const jsx = (type: unknown, props: Record<string, any>): Node => {
    if (props.ref) props.ref.current = element;
    return { type, props };
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports, module: { exports },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'antd') return Object.fromEntries(['Avatar', 'Button', 'Empty', 'Image', 'Masonry', 'Modal', 'Progress', 'Skeleton', 'Space', 'Spin', 'Steps'].map(name => [name, name]));
      if (name === '../../lib/designTokens') return { lsMotion };
      if (name === '../../lib/usePrefersReducedMotion') return { usePrefersReducedMotion: () => reducedMotion };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    render(props: Record<string, any>): Node { cursor = 0; const tree = exports[component](props); for (const effect of effects.splice(0)) effect(); return tree; },
    setReducedMotion(value: boolean) { reducedMotion = value; },
    get animations() { return animations; }, get canceled() { return canceled; },
  };
}

function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children)] : [];
}

test('progressive media reveals successful and fallback images and resets only for a new source', () => {
  const h = harness('LsProgressiveMedia');
  let loadCalls = 0;
  let errorCalls = 0;
  const props = { src: '/first.jpg', onLoad: () => { loadCalls += 1; }, onError: () => { errorCalls += 1; } };
  let image = h.render(props);
  assert.equal(image.props.style.opacity, 0);
  image.props.onLoad({}); image = h.render(props);
  assert.equal(image.props.style.opacity, 1); assert.equal(loadCalls, 1);
  image = h.render({ ...props, src: '/missing.jpg' });
  assert.equal(image.props.style.opacity, 0, 'a changed image cannot inherit the previous image readiness');
  image.props.onError({}); image = h.render({ ...props, src: '/missing.jpg' });
  assert.equal(image.props.style.opacity, 1, 'the accessible fallback is not hidden after a failed image');
  assert.equal(image.props.fallback, '/image-placeholder.svg'); assert.equal(errorCalls, 1);
});

test('step transitions keep the existing fields and cancel immediately when reduced motion changes', () => {
  const h = harness('LsFlowDialog');
  const fields = { type: 'input', props: { value: '保留用户输入' } };
  const props = { open: true, current: 0, steps: [], children: fields };
  const initial = h.render(props);
  const originalContent = nodes(initial).find(node => node.props.className?.includes('ls-flow-dialog__content'))!;
  const next = h.render({ ...props, current: 1 });
  const nextContent = nodes(next).find(node => node.props.className?.includes('ls-flow-dialog__content'))!;
  assert.equal(nextContent.props.children, originalContent.props.children);
  assert.equal(nextContent.props.key, undefined, 'step changes do not key-remount the form');
  assert.equal(h.animations.length, 2); assert.equal(h.canceled, 1);
  assert.equal(h.animations[1].options.duration, lsMotion.duration.standard);
  h.setReducedMotion(true); h.render({ ...props, current: 1 });
  assert.equal(h.animations.length, 2); assert.equal(h.canceled, 2);
  h.render({ ...props, current: 2 });
  assert.equal(h.animations.length, 2, 'steps remain immediately usable while spatial motion is disabled');
});

test('reduced-motion Skeleton stays static and unknown media progress remains indeterminate', () => {
  const loading = harness('LsLoadingState');
  loading.setReducedMotion(true);
  const tree = loading.render({ loading: true, children: '内容' });
  assert.equal(nodes(tree).find(node => node.type === 'Skeleton')?.props.active, false);
  const media = harness('LsMediaStateFrame').render({ state: 'processing', label: '正在生成' });
  assert.ok(nodes(media).some(node => node.type === 'Spin'));
  assert.equal(nodes(media).some(node => node.props.percent === 0), false, 'unknown progress is never presented as an invented zero percent');
  assert.ok(nodes(media).some(node => node.props.role === 'status' && node.props['aria-live'] === 'polite'));
});
