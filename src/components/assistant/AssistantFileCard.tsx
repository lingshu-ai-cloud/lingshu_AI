import { useEffect, useState } from 'react';
import { Alert, Button } from 'antd';
import { downloadAssistantFile, readAssistantFile, type AssistantFile } from '../../lib/assistantFilesApi';

export default function AssistantFileCard({ id }: { id: string }) {
  const [file, setFile] = useState<AssistantFile | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setFile(null); setError('');
    void readAssistantFile(id, controller.signal).then(value => { if (!controller.signal.aborted) setFile(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || '文件读取失败'); });
    return () => controller.abort();
  }, [id]);
  return <div className="my-3 space-y-2 rounded-lg border border-border bg-surface p-3" aria-label="生成的文件">
    {error && <Alert type="error" title={error} showIcon />}
    {file ? <><p className="break-words font-semibold">{file.name}</p><p className="text-xs text-text-muted">{file.mimeType === 'application/pdf' ? 'PDF 文档' : 'JPG 图片'} · {Math.ceil(file.size / 1024)} KB</p>
      <Button loading={busy} onClick={async () => { setBusy(true); setError(''); try { await downloadAssistantFile(file); } catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败'); } finally { setBusy(false); } }}>下载文件</Button></> : !error && <p role="status">正在读取文件…</p>}
  </div>;
}
