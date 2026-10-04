export function prepareOAuthPopup(name: string, features: string): Window | null {
  try {
    const popup = window.open('', `${name}-${Date.now()}`, features);
    if (!popup) return null;
    try {
      popup.document.title = '正在打开授权';
      if (popup.document.body) {
        popup.document.body.innerHTML = '<p style="font:14px system-ui;padding:24px;color:#475569">正在打开平台授权，请稍候…</p>';
      }
    } catch {
      // The popup itself is still usable even if its loading view cannot be styled.
    }
    return popup;
  } catch {
    return null;
  }
}

export async function readOAuthStartResponse(response: Response, platformLabel: string): Promise<{ url: string }> {
  const raw = await response.text();
  let data: { url?: string; error?: string } = {};
  try {
    data = raw ? JSON.parse(raw) as { url?: string; error?: string } : {};
  } catch {
    // The status code below still gives the user an actionable error.
  }
  if (!response.ok) {
    throw new Error(data.error || `${platformLabel} 授权服务暂时不可用（${response.status}）`);
  }
  if (!data.url) throw new Error(`${platformLabel} 授权地址生成失败，请刷新页面后重试。`);
  return { url: data.url };
}

export function navigateOAuthPopup(popup: Window | null, url: string): void {
  try {
    if (popup && !popup.closed) {
      popup.location.replace(url);
      popup.focus();
      return;
    }
  } catch {
    // Fall back to the current tab when the browser blocks popup navigation.
  }
  window.location.assign(url);
}

export function closeOAuthPopup(popup: Window | null): void {
  try {
    if (popup && !popup.closed) popup.close();
  } catch {
    // The popup may already be cross-origin or closed.
  }
}
