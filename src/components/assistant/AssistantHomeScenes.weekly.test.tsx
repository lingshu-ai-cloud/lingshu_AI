import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';

// These contracts render the shared home/sidebar UI; styles are built by Vite.
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return nextLoad(url, context);
} });
const { default: AssistantHomeScenes } = await import('./AssistantHomeScenes');
const base = { plan: { id: 'plan' }, run: { id: 'run', status: 'running' }, tasks: [] } as unknown as DigitalEmployeeOverview;
const render = (overview: DigitalEmployeeOverview | null, variant: 'home' | 'sidebar' = 'home') => renderToStaticMarkup(createElement(AssistantHomeScenes, {
  agent: 'business', variant, overview, overviewLoaded: true, onPrompt: () => {},
  weeklyActions: variant === 'sidebar' ? ['create', 'revise', 'publish'] : [],
}));

test('shared home and sidebar require persisted production evidence before lighting the weekly entry', () => {
  for (const variant of ['home', 'sidebar'] as const) {
    assert.doesNotMatch(render(base, variant), /creator-home__suggestion--producing|creator-home__suggestion--attention/);
    const producing = { ...base, tasks: [{ run_id: 'run', kind: 'production', status: 'running' }] } as DigitalEmployeeOverview;
    assert.match(render(producing, variant), /creator-home__suggestion--producing/);
    assert.match(render(producing, variant), /查看当前周计划：正在生产/);
    const blocked = { ...producing, tasks: [...producing.tasks, { run_id: 'run', kind: 'production', status: 'blocked' }] } as DigitalEmployeeOverview;
    assert.match(render(blocked, variant), /查看当前周计划：有问题需要处理/);
    assert.doesNotMatch(render(blocked, variant), /creator-home__suggestion--producing/);
  }
});

test('sidebar keeps explicit weekly actions in the shared shortcut row', () => {
  const html = render(null, 'sidebar');
  for (const label of ['新建一条内容', '修改已有内容', '发布指定成片']) assert.match(html, new RegExp(label));
  assert.equal((html.match(/class="creator-home__suggestions"/g) || []).length, 1);
});
