import { authHeader } from './auth';

export interface UploadedProductAsset {
  name: string;
  type: string;
  size: number;
  updatedAt: string;
  url?: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadProductEvidence(file: File): Promise<UploadedProductAsset> {
  const response = await fetch('/api/overseas/enterprise/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ name: file.name, type: file.type, dataUrl: await fileToDataUrl(file) }),
  });
  if (!response.ok) throw new Error('asset upload failed');
  return response.json();
}

export async function importProductEvidenceUrl(url: string, name: string): Promise<UploadedProductAsset> {
  const response = await fetch('/api/overseas/enterprise/assets/import-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ url, name }),
  });
  const result = await response.json().catch(() => ({})) as Partial<UploadedProductAsset> & { error?: string; message?: string };
  if (!response.ok || !result.url) throw new Error(result.message || result.error || '外链图片转存失败');
  return result as UploadedProductAsset;
}
