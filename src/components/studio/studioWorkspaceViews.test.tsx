import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderStudioLanguageSwitcher } from './StudioLanguageSwitcherView.js';
import { renderStudioPropertyPanel } from './StudioPropertyPanelView.js';
import { renderStudioProductionPanel } from './StudioProductionPanelView.js';
import type { StudioLanguageSwitcherViewInputs } from './studioLanguageSwitcherViewInputs.js';
import type { StudioPropertyPanelViewInputs } from './studioPropertyPanelViewInputs.js';
import type { StudioProductionPanelViewInputs } from './studioProductionPanelViewInputs.js';
import { fontCss as canonicalFontCss } from './studioFontCatalog.js';
import { fontCss as publicFontCss } from '../AiCreateStudio.js';

type ElementProps = { children?: ReactNode; 'aria-label'?: string; disabled?: boolean; onClick?: () => void };
function elements(node: ReactNode): ElementProps[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node.props, ...elements(node.props.children)];
}
const unexpected = (..._args: unknown[]): never => { throw Error('unexpected action during rendering'); };
function languages(overrides: Partial<StudioLanguageSwitcherViewInputs> = {}): StudioLanguageSwitcherViewInputs {
  return { voiceLangs: ['en', 'es'], activeVoiceLang: 'en', voiceDraftFailedLangs: [], ttsFailuresByLang: {},
    workflowSourceLanguage: 'en', setActiveVoiceLang: unexpected, setLang: unexpected,
    removeTranslationLanguage: unexpected, setShowLanguagePicker: unexpected, showLanguagePicker: false,
    toggleTranslationLanguage: unexpected, ...overrides };
}

test('the original language cannot be removed while a translation invokes the supplied removal action', () => {
  const removed: string[] = [];
  const view = renderStudioLanguageSwitcher(languages({ removeTranslationLanguage: code => removed.push(code) }));
  const removalButtons = elements(view).filter(item => item['aria-label']?.startsWith('删除 '));
  assert.equal(removalButtons.length, 1);
  removalButtons[0]!.onClick!();
  assert.deepEqual(removed, ['es']);
  assert.match(renderToStaticMarkup(view), /原文/);
});

test('changing the active language updates both existing language controls through the supplied actions', () => {
  const writes: string[] = [];
  const view = renderStudioLanguageSwitcher(languages({
    setActiveVoiceLang: code => { assert.equal(typeof code, 'string'); writes.push('active:' + code); },
    setLang: code => { assert.equal(typeof code, 'string'); writes.push('language:' + code); },
  }));
  const languageButtons = elements(view).filter(item => typeof item.children === 'object' && Array.isArray(item.children)
    && item.children.includes(' · 原文'));
  assert.equal(languageButtons.length, 1);
  languageButtons[0]!.onClick!();
  assert.deepEqual(writes, ['active:en', 'language:en']);
});

function preview(overrides: Partial<StudioPropertyPanelViewInputs> = {}) {
  // Only the preview branch is mounted. Unmounted workspaces deliberately have
  // no records or actions, so rendering cannot quietly execute their work.
  const input = {
    threeStepWorkflow: true, step: 'preview', frozenStudioSpecRef: { current: null },
    socialContentTaskId: null, subtitleNotice: '', workbenchHasFormalVideo: false,
    replicationNeedsVoiceover: false, rendering: false, batchRenderingLangs: false,
    ttsLoading: false, subtitleSourceBlockReason: '', freeCanGenerateVoiceover: false,
    voiceoverAlignmentBlockReason: '', replicationTimingBlocked: false, renderPct: 0,
    startReplicationRender: unexpected, voice: 'v1', customVoices: [], replicationSpeechSpeed: 1.3,
    activeVoiceoverUrl: null, workbenchProductionPanel: null, subtitlesOn: false,
    effectPreset: 'natural', effectIntensity: 1, effectSoundsOn: false, ...overrides,
  } as StudioPropertyPanelViewInputs;
  return renderStudioPropertyPanel(input);
}
function renderButton(node: ReactNode) {
  const button = elements(node).find(item => item.onClick && item.children === '生成成片'
    || item.onClick && Array.isArray(item.children) && item.children.includes('生成成片'));
  assert.ok(button, 'preview must expose the existing generation button');
  return button;
}

test('pending subtitles, unmeasured audio, processing and unresolved timing keep generation disabled', () => {
  const blockers: Array<Partial<StudioPropertyPanelViewInputs>> = [
    { subtitleSourceBlockReason: '字幕尚未准备' }, { voiceoverAlignmentBlockReason: '当前配音缺少实测时间码，请先完成音频字幕对齐。' },
    { rendering: true }, { ttsLoading: true }, { replicationTimingBlocked: true },
  ];
  for (const blocker of blockers) {
    const view = preview(blocker);
    const button = elements(view).find(item => item.onClick === unexpected);
    assert.ok(button, 'generation must retain the supplied action');
    assert.equal(button.disabled, true, JSON.stringify(blocker));
    assert.doesNotThrow(() => renderToStaticMarkup(view));
  }
});

test('a ready preview delegates one generation action and retains a single collapsed effects region', () => {
  let calls = 0;
  const view = preview({ startReplicationRender: () => { calls++; } });
  const button = renderButton(view);
  assert.equal(button.disabled, false);
  assert.equal(calls, 0);
  button.onClick!();
  assert.equal(calls, 1);
  const html = renderToStaticMarkup(view);
  assert.equal((html.match(/<details\b/g) || []).length, 1);
  assert.match(html, /aria-label="调整效果"/);
  assert.doesNotMatch(html, /成片制作检查清单/);
});

test('music and delivery controls stay unmounted in creation settings', () => {
  assert.equal(renderStudioProductionPanel({ threeStepWorkflow: false, step: 'mode', scriptStageTab: 'theme' } as StudioProductionPanelViewInputs), null);
});

test('public and media previews use the same font resolver including its fallback', () => {
  assert.equal(publicFontCss, canonicalFontCss);
  assert.match(canonicalFontCss('mono'), /monospace/);
  assert.equal(canonicalFontCss('invalid' as Parameters<typeof canonicalFontCss>[0]), canonicalFontCss('sans'));
});
