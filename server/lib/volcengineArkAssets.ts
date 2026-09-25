import { createHash, createHmac } from 'node:crypto';

type ArkAsset = { Id: string; AssetType: 'Image' | 'Video' | 'Audio'; Status: 'Active' | 'Processing' | 'Failed'; Error?: { Message?: string } };
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Read-only Ark Assets API client. It deliberately never creates or uploads real-person assets. */
export class VolcengineArkAssets {
  constructor(private readonly accessKey = process.env.VOLCENGINE_ACCESS_KEY_ID || '', private readonly secretKey = process.env.VOLCENGINE_SECRET_ACCESS_KEY || '', private readonly region = process.env.VOLCENGINE_ARK_ASSET_REGION || 'cn-beijing') {}
  configured() { return Boolean(this.accessKey && this.secretKey); }
  async findImage(projectName: string, groupId: string, assetId?: string) {
    if (!this.configured()) throw new Error('未配置 VOLCENGINE_ACCESS_KEY_ID 与 VOLCENGINE_SECRET_ACCESS_KEY，灵枢无法自动同步方舟认证结果');
    const body = JSON.stringify({ Filter: { GroupIds: [groupId], GroupType: 'LivenessFace', ...(assetId ? { AssetIds: [assetId] } : {}) }, MaxResults: 100, SortBy: 'UpdateTime', SortOrder: 'Desc', ProjectName: projectName });
    const host = `ark.${this.region}.volcengineapi.com`; const date = new Date(); const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); const day = stamp.slice(0, 8);
    const signedHeaders = 'content-type;host;x-content-sha256;x-date'; const payloadHash = hash(body);
    const canonical = `POST\n/\nAction=ListAssets&Version=2024-01-01\ncontent-type:application/json\nhost:${host}\nx-content-sha256:${payloadHash}\nx-date:${stamp}\n\n${signedHeaders}\n${payloadHash}`;
    const scope = `${day}/${this.region}/ark/request`; const stringToSign = `HMAC-SHA256\n${stamp}\n${scope}\n${hash(canonical)}`;
    const signingKey = hmac(hmac(hmac(hmac(`VOLC${this.secretKey}`, day), this.region), 'ark'), 'request'); const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const response = await fetch(`https://${host}/?Action=ListAssets&Version=2024-01-01`, { method: 'POST', headers: { 'content-type': 'application/json', host, 'x-date': stamp, 'x-content-sha256': payloadHash, authorization: `HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, body, signal: AbortSignal.timeout(15_000) });
    const json = await response.json() as { Result?: { Items?: ArkAsset[] }; ResponseMetadata?: { Error?: { Message?: string } } };
    if (!response.ok) throw new Error(json.ResponseMetadata?.Error?.Message || `方舟 Assets API 请求失败：HTTP ${response.status}`);
    return (json.Result?.Items || []).find(item => item.AssetType === 'Image' && (!assetId || item.Id === assetId));
  }
}
