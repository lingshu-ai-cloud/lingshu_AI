export function shotStart(time: string): number {
  const start = String(time || '').split(/[–—-]/)[0];
  const clock = start.match(/(\d+):(\d+(?:\.\d+)?)/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const match = start.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}
