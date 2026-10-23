import { X, Plus, ChevronDown } from 'lucide-react';
import { LANGS } from './studioLanguageRules';
import type { StudioLanguageSwitcherViewInputs } from './studioLanguageSwitcherViewInputs.js';

export function renderStudioLanguageSwitcher(input: StudioLanguageSwitcherViewInputs) {
  const {
    voiceLangs, activeVoiceLang, voiceDraftFailedLangs,
    ttsFailuresByLang, workflowSourceLanguage, setActiveVoiceLang,
    setLang, removeTranslationLanguage, setShowLanguagePicker,
    showLanguagePicker, toggleTranslationLanguage,
  } = input;

  return (
    (
      <section className="space-y-2" aria-label="创作语言">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold text-text-muted">已选 {voiceLangs.length} 种 · 翻译语种可随时删除</p>
          {voiceLangs.length === 1 && <span className="text-[9px] font-bold text-emerald-700">仅生成原文</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {voiceLangs.map(code => {
            const selectedLanguage = activeVoiceLang === code;
            const failed = voiceDraftFailedLangs.includes(code) || Boolean(ttsFailuresByLang[code]);
            const isSource = code === workflowSourceLanguage;
            return (
              <div key={code} className={`flex items-center overflow-hidden rounded-lg border transition ${selectedLanguage ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : failed ? 'border-red-200 bg-red-50 text-red-600' : 'border-border bg-white text-text-secondary'}`}>
                <button type="button" onClick={() => { setActiveVoiceLang(code); setLang(code); }} className="px-2.5 py-1.5 text-[10px] font-bold hover:bg-black/[0.03]">
                  {LANGS.find(item => item.code === code)?.label || code}{isSource ? ' · 原文' : ''}
                </button>
                {!isSource && <button type="button" onClick={() => removeTranslationLanguage(code)} aria-label={`删除 ${LANGS.find(item => item.code === code)?.label || code}`} title="不再生成该语种" className="mr-1 flex h-5 w-5 items-center justify-center rounded-md hover:bg-black/10"><X size={10} /></button>}
              </div>
            );
          })}
          <button type="button" onClick={() => setShowLanguagePicker(value => !value)} className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[10px] font-bold text-text-muted hover:border-emerald-300 hover:text-emerald-700">
            {showLanguagePicker ? <ChevronDown size={11} className="mr-1 inline rotate-180" /> : <Plus size={11} className="mr-1 inline" />}
            {showLanguagePicker ? '收起语种库' : '添加翻译语种（可选）'}
          </button>
        </div>
        {showLanguagePicker && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2">
            <div className="flex items-start justify-between gap-2 px-1 pb-2">
              <p className="text-[10px] leading-4 text-text-muted">可多选，也可以不选择；原文语言会始终保留。</p>
              <button type="button" onClick={() => setShowLanguagePicker(false)} className="shrink-0 rounded-md px-2 py-1 text-[9px] font-bold text-text-secondary hover:bg-white">收起</button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {LANGS.filter(item => item.code !== workflowSourceLanguage).map(item => {
                const checked = voiceLangs.includes(item.code);
                return <label key={item.code} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[10px] font-bold ${checked ? 'bg-white text-text-primary shadow-none' : 'text-text-muted hover:bg-white/70'}`}><input type="checkbox" checked={checked} onChange={() => toggleTranslationLanguage(item.code)} className="accent-emerald-600" />{item.label}</label>;
              })}
            </div>
          </div>
        )}
      </section>
    )
  );
}
