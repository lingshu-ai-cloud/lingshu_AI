/** Replication production uses machine quality evidence; publication approval is separate. */
export function requiresContentHumanAcceptance(input: { requiresAcceptance: boolean; spec: Record<string, any> }): boolean {
  const spec = input.spec;
  const route = spec.automation?.route || spec.contentOrder?.route || spec.mode;
  if (route === 'clone' || spec.creationPath === 'viral_replication') return false;
  return input.requiresAcceptance || Boolean(spec.contentOrder?.videoPlan?.reviewRequirements?.length);
}
