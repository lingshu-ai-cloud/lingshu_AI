


export const uniqueLangs = (primary: string, count: number) => {
  const base = [primary, 'en', 'es', 'ar', 'pt', 'id', 'fr', 'de'].filter(Boolean);
  return Array.from(new Set(base)).slice(0, Math.max(1, count));
};

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function publicScriptFailureReason(value: unknown): string {
  const message = String(value || '');
  if (/429|RESOURCE_EXHAUSTED|prepayment credits|quota|billing/i.test(message)) return '上游模型额度不足，未生成脚本。请更换模型 Key 或稍后重试。';
  if (/401|403|api.?key|unauthorized|permission/i.test(message)) return '上游模型授权暂不可用，未生成脚本。请检查模型 Key 或权限。';
  if (/timeout|timed out|超时|503|502|504|UNAVAILABLE/i.test(message)) return '上游模型暂时繁忙，未生成脚本。请稍后重试。';
  if (/\{\s*"?(?:error|code|message)"?|https?:\/\//i.test(message)) return '上游模型生成失败，未生成脚本。请补充素材/产品信息后重试。';
  return message || '模型生成失败，未生成脚本。';
}

export function publicVoiceFailureReason(value: unknown): string {
  const message = String(value || '').trim();
  if (/arrears|recharge|past due|overdue|欠费|充值/i.test(message)) return 'DashScope 语音服务账户欠费，暂时无法生成口播。请为该 API Key 所属阿里云账户充值，或改用“上传口播”。';
  if (/quota|insufficient|balance|credit|resource_exhausted|额度|余额/i.test(message)) return '语音服务额度或余额不足，暂时无法生成口播。请补充额度，或改用“上传口播”。';
  if (/401|403|unauthorized|forbidden|api.?key|permission|鉴权|权限/i.test(message)) return '语音服务鉴权失败，请检查 API Key 与模型权限，或改用“上传口播”。';
  return message || '语音服务暂时不可用，请稍后重试或改用“上传口播”。';
}
