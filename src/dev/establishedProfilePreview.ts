import { agentCalendarEstablishedDemo } from './agentCalendarEstablishedDemo';

/** UI-only mother-content allocation; never updates a persisted source policy. */
export function establishedProfilePreviewTasks(ownedPercent: 20 | 40) {
  return agentCalendarEstablishedDemo.map(task => {
    const text = (value: string) => {
      let result = value.replaceAll('真实', '示例').replaceAll('生产实况', '生产流程示例');
      if (ownedPercent === 20) result = result
        .replaceAll('增长停滞诊断', '历史素材与互动证据缺口诊断')
        .replaceAll('自有 40% / 外部 60%', '自有 20% / 外部 80%')
        .replaceAll('40/60', '20/80').replaceAll('外部 60%', '外部 80%')
        .replaceAll('两条自有参考', '一条自有参考').replaceAll('三条外部参考', '四条外部参考')
        .replaceAll('2 条自有迭代 + 3 条外部探索', '1 条自有迭代 + 4 条外部探索')
        .replaceAll('自有高表现视频 A/B', '自有候选视频 A')
        .replaceAll('自有迭代 A/B', '自有迭代 A').replaceAll('外部增量参考 C/D/E', '外部增量参考 B/C/D/E')
        .replaceAll('外部探索 C/D/E', '外部探索 B/C/D/E')
        .replaceAll('2 条母版', '1 条母版').replaceAll('3 条母版', '4 条母版');
      return result;
    };
    const workloadFactor = ownedPercent===20 ? ['h-task-1','h-task-8','h-task-12','h-task-13'].includes(task.id) ? 0.5 : ['h-task-4','h-task-9','h-task-16','h-task-28'].includes(task.id) ? 4/3 : 1 : 1;
    return {...task, minutes:task.minutes===null?null:Math.round(task.minutes*workloadFactor), dependsOn: [...(task.dependsOn ?? [])], title:text(task.title), output:text(task.output), context:text(task.context),
      ...(ownedPercent===20&&task.id==='h-task-0'?{context:'历史素材或播放、赞转评证据较少：保留 1 个自有槽位，探索 4 个外部方向；缺少证据不填零、不自动改配额'}:{})};
  });
}
