import { getToken } from './auth';
import type {
  StartupCompanyDocument,
  StartupCompanyDocumentCategory,
  StartupCompanyProfile,
  StartupHubCreateInput,
  StartupHubRecordKind,
  StartupHubRecordMap,
  StartupHubSnapshot,
  StartupLeadChatImport,
} from '../../shared/startupHub';

const BASE = '/api/overseas/startup-hub';

function authHeaders(preview: boolean): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(preview ? { 'x-startup-hub-preview': 'local-preview' } : {}),
  };
}

async function request<T>(path: string, init: RequestInit, preview: boolean): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(preview),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message || `创业中台请求失败（${response.status}）`);
  return payload as T;
}

export function createStartupHubApi(preview = false) {
  return {
    async snapshot(): Promise<StartupHubSnapshot> {
      const result = await request<{ snapshot: StartupHubSnapshot }>('/snapshot', { method: 'GET' }, preview);
      return result.snapshot;
    },
    async updateCompany(input: Omit<StartupCompanyProfile, 'updatedAt' | 'updatedBy'>): Promise<StartupCompanyProfile> {
      const result = await request<{ company: StartupCompanyProfile }>('/company', { method: 'PUT', body: JSON.stringify(input) }, preview);
      return result.company;
    },
    async create<K extends StartupHubRecordKind>(kind: K, input: StartupHubCreateInput<K>): Promise<StartupHubRecordMap[K]> {
      const result = await request<{ record: StartupHubRecordMap[K] }>(`/${kind}`, { method: 'POST', body: JSON.stringify(input) }, preview);
      return result.record;
    },
    async update<K extends StartupHubRecordKind>(kind: K, id: string, patch: Partial<StartupHubCreateInput<K>>): Promise<StartupHubRecordMap[K]> {
      const result = await request<{ record: StartupHubRecordMap[K] }>(`/${kind}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, preview);
      return result.record;
    },
    async acknowledgeAnnouncement(id: string): Promise<StartupHubRecordMap['announcements']> {
      const result = await request<{ record: StartupHubRecordMap['announcements'] }>(`/announcements/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' }, preview);
      return result.record;
    },
    async uploadDocument(file: File, metadata: { category: StartupCompanyDocumentCategory; expiryDate?: string }): Promise<StartupCompanyDocument> {
      if (!file.size) throw new Error('文件内容为空');
      if (file.size > 20 * 1024 * 1024) throw new Error('单个文件不能超过 20 MB');
      const query = new URLSearchParams({
        name: file.name,
        category: metadata.category,
        mimeType: file.type || 'application/octet-stream',
        ...(metadata.expiryDate ? { expiryDate: metadata.expiryDate } : {}),
      });
      const response = await fetch(`${BASE}/documents/file?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(preview) },
        body: file,
      });
      const payload = await response.json().catch(() => ({})) as { document?: StartupCompanyDocument; message?: string };
      if (!response.ok || !payload.document) throw new Error(payload.message || `文件上传失败（${response.status}）`);
      return payload.document;
    },
    async downloadDocument(document: StartupCompanyDocument): Promise<void> {
      const response = await fetch(`${BASE}/documents/${encodeURIComponent(document.id)}/content`, { headers: authHeaders(preview) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message || `文件下载失败（${response.status}）`);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async loadDocumentBlob(document: StartupCompanyDocument): Promise<Blob> {
      const response = await fetch(`${BASE}/documents/${encodeURIComponent(document.id)}/content`, { headers: authHeaders(preview) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message || `文件预览加载失败（${response.status}）`);
      }
      return response.blob();
    },
    async deleteDocument(id: string): Promise<void> {
      const response = await fetch(`${BASE}/documents/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(preview) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message || `文件删除失败（${response.status}）`);
      }
    },
    async uploadLeadChat(file: File, leadId: string): Promise<StartupLeadChatImport> {
      if (!file.size) throw new Error('聊天记录文件为空');
      if (file.size > 10 * 1024 * 1024) throw new Error('聊天记录文件不能超过 10 MB');
      if (!/\.(txt|csv|json)$/i.test(file.name)) throw new Error('仅支持 TXT、CSV 或 JSON 格式');
      const query = new URLSearchParams({ name: file.name, leadId, mimeType: file.type || 'application/octet-stream' });
      const response = await fetch(`${BASE}/lead-chats/file?${query.toString()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(preview) }, body: file,
      });
      const payload = await response.json().catch(() => ({})) as { chatImport?: StartupLeadChatImport; message?: string };
      if (!response.ok || !payload.chatImport) throw new Error(payload.message || `聊天记录导入失败（${response.status}）`);
      return payload.chatImport;
    },
    async downloadLeadChat(chatImport: StartupLeadChatImport): Promise<void> {
      const response = await fetch(`${BASE}/lead-chats/${encodeURIComponent(chatImport.id)}/content`, { headers: authHeaders(preview) });
      if (!response.ok) throw new Error(`聊天记录下载失败（${response.status}）`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = chatImport.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async deleteLeadChat(id: string): Promise<void> {
      const response = await fetch(`${BASE}/lead-chats/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(preview) });
      if (!response.ok) throw new Error(`聊天记录删除失败（${response.status}）`);
    },
  };
}
