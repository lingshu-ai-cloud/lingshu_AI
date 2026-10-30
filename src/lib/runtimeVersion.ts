export function runtimeVersionMismatch(frontend: string, backend: string): boolean {
  return Boolean(frontend && backend && frontend !== 'unknown' && backend !== 'unknown' && frontend !== backend);
}

/** Reload only when the deployed frontend changed; refreshing cannot fix mixed server releases. */
export function frontendReloadAvailable(frontend: string, deployedFrontend: string): boolean {
  return runtimeVersionMismatch(frontend, deployedFrontend);
}
