/** PocketBase text fields serialize an empty value as '', never null.
 * Normalize before fingerprinting so a successful write passes strict CAS
 * verification. Do not relax comparisons for unknown or JSON fields. */
export function pocketBaseWriteData(
  collection: string, data: Record<string, unknown>,
): Record<string, unknown> {
  return collection === 'assistant_threads' && data.focusedTaskId === null
    ? { ...data, focusedTaskId: '' }
    : data;
}
