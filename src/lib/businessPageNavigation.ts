export type BusinessPageScope = 'traffic' | 'inquiry' | 'crm';
const key = 'lingshu:business-page-context';
export function saveBusinessPageContext(target: 'home' | 'production', scope: BusinessPageScope) {
  try { sessionStorage.setItem(key, JSON.stringify({ target, scope, at: Date.now() })); } catch { /* Navigation still works without storage. */ }
}
export function consumeBusinessPageContext(target: 'home' | 'production'): BusinessPageScope | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (value?.target !== target) return null;
    sessionStorage.removeItem(key);
    return Date.now() - value.at < 300000 && ['traffic', 'inquiry', 'crm'].includes(value.scope) ? value.scope : null;
  } catch { return null; }
}
