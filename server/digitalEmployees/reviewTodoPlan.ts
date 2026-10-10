import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { ReviewTodo } from '../../src/lib/reviewTodos.js';
import { todoIssues } from '../../src/lib/reviewTodos.js';
export function applyReviewTodoPlan(original: WeeklyPackage, items: ReviewTodo[]): WeeklyPackage {
  const pack: WeeklyPackage = structuredClone(original);
  const replacing = new Set(items.map(i => i.id));
  const incoming = items;
  for (const task of pack.tasks) for (const video of task.videoPlans || []) video.reviewRequirements = video.reviewRequirements?.filter(r => !replacing.has(r.todoId));
  pack.reviewTodos = (pack.reviewTodos || []).filter(i => !replacing.has(i.id));
  const issues = incoming.flatMap(i => todoIssues(i));
  if (issues.length) throw Error(issues.join('；'));
  const videos = pack.tasks.find(t => t.templateId === 'production')?.videoPlans || [];
  for (const item of incoming.filter(i => i.kind === 'video')) {
    const indexes = item.videoIndexes.length ? item.videoIndexes : videos.map((_, i) => i).filter(i => !videos[i].reviewRequirements?.length).slice(0, item.quantity);
    if (indexes.length !== item.quantity || indexes.some(i => !videos[i])) throw Error(`${item.title}：目标中没有足够的可分配视频，请先补充视频计划或调整数量`);
    if (indexes.some(i => videos[i].reviewRequirements?.length)) throw Error(`${item.title}：选中的视频已有钩子要求，请合并要求或更换视频`);
    for (const index of indexes) videos[index].reviewRequirements = [{ todoId: item.id, reference: item.reference, scene: 1, startsAt: 0, endsAt: 3, requirements: item.requirements, materials: item.materials, acceptance: item.acceptance }];
  }
  pack.reviewTodos = [...(pack.reviewTodos || []), ...incoming];
  pack.revision += JSON.stringify({ ...pack, revision: 0 }) === JSON.stringify({ ...original, revision: 0 }) ? 0 : 1;
  return pack;
}

export function sameTodoRequirements(a: ReviewTodo, b: ReviewTodo): boolean {
  return ['id','title','kind','requirements','acceptance','materials','reference','quantity'].every(key => a[key as keyof ReviewTodo] === b[key as keyof ReviewTodo]) && JSON.stringify(a.videoIndexes) === JSON.stringify(b.videoIndexes);
}
