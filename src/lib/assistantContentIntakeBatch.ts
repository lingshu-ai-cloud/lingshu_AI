/** Keep command identity even after an unknown network result; never replay completed products. */
export async function submitContentIntakeBatch<T>(input: {
  ids: string[]; keys: Map<string, string>; completed: Map<string, string>; isCurrent: () => boolean;
  create: (productId: string, key: string) => Promise<T>;
  taskId: (result: T) => string; onResult: (result: T) => void;
}) {
  for (const id of input.ids) {
    if (input.completed.has(id)) continue;
    if (!input.isCurrent()) return;
    const key = input.keys.get(id) || `assistant-intake-${crypto.randomUUID()}`;
    input.keys.set(id, key);
    const result = await input.create(id, key);
    if (!input.isCurrent()) return;
    input.completed.set(id, input.taskId(result)); input.onResult(result);
  }
}
