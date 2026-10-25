import { SocialContentRequestError } from './socialContentApi';
import { submitContentIntakeBatch } from './assistantContentIntakeBatch';
import { socialPlanningTaskInput, socialPlanningOperationKey, type SocialPlanningTaskSeed } from './socialContentPlanningTask';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';

/** Existing instant tasks are single-content. Batch only their draft creation, never generation. */
export async function createPlanningDraftBatch(input: {
  seed: SocialPlanningTaskSeed; count: number; isCurrent: () => boolean;
  keys: Map<string, string>; completed: Map<string, string>;
  create: (value: ReturnType<typeof socialPlanningTaskInput>, key: string) => Promise<SocialContentTaskDetail>;
  read: (taskId: string) => Promise<SocialContentTaskDetail>;
  onResult: (task: SocialContentTaskDetail) => void;
}): Promise<SocialContentTaskDetail | null> {
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 100) throw Error('请确认要创建的内容数量（1至100条）。');
  const operation = socialPlanningOperationKey(input.seed);
  const ids = Array.from({ length: input.count }, (_, index) => `${operation}:item:${index + 1}`);
  for (const id of ids) if (!input.keys.has(id)) input.keys.set(id, `${id}:create`);
  try {
    await submitContentIntakeBatch({ ids, keys: input.keys, completed: input.completed, isCurrent: input.isCurrent,
      create: async id => {
        const ordinal = ids.indexOf(id) + 1;
        return input.create(socialPlanningTaskInput({ ...input.seed, requestedOutputCount: 1,
          title: input.count === 1 ? input.seed.title : `${input.seed.title.slice(0, 100)} · ${ordinal}/${input.count}` }), input.keys.get(id)!);
      }, taskId: task => task.taskId, onResult: input.onResult });
  } catch (error) {
    const confirmed = ids.filter(id => input.completed.has(id)).length;
    const outcome = error instanceof SocialContentRequestError && error.status >= 400 && error.status < 500 ? '其余草稿提交被拒绝，请核对输入或权限。' : '其余提交结果尚未确认。';
    throw Error(`本轮已确认保存${confirmed}/${input.count}条内容草稿，${outcome}已保留请求身份，再次提交会续接原请求，不重复创建已确认的草稿。`);
  }
  if (!input.isCurrent()) return null;
  const first = input.completed.get(ids[0]);
  if (!first) throw Error('本轮未取得内容草稿回执，尚未进入视频生成。');
  return input.read(first);
}
