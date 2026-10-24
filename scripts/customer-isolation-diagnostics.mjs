// Fixed labels only. Never retain target URLs, hostnames, credentials or stacks.
export function customerIsolationDiagnostic(input, stack = '') {
 let host = '';
 try {
  const value = typeof input === 'string' || input instanceof URL ? new URL(input) : input;
  host = String(value?.hostname || value?.host || '').toLowerCase();
 } catch { /* malformed targets remain unknown */ }
 const matches = (domain) => host === domain || host.endsWith('.' + domain);
 const targetClass = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) ? 'unowned_loopback'
  : ['facebook.com','instagram.com','whatsapp.com','weixin.qq.com'].some(matches) ? 'customer_channel'
  : ['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','generativelanguage.googleapis.com','api.openai.com'].some(matches) ? 'ai_provider'
  : host.endsWith('.invalid') ? 'reserved_test_target' : host ? 'other_external' : 'unknown';
 const purpose = stack.includes('runCustomerIsolationSelfCheck') ? 'isolation_self_check'
  : /(?:pbStore|pocketbase|postgres)\.[cm]?[jt]s/i.test(stack) ? 'data_store'
  : /(?:translation|plugins)\.[cm]?[jt]s/i.test(stack) ? 'translation'
  : /(?:contextTags|classifyContextTags)\.[cm]?[jt]s/i.test(stack) ? 'customer_tag_analysis'
  : /(?:messenger|instagram|whatsapp)\//i.test(stack) ? 'customer_channel_adapter'
  : /networkEnvironment\.[cm]?[jt]s/i.test(stack) ? 'startup_network_probe'
  : 'unattributed';
 return {targetClass, purpose};
}
