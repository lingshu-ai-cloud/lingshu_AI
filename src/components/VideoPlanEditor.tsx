import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
import { bindMatrixVideo, type MatrixAccountPlan } from '../lib/weeklyMatrix';
import type { DigitalEmployeeConfig, PublishingPlatform } from '../lib/digitalEmployees';
import { VIDEO_LANGUAGES } from '../lib/videoLanguages';
import { defaultMixedScenes, normalizeVideoPlan, usesDigitalPresenter, VIDEO_PRESENTATIONS, VIDEO_ROUTES, videoPlanErrors, type VideoCreationPlan } from '../lib/videoCreationPlan';

type Options = {
  products: Array<{ id: string; name: string; materialIds: string[] }>;
  assets: Array<{ id: string; name: string }>;
  references: Array<{ id: string; name: string }>;
};

const field = 'ui-field mt-1 !min-h-9 !rounded-md !px-3 !py-2 !text-sm';
const selectField = `${field} ui-select`;
const fieldLabel = 'block text-xs font-bold text-text-secondary';
const secondaryButton = 'inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-border-bright hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

export default function VideoPlanEditor({ plans, config, platforms, matrixPlan, themeWorkflow = false, onChange }: { plans: VideoCreationPlan[]; config: DigitalEmployeeConfig; platforms: PublishingPlatform[]; matrixPlan?: MatrixAccountPlan[]; themeWorkflow?: boolean; onChange: (plans: VideoCreationPlan[]) => void }) {
  const [options, setOptions] = useState<Options>({ products: [], assets: [], references: [] });
  const [avatars, setAvatars] = useState<Array<{ id: string; name: string; gender?: string }>>([]);
  const [notice, setNotice] = useState('');
  const [languages, setLanguages] = useState<Array<{ code: string; label: string; available: boolean }>>([]);

  useEffect(() => {
    let live = true;
    fetch('/api/overseas/studio/tts/capabilities', { headers: authHeader() })
      .then(response => {
        if (!response.ok) throw Error('配音能力加载失败');
        return response.json();
      })
      .then(data => {
        if (live) setLanguages(data.languages || []);
      })
      .catch(error => {
        if (live) setNotice(error.message);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/api/overseas/digital-employees/planning-options', { headers: authHeader() })
      .then(async response => {
        if (!response.ok) throw Error('制作资料加载失败，请刷新后重试');
        return response.json();
      })
      .then(value => {
        if (live) setOptions(value);
      })
      .catch(error => {
        if (live) setNotice(error.message);
      });
    return () => {
      live = false;
    };
  }, []);

  const needAvatar = plans.some(usesDigitalPresenter);
  useEffect(() => {
    if (!needAvatar) return;
    let live = true;
    fetch('/api/overseas/studio/digital-human/avatars', { headers: authHeader() })
      .then(async response => {
        const value = await response.json();
        if (!response.ok) throw Error(value.error || 'HeyGen 人物加载失败');
        return value;
      })
      .then(value => {
        if (live) setAvatars(value.items || []);
      })
      .catch(error => {
        if (live) setNotice(error.message);
      });
    return () => {
      live = false;
    };
  }, [needAvatar]);

  const change = (index: number, patch: Partial<VideoCreationPlan>) => onChange(plans.map((plan, i) => i === index ? normalizeVideoPlan({ ...plan, ...patch }) : plan));
  return <section className="space-y-5 border-y border-border bg-surface py-4">
    <header className="border-b border-border pb-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">Production planning</p>
      <h3 className="mt-1 text-base font-bold text-text-primary">{themeWorkflow ? '逐条确认主题制作计划' : '逐条确认视频制作计划'}</h3>
      <p className="mt-1 text-xs leading-5 text-text-muted">{themeWorkflow ? '确定主题和成片要求即可；系统自动整理已有素材、提示待拍内容并匹配制作路径。' : '脚本来源与成片方式分别选择；批准后按此计划生成，缺少资料时暂停提示。'}</p>
    </header>

    {notice && <p role="alert" className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm text-amber">{notice}</p>}

    <div className="divide-y divide-border border-b border-border">
      {plans.map((plan, index) => <fieldset key={index} className="space-y-4 py-5 first:pt-0">
        <legend className="sr-only">第 {index + 1} 条视频计划</legend>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md border border-border bg-surface-2 text-xs font-bold text-accent">{index + 1}</span>
            <b className="text-sm text-text-primary">第 {index + 1} 条</b>
          </div>
          {plans.length > 1 && <button type="button" className="rounded-md px-2 py-1 text-xs font-bold text-text-muted transition hover:bg-surface-2 hover:text-text-primary" onClick={() => onChange(plans.filter((_, i) => i !== index))}>移除此条</button>}
        </div>

        <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
          {matrixPlan && <label className={`${fieldLabel} md:col-span-2`}>服务账号<select className={selectField} value={plan.matrix?.accountId || ''} onChange={event => onChange(plans.map((video, i) => i === index ? bindMatrixVideo(video, matrixPlan.find(row => row.accountId === event.target.value)) : video))}><option value="">仅制作，不发布</option>{matrixPlan.map(row => <option key={row.accountId} value={row.accountId}>{row.platform} · {config.publishingTargets.find(target => target.accountId === row.accountId)?.accountLabel || row.accountId}</option>)}</select>{plan.matrix?.accountId && <span className="mt-1 block font-normal text-text-muted">受众：{plan.matrix.audience} · 目标：{plan.matrix.objective} · 引导：{plan.matrix.cta}</span>}</label>}
          {themeWorkflow ? <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 md:col-span-2"><p className="text-xs font-bold text-blue-950">主题创作</p><p className="mt-1 text-xs leading-5 text-blue-700">系统按主题与素材自动匹配制作路径；历史计划仍沿用原有配置，不需要重新选择。</p></div> : <label className={fieldLabel}>
              脚本来源
              <select className={selectField} value={plan.route} onChange={event => change(index, { route: event.target.value as VideoCreationPlan['route'], materialIds: [], referenceId: '' })}>
                {Object.entries(VIDEO_ROUTES)
                  .filter(([route]) => config.enabledWorkflows.includes(({ clone: 'viral_clone', material: 'material_content', product: 'product_content' } as const)[route as keyof typeof VIDEO_ROUTES]))
                  .map(([route, label]) => <option key={route} value={route}>{label}</option>)}
              </select>
            </label>}
          <label className={fieldLabel}>
            产品
            <select className={selectField} value={plan.productName} disabled={Boolean(matrixPlan && plan.matrix?.accountId)} onChange={event => change(index, { productName: event.target.value, materialIds: [], scenePlan: plan.scenePlan?.map(scene => ({ ...scene, materialId: '' })) })}>
              <option value="">请选择产品</option>
              {options.products.map(product => <option key={product.id} value={product.name}>{product.name}</option>)}
            </select>
          </label>
          <label className={`${fieldLabel} md:col-span-2`}>
            本条主题 / 买家问题
            <input className={field} value={plan.theme} onChange={event => change(index, { theme: event.target.value })} />
          </label>
          <label className={fieldLabel}>
            语言
            <select className={selectField} value={plan.language} disabled={Boolean(matrixPlan && plan.matrix?.accountId)} onChange={event => change(index, { language: event.target.value })}>
              {Object.entries(VIDEO_LANGUAGES).map(([id, name]) => <option key={id} value={id} disabled={languages.some(item => item.code === id && !item.available)}>{name}{languages.some(item => item.code === id && !item.available) ? '（需配置配音服务）' : ''}</option>)}
            </select>
          </label>
          <label className={fieldLabel}>
            目标时长（秒）
            <input className={field} type="number" min={10} max={180} value={plan.duration} onChange={event => change(index, { duration: Number(event.target.value) })} />
          </label>
          <label className={fieldLabel}>
            制作平台
            <select className={selectField} value={plan.platform} disabled={Boolean(matrixPlan && plan.matrix?.accountId)} onChange={event => change(index, { platform: event.target.value as PublishingPlatform })}>
              {platforms.map(platform => <option key={platform}>{platform}</option>)}
            </select>
            {!platforms.includes(plan.platform) && <span className="mt-1 block text-xs font-medium text-amber">请重新选择本周范围内的平台</span>}
          </label>
          <label className={fieldLabel}>
            成片方式
            <select className={selectField} value={plan.presenter} onChange={event => change(index, { presenter: event.target.value as VideoCreationPlan['presenter'], scenePlan: event.target.value === 'heygen' ? plan.scenePlan || defaultMixedScenes() : undefined })}>
              {Object.entries(VIDEO_PRESENTATIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>

          <p className="border-l-2 border-border-bright bg-surface-2 px-3 py-2 text-xs leading-5 text-text-secondary md:col-span-2">
            {plan.presenter === 'avatar' ? themeWorkflow ? '全片数字人出镜，配完整口播与字幕；如主题需要素材参考，系统会在此提示补齐。' : '全片数字人出镜，配完整口播与字幕；从素材生成脚本时仍需选择参考素材。' : plan.presenter === 'heygen' ? '逐镜指定数字人或产品素材，沿用同一条配音和字幕；缺素材会暂停。' : '画面全部使用已授权素材，可配音及字幕，不调用数字人生成。'}
          </p>

          {plan.route === 'clone' && <label className={`${fieldLabel} md:col-span-2`}>
            {themeWorkflow ? '内容参考' : '爆款参考'}
            <select className={selectField} value={plan.referenceId} onChange={event => change(index, { referenceId: event.target.value })}>
              <option value="">{themeWorkflow ? '请选择已分析的参考内容' : '请选择已分析的参考视频'}</option>
              {options.references.map(reference => <option key={reference.id} value={reference.id}>{reference.name}</option>)}
            </select>
          </label>}

          <fieldset className="border-y border-border py-3 md:col-span-2">
            <legend className="px-1 text-xs font-bold text-text-secondary">{plan.presenter === 'avatar' ? '脚本参考素材' : '本条画面素材'}{plan.presenter !== 'avatar' && plan.route === 'product' ? '（可先生成脚本，缺画面时提示补充）' : ''}</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {(options.products.find(product => product.name === plan.productName)?.materialIds || []).map(id => <label key={id} className="inline-flex items-center gap-2 text-xs text-text-secondary">
                <input className="accent-accent" type="checkbox" checked={plan.materialIds.includes(id)} onChange={event => change(index, { materialIds: event.target.checked ? [...plan.materialIds, id] : plan.materialIds.filter(item => item !== id) })} />
                {options.assets.find(asset => asset.id === id)?.name || '已关联产品素材'}
              </label>)}
            </div>
            {!options.products.find(product => product.name === plan.productName)?.materialIds.length && <p className="mt-2 text-xs text-amber">{plan.presenter === 'avatar' && plan.route !== 'material' ? '此模式无需画面素材。' : '此产品暂无画面素材，请补充并选择所需素材。'}</p>}
          </fieldset>

          {usesDigitalPresenter(plan) && <>
            <label className={fieldLabel}>
              HeyGen 人物
              <select className={selectField} value={plan.heygenAvatarId} onChange={event => change(index, { heygenAvatarId: event.target.value, avatarConsent: false, voice: avatars.find(item => item.id === event.target.value)?.gender === 'male' ? 'v2' : 'v1' })}>
                <option value="">选择 HeyGen 人物</option>
                {avatars.map(avatar => <option key={avatar.id} value={avatar.id}>{avatar.name}</option>)}
              </select>
            </label>
            <label className={fieldLabel}>
              口播声音
              <select className={selectField} value={plan.voice} onChange={event => change(index, { voice: event.target.value })}>
                <option value="v1">女声 · Cherry</option>
                <option value="v2">男声 · Ethan</option>
              </select>
            </label>
            <label className="flex items-start gap-2 border-l-2 border-amber bg-amber-dim px-3 py-2 text-sm leading-6 text-amber md:col-span-2">
              <input className="mt-1 accent-accent" type="checkbox" checked={plan.avatarConsent} onChange={event => change(index, { avatarConsent: event.target.checked })} />
              我确认可使用所选人物，将本条口播音频提交 HeyGen 生成视频
            </label>
          </>}

          {plan.presenter === 'heygen' && <fieldset className="space-y-3 border-y border-border py-3 md:col-span-2">
            <legend className="px-1 text-xs font-bold text-text-secondary">分镜画面安排</legend>
            <p className="text-xs leading-5 text-text-muted">默认数字人开场和收尾，可逐镜修改；生成脚本按此镜头数量与来源编排。</p>
            <div className="divide-y divide-border border-y border-border">
              {(plan.scenePlan || defaultMixedScenes()).map((scene, sceneIndex) => <div key={sceneIndex} className="flex flex-wrap items-center gap-2 py-3">
                <span className="w-12 shrink-0 text-xs font-bold text-text-secondary">第 {sceneIndex + 1} 镜</span>
                <select aria-label={`第 ${index + 1} 条第 ${sceneIndex + 1} 镜画面来源`} className="ui-field ui-select !min-h-8 !w-auto !rounded-md !px-2 !py-1 !text-xs" value={scene.source} onChange={event => change(index, { scenePlan: (plan.scenePlan || defaultMixedScenes()).map((item, i) => i === sceneIndex ? { source: event.target.value as 'avatar' | 'material', materialId: '' } : item) })}>
                  <option value="avatar">数字人</option>
                  <option value="material">素材</option>
                </select>
                {scene.source === 'material' && <select aria-label={`第 ${index + 1} 条第 ${sceneIndex + 1} 镜素材`} className="ui-field ui-select !min-h-8 !min-w-0 !flex-1 !rounded-md !px-2 !py-1 !text-xs" value={scene.materialId} onChange={event => change(index, { scenePlan: (plan.scenePlan || defaultMixedScenes()).map((item, i) => i === sceneIndex ? { ...item, materialId: event.target.value } : item) })}>
                  <option value="">从已选素材按内容匹配</option>
                  {plan.materialIds.map(id => <option key={id} value={id}>{options.assets.find(asset => asset.id === id)?.name || id}</option>)}
                </select>}
                <button type="button" disabled={(plan.scenePlan || defaultMixedScenes()).length <= 3} onClick={() => change(index, { scenePlan: (plan.scenePlan || defaultMixedScenes()).filter((_, i) => i !== sceneIndex) })} className="rounded-md px-2 py-1 text-xs font-bold text-text-muted transition hover:bg-surface-2 hover:text-text-primary disabled:opacity-30">移除此镜</button>
              </div>)}
            </div>
            <button type="button" className={secondaryButton} disabled={(plan.scenePlan || defaultMixedScenes()).length >= 8} onClick={() => change(index, { scenePlan: [...(plan.scenePlan || defaultMixedScenes()), { source: 'material', materialId: '' }] })}>添加分镜</button>
          </fieldset>}
        </div>

        {plan.reviewRequirements?.map(requirement => (
          <article key={requirement.todoId} className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs leading-6 text-text-secondary">
            <p className="font-bold text-amber">来自复盘 · 第 1 镜 0–3 秒</p>
            <p><span className="font-bold text-text-primary">保留要求：</span>{requirement.requirements}</p>
            <p><span className="font-bold text-text-primary">素材要求：</span>{requirement.materials}</p>
            <p><span className="font-bold text-text-primary">验收条件：</span>{requirement.acceptance}</p>
            <p className="text-text-muted">参考：{requirement.reference}</p>
          </article>
        ))}

        {videoPlanErrors(plan).length > 0 && <p className="border-l-2 border-amber bg-amber-dim px-3 py-2 text-xs text-amber">{videoPlanErrors(plan).join('；')}</p>}
      </fieldset>)}
    </div>

    <button type="button" className={secondaryButton} disabled={plans.length >= 30} onClick={() => onChange([...plans, normalizeVideoPlan({ ...config.videoDefaults, route: plans[0]?.route || 'product', platform: platforms[0], productName: options.products[0]?.name })])}>添加视频计划</button>
  </section>;
}
