export type DiscoveryFailureKind = 'authentication' | 'quota' | 'input' | 'no_data' | 'network' | 'unknown';

export type DiscoveryFailurePresentation = {
  kind: DiscoveryFailureKind;
  label: string;
  action: string;
};

/** User-facing diagnosis only. The original provider text remains the audit source. */
export function discoveryFailurePresentation(value: unknown): DiscoveryFailurePresentation | null {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/(?:401|403|unauthori[sz]ed|forbidden|(?:invalid|missing|expired)[_ -]?(?:api[_ -]?)?key|(?:api[_ -]?key|access[_ -]?token).{0,24}(?:invalid|missing|expired|required|失败|无效|缺失|过期)|鉴权失败|认证失败|密钥无效|令牌失效)/i.test(text))
    return { kind: 'authentication', label: '平台鉴权失败', action: '检查对应平台的 API Key、访问令牌和账号权限。' };
  if (/(?:402|429|quota|rate[_ -]?limit|too many requests|额度不足|额度耗尽|配额|限流)/i.test(text))
    return { kind: 'quota', label: '平台额度或限流', action: '检查供应商额度与限流窗口，恢复后再重试。' };
  if (/(?:400|422|invalid[_ -](?:input|request|parameter)|validation|scope_invalid|参数错误|输入无效|采集范围无效|关键词为空)/i.test(text))
    return { kind: 'input', label: '采集输入不符合要求', action: '检查平台、关键词、账号地址、时间范围和已批准采集范围。' };
  if (/(?:ECONN|ENOTFOUND|ETIMEDOUT|network|fetch failed|socket|SSL|TLS|HTTP 5\d\d|网络|连接失败|连接中断|超时)/i.test(text))
    return { kind: 'network', label: '平台或网络连接失败', action: '检查网络、代理和平台服务状态后重试。' };
  if (/(?:no[_ -]?data|no_valid_results|zero results|暂无(?:符合条件的)?结果|未采集到可用内容|零结果|新增\s*0\s*条)/i.test(text))
    return { kind: 'no_data', label: '本轮没有合格结果', action: '扩大关键词或时间范围，并核对平台与目标市场。' };
  if (/(?:执行失败|采集失败|source_failed|未执行|stopped|error|failed)/i.test(text))
    return { kind: 'unknown', label: '采集失败，原因尚未归类', action: '查看下方原始结果，按具体平台错误处理后重试。' };
  return null;
}
