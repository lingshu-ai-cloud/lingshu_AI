import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import type { TrendVideo } from '../lib/inspirationTypes';

const compiled = ts.transpileModule(fs.readFileSync(new URL('./InspirationVideoCards.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Node = { type: unknown; props: Record<string, any> };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
const video: TrendVideo = { id: 'v1', platform: 'tiktok', title: 'Reference', thumbnail: '/cover.jpg', duration: 30, tags: [], views: '200', trend: 'hot', videoUrl: '/media/v1', contentFormat: 'video' };
const descendants = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(descendants)
  : node && typeof node === 'object' && 'type' in node ? [node as Node, ...descendants((node as Node).props.children)] : [];

function harness(observationAvailable = true) {
  let cursor = 0;
  const cells: Cell[] = [];
  const effects: Array<() => void> = [];
  const scrollRoot = { overflowY: 'auto', parentElement: null };
  const card = { parentElement: { overflowY: 'visible', parentElement: scrollRoot } };
  const observers: FakeObserver[] = [];
  class FakeObserver {
    disconnected = false;
    target: unknown;
    constructor(readonly notify: (entries: Array<{ isIntersecting: boolean }>) => void, readonly options: IntersectionObserverInit) { observers.push(this); }
    observe(target: unknown) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const hooks = {
    useRef(initial: unknown) { const entry = cell(); return entry.value ?? (entry.value = { current: initial }); },
    useState(initial: unknown) {
      const entry = cell();
      if (!('value' in entry)) entry.value = typeof initial === 'function' ? initial() : initial;
      return [entry.value, (next: unknown) => { entry.value = typeof next === 'function' ? next(entry.value) : next; }];
    },
    useEffect(run: () => (() => void) | undefined, deps: readonly unknown[]) {
      const entry = cell();
      if (!entry.deps || entry.deps.some((value, index) => !Object.is(value, deps[index]))) {
        entry.deps = deps;
        effects.push(() => { entry.cleanup?.(); entry.cleanup = run(); });
      }
    },
  };
  const jsx = (type: unknown, props: Record<string, any>) => {
    if (type === 'article' && props.ref) props.ref.current = card;
    return { type, props };
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports,
    IntersectionObserver: observationAvailable ? FakeObserver : undefined,
    window: { getComputedStyle: (element: { overflowY: string }) => ({ overflowY: element.overflowY }) },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'antd') return { Button: 'Button' };
      if (name === 'lucide-react') return {};
      if (name === './SocialPlatformIcon') return { SocialPlatformIcon: 'SocialPlatformIcon' };
      if (name === './ui/LsExperiencePrimitives') return { LsMediaStateFrame: 'LsMediaStateFrame' };
      if (name === './InspirationDashboard') return { AuthenticatedVideo: 'AuthenticatedVideo', ThumbnailImage: 'ThumbnailImage', getPlatformMeta: () => ({ label: 'TikTok' }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    scrollRoot, card, observers,
    render(item = video): Node {
      cursor = 0;
      const tree = exports.VideoCard({ video: item, index: 0, isSelected: false, onSelect() {}, onCreate() {}, onWatch() {} });
      effects.splice(0).forEach(run => run());
      return tree;
    },
    cleanup() { cells.forEach(entry => entry.cleanup?.()); },
  };
}
const players = (tree: Node) => descendants(tree).filter(node => node.type === 'AuthenticatedVideo');

test('offscreen media waits for its nested scroll viewport while retaining its cover and dimensions', () => {
  const page = harness();
  const initial = page.render();
  assert.equal(players(initial).length, 0);
  assert.equal(descendants(initial).filter(node => node.type === 'ThumbnailImage').length, 1);
  const ratio = descendants(initial).find(node => node.props.style?.aspectRatio)?.props.style.aspectRatio;
  const observer = page.observers[0];
  assert.equal(observer.target, page.card);
  assert.equal(observer.options.root, page.scrollRoot);
  observer.notify([{ isIntersecting: false }]);
  assert.equal(players(page.render()).length, 0);
  observer.notify([{ isIntersecting: true }]);
  const visible = page.render();
  assert.equal(players(visible).length, 1);
  assert.equal(descendants(visible).find(node => node.props.style?.aspectRatio)?.props.style.aspectRatio, ratio);
  assert.equal(observer.disconnected, true);
  page.cleanup();
});

test('keyboard focus enables media without IntersectionObserver support', () => {
  const page = harness(false);
  const initial = page.render();
  assert.equal(players(initial).length, 0);
  initial.props.onFocusCapture();
  assert.equal(players(page.render()).length, 1);
  page.cleanup();
});

test('replacing a card does not preload its new URL or accept a stale observer callback', () => {
  const page = harness();
  page.render();
  const previous = page.observers[0];
  previous.notify([{ isIntersecting: true }]);
  assert.equal(players(page.render()).length, 1);
  const replacement = { ...video, id: 'v2', videoUrl: '/media/v2' };
  assert.equal(players(page.render(replacement)).length, 0);
  previous.notify([{ isIntersecting: true }]);
  assert.equal(players(page.render(replacement)).length, 0);
  page.observers.at(-1)!.notify([{ isIntersecting: true }]);
  assert.equal(players(page.render(replacement))[0].props.apiUrl, '/media/v2');
  page.cleanup();
});
