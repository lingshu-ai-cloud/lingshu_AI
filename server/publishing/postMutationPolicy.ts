export function isDigitalEmployeePostStats(value: unknown): boolean {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) as unknown; }
    catch { return false; }
  }
  return Boolean(candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).source === 'digital_employee');
}
