export interface OAuthCredentialPair {
  label: string;
  clientId: string;
  clientSecret: string;
  savedClientId: string;
  savedSecret: boolean;
}

/** Prevent an OAuth application ID from being saved with another app's secret. */
export function validateOAuthCredentialPairs(pairs: OAuthCredentialPair[]): string | null {
  for (const pair of pairs) {
    const clientId = pair.clientId.trim();
    const clientSecret = pair.clientSecret.trim();
    const savedClientId = pair.savedClientId.trim();
    if (savedClientId && !clientId) return `${pair.label} 的应用 ID 不能在此清空；请使用“清除配置”。`;
    if (clientSecret && !clientId) return `请先填写 ${pair.label} 的应用 ID。`;
    if (clientId && (!pair.savedSecret || clientId !== savedClientId) && !clientSecret) {
      return `${pair.label} 的应用 ID 已填写或更改，请同时填写对应的新 Secret。`;
    }
  }
  return null;
}
