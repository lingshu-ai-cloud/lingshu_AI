import type { AssistantCreationPortal } from '../../shared/contracts/assistantCreationPortal';
import type { CreateSocialContentTaskInput } from '../../shared/contracts/socialContentWorkflow';

export function assistantScenarioIntake(text: string): AssistantCreationPortal | null {
  if (/(?:取消|不要|先别|如何|怎么)/u.test(text)) return null;
  const scenario = /(?:查看|看看).{0,8}(?:本周|周发布).{0,8}日历/u.test(text) ? 'weekly_calendar'
    : /(?:为|一次).{0,8}活动.{0,8}(?:准备|内容)|为活动准备内容/u.test(text) ? 'campaign'
    : /(?:选定|先选|选择).{0,10}开场/u.test(text) ? 'hook_first'
    : /(?:创建|新建).{0,8}(?:一条|一个).{0,8}(?:创作计划|内容任务|创作任务)|创建一条新的创作计划/u.test(text) ? 'content_task' : null;
  if (!scenario) return null;
  return { kind: 'content_creation', id: `scene-${crypto.randomUUID()}`, scenario,
    title: scenario === 'campaign' ? '为活动准备内容' : scenario === 'hook_first' ? '选定一个开场' : scenario === 'content_task' ? '创建内容任务' : '查看本周发布日历',
    objective: text.slice(0, 1000), requestedOutputCount: scenario === 'campaign' ? null : 1,
    outputType: 'video', platforms: [], aspectRatio: null, targetDurationSeconds: null,
    sceneStep: scenario === 'hook_first' ? 'source' : 'brief' };
}

export function scenarioTaskInputs(portal: AssistantCreationPortal): Array<{ id: string; input: CreateSocialContentTaskInput }> {
  const products = portal.selectedProducts || [];
  if (!products.length) throw Error('请选择至少一款产品。');
  const parseDate = (value: string, future = true) => {
    const date = new Date(`${value}+08:00`);
    if (!Number.isFinite(date.getTime()) || (future && !portal.submissionLocked && date.getTime() <= Date.now())) throw Error('请选择有效的未来时间（北京时间）。');
    return date.toISOString();
  };
  let rows: Array<{id: string; title: string; publishAt: string}>;
  if (portal.scenario === 'hook_first') {
    const hook = portal.hook;
    if (!hook || hook.endSeconds <= hook.startSeconds || hook.endSeconds > hook.duration || !portal.direction?.trim()) throw Error('请确认有效开场片段和内容方向。');
    rows = [{ id: 'hook', title: `开场创作 · ${products.map(p => p.name).join('、')}`.slice(0,120), publishAt: portal.plannedPublishAt || '' }];
  } else if (portal.scenario === 'content_task') {
    if (!portal.direction?.trim()) throw Error('请填写本条内容的创作方向。');
    rows = [{id:'content',title:`内容创作 · ${products.map(p=>p.name).join('、')}`.slice(0,120),publishAt:portal.plannedPublishAt||''}];
  } else if (portal.scenario === 'campaign') {
    const campaign = portal.campaign;
    if (!campaign?.name.trim() || !campaign.objective.trim() || !campaign.type || !campaign.items.length) throw Error('请填写活动名称、类型、目标，并保留至少一条内容。');
    const start = parseDate(campaign.startsAt, false), end = parseDate(campaign.endsAt);
    if (end < start) throw Error('活动结束时间不能早于开始时间。');
    if (campaign.items.some(item => !item.title.trim()) || new Set(campaign.items.map(item => item.id)).size !== campaign.items.length) throw Error('请核对每条内容的主题和唯一标识。');
    rows = campaign.items.map(item => ({...item, title:`${campaign.name} · ${item.title}`.slice(0,120)}));
  } else throw Error('该场景不能创建内容任务。');
  return rows.map(row => {
    const requirements = JSON.stringify({ source: 'assistant_scene_confirmation', scenario: portal.scenario,
      groupId: portal.id, itemId: row.id, products, plannedPublishAt: parseDate(row.publishAt), timezone: 'Asia/Shanghai',
      ...(portal.scenario === 'campaign' ? { campaign: portal.campaign } : { hook: portal.hook, direction: portal.direction }) });
    if (requirements.length > 2000) throw Error('方案信息过多，请缩短方向描述或减少产品/内容数量。');
    return {id:row.id, input:{title:row.title, objective:portal.scenario === 'campaign' ? portal.campaign!.objective : portal.direction || portal.objective,
      mode:'instant', requestedOutputCount:1, themeId:'product_value', creationMode:'material_processing', managementMode:'one_click_managed',
      formats:['short_video'], ...(products.length === 1 ? {productId:products[0].id,productRef:products[0].name}:{}),
      specialRequirements:requirements }};
  });
}
