import { Button, Modal } from 'antd';
import { Check, Sparkles, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SOCIAL_CONTENT_STAGE_PROFILES, type SocialContentStageId } from '../../lib/socialContentStage';

export default function SocialContentStageOnboarding({
  busy,
  initialValue,
  embedded = false,
  hideHeader = false,
  hideActions = false,
  eyebrow = '社媒经营阶段',
  submitLabel = '确认阶段并开始使用',
  error,
  onChange,
  onConfirm,
}: {
  busy?: boolean;
  initialValue?: SocialContentStageId;
  embedded?: boolean;
  hideHeader?: boolean;
  hideActions?: boolean;
  eyebrow?: string;
  submitLabel?: string;
  error?: string;
  onChange?: (id: SocialContentStageId) => void;
  onConfirm: (id: SocialContentStageId) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<SocialContentStageId | ''>(initialValue || '');
  useEffect(() => { setSelected(initialValue || ''); }, [initialValue]);

  const content = (
    <section aria-label="选择社媒经营阶段" className={embedded ? 'rounded-lg border border-border bg-white p-5 sm:p-6' : ''}>
        {!hideHeader && embedded && <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-glow text-accent"><Sparkles size={21} strokeWidth={2.4}/></span><div><p className="ls-type-body-small font-semibold text-accent">{eyebrow}</p><h2 className="ls-type-title-large mt-1 text-text-primary">选择当前的社媒经营阶段</h2></div></div>}
        <div className={!hideHeader && embedded ? 'mt-6' : ''}><div className="ui-choice-grid">{SOCIAL_CONTENT_STAGE_PROFILES.map((profile)=>{const active=selected===profile.id;return <button type="button" key={profile.id} aria-pressed={active} onClick={()=>{setSelected(profile.id);onChange?.(profile.id);}} className={`relative min-h-44 rounded-lg border p-4 text-left transition ${active?'border-accent bg-accent-glow':'border-border bg-white hover:border-border-bright'}`}>
          <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${active?'border-accent bg-accent text-white':'border-border-bright text-transparent'}`}><Check size={12}/></span>
          <TrendingUp size={18} className={active?'text-accent':'text-text-muted'}/><h3 className="mt-5 pr-5 text-base font-semibold text-text-primary">{profile.name}</h3><p className="mt-3 text-xs leading-5 text-text-secondary">{profile.description}</p>
        </button>})}</div>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{error}</p>}
        {!hideActions && <div className="mt-6 flex justify-end"><Button type="primary" loading={busy} disabled={!selected} onClick={()=>selected&&void onConfirm(selected)}>{submitLabel}</Button></div>}</div>
      </section>
  );

  return embedded ? content : <Modal open title="选择当前的社媒经营阶段" footer={null} maskClosable={false}>{content}</Modal>;
}
