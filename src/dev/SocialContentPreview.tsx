import { useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, Loader2 } from 'lucide-react';
import SocialContentLanding, { type SocialContentLaunchOptions } from '../components/socialContent/SocialContentLanding';
import SocialCreationWorkbench, { type SocialCreationWorkbenchSubmit } from '../components/socialContent/SocialCreationWorkbench';
import SocialContentStageOnboarding from '../components/socialContent/SocialContentStageOnboarding';
import { loadSocialContentStage, readSocialContentStage, saveSocialContentStage, type SocialContentStageProfile } from '../lib/socialContentStage';

export default function SocialContentPreview() {
  const cachedStage = readSocialContentStage();
  // The dedicated preview always starts from the first-use experience so the
  // onboarding can be reviewed repeatedly. The production page opens it once.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [stageOnboardingOpen, setStageOnboardingOpen] = useState(true);
  const [stageProfile, setStageProfile] = useState<SocialContentStageProfile | null>(cachedStage);
  const [stageSaving, setStageSaving] = useState(false);
  const [launch, setLaunch] = useState<SocialContentLaunchOptions | null>(null);
  const [submitted, setSubmitted] = useState<SocialCreationWorkbenchSubmit | null>(null);

  useEffect(() => {
    let active = true;
    void loadSocialContentStage().then(profile => {
      if (!active) return;
      setStageProfile(profile);
    });
    return () => { active = false; };
  }, []);

  if (submitted) {
    return (
      <main className="min-h-screen bg-[#f6f8f5] p-6">
        <header className="mx-auto flex max-w-5xl items-center justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-accent">内容制作</p><h1 className="mt-1 text-xl font-black text-text-primary">我的创作</h1></div><button type="button" onClick={() => { setSubmitted(null); setChooserOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-[#173d31] px-4 py-2.5 text-xs font-black text-white"><ImagePlus size={15} />新建内容</button></header>
        <section className="mx-auto mt-6 max-w-5xl rounded-2xl border border-border bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Loader2 size={18} className="animate-spin" /></span><div><p className="text-sm font-black text-text-primary">{submitted.title}</p><p className="mt-1 text-xs text-text-muted">已进入生成队列 · 正在解析口播与画面</p><div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-emerald-700"><CheckCircle2 size={13} />输入已确认</div></div></div></section>
      </main>
    );
  }

  return (
    <div className="h-screen min-h-0 bg-[#f6f8f5]">
      {launch ? <SocialCreationWorkbench mode={launch.creationPath} stageProfile={stageProfile || undefined} seed={launch.creationPath === 'viral_replication' ? { referenceTitle: '爆款参考视频' } : undefined} onOpenChooser={() => setChooserOpen(true)} onShowCreations={() => setSubmitted({ requestId: Date.now(), creationPath: launch.creationPath, title: '我的创作', productId: '', productName: '', files: [], referenceLinks: [], callToAction: '', specialRequirements: '', stageProfileId: stageProfile?.id || 'b2b_launch', stageLabel: stageProfile?.name || 'B2B 起步验证', strategyPresetId: stageProfile?.presetId || 'b2b_starting' })} onGenerate={setSubmitted} /> : <div className="flex h-full items-center justify-center text-sm text-text-muted">请选择一种制作方式</div>}
      {chooserOpen && <SocialContentLanding onStart={options => { setLaunch(options); setChooserOpen(false); }} onClose={() => setChooserOpen(false)} />}
      {stageOnboardingOpen && <SocialContentStageOnboarding busy={stageSaving} onConfirm={async id => { setStageSaving(true); const saved=await saveSocialContentStage(id); setStageProfile(saved.profile); setStageOnboardingOpen(false); setChooserOpen(true); setStageSaving(false); }} />}
    </div>
  );
}
