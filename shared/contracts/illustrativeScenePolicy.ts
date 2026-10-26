/** Explicit scene selection only; no regex parsing of natural-language approval. */
export function parseIllustrativeSceneIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(id))
    || new Set(value).size !== value.length) throw Error('social_illustrative_scene_ids_invalid');
  return [...value];
}
