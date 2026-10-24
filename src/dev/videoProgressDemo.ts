import type { AgentCalendarTask } from '../components/smartBusiness/AgentWeeklyCalendar';

type Status = AgentCalendarTask['status'];

const stages = ['benchmark_collection', 'script', 'video_generation', 'quality_check', 'user_approval'] as const;
const titles = ['新品趋势短片', '敏感肌洁面演示', '产品套组开箱', '原料溯源新闻', '采购询盘案例'];

function task(videoIndex: number, stageIndex: number, status: Status): AgentCalendarTask {
  const title = titles[videoIndex]!;
  return {
    id: `progress-demo-${videoIndex}-${stageIndex}`,
    deliverableGroup: `progress-demo-video-${videoIndex}`,
    executionStep: stages[stageIndex],
    date: '2026-10-22',
    time: '09:00',
    agent: stageIndex === 0 ? 'director' : stageIndex === 4 ? 'human' : 'content',
    title: `生产节点 · ${title}`,
    output: `${title}成片`,
    context: '仅用于本地进度条视觉验收，不写入数据库',
    minutes: 30,
    status,
    platform: 'Facebook',
    ...(status === 'blocked' ? {reason: '质量检查发现字幕安全区与品牌规范冲突，需要人工确认修订范围'} : {}),
  };
}

export const videoProgressDemoTasks: AgentCalendarTask[] = [
  ...stages.map((_, stageIndex) => task(0, stageIndex, 'planned')),
  ...stages.map((_, stageIndex) => task(1, stageIndex, stageIndex === 0 ? 'completed' : stageIndex === 1 ? 'active' : 'planned')),
  ...stages.map((_, stageIndex) => task(2, stageIndex, stageIndex < 2 ? 'completed' : stageIndex === 2 ? 'active' : 'planned')),
  ...stages.map((_, stageIndex) => task(3, stageIndex, stageIndex < 3 ? 'completed' : stageIndex === 3 ? 'blocked' : 'planned')),
  ...stages.map((_, stageIndex) => task(4, stageIndex, 'completed')),
];
