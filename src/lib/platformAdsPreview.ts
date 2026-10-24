/** Real local advertising integration must never silently include demo spend. */
export function isPlatformAdsDemoEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_PLATFORM_ADS_DEMO_MODE === 'true';
}
