import { Alert, Button, Checkbox, Empty, Input, Modal, Spin, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { authHeader } from '../../lib/auth';
import {
  PUBLISH_QUEUE_STORAGE_KEY,
  PUBLISH_QUEUE_UPDATED_EVENT,
  createPublishItems,
  mergePublishItems,
  publishStorageKey,
  readStoredPublishQueue,
  type PublishDraftItem,
  type PublishPlatform,
  type PublishQueueItem,
} from '../../lib/publishQueueState';

type BatchDraftItem = PublishDraftItem & {
  id: string;
  tags: string[];
  tagText: string;
  selected: boolean;
};

type BatchDraftResponse = {
  items?: Array<Omit<BatchDraftItem, 'selected' | 'tagText'>>;
  skipped?: Array<{ id: string; title: string; reason: string }>;
  error?: string;
};

export function parseEditableTags(value: string): string[] {
  return [...new Set(value
    .split(/[\s,，;；]+/)
    .map(tag => tag.replace(/^#+/, '').trim())
    .filter(Boolean))].slice(0, 20);
}

function platformCopy(item: BatchDraftItem) {
  const tags = parseEditableTags(item.tagText);
  if (item.platform === 'youtube') return { title: item.title, description: item.description, tags, hashtags: tags };
  if (item.platform === 'facebook') return { text: item.description, tags, hashtags: tags };
  return { caption: item.description, tags, hashtags: tags };
}

export function batchDraftToQueueItem(item: BatchDraftItem): PublishQueueItem | null {
  const queueItem = createPublishItems(item, [])[0];
  if (!queueItem) return null;
  const platform = (item.platform || 'youtube') as PublishPlatform;
  return {
    ...queueItem,
    selected: true,
    deliveryMode: 'flexible',
    status: 'ready',
    platformCopy: { [platform]: platformCopy(item) },
  };
}

export default function BatchPublishDraftDialog({ open, storageScope, onCancel, onSaved }: {
  open: boolean;
  storageScope: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<BatchDraftItem[]>([]);
  const [skipped, setSkipped] = useState<NonNullable<BatchDraftResponse['skipped']>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetch('/api/overseas/studio/library/publish-drafts', {
      headers: authHeader(),
      signal: controller.signal,
    }).then(async response => {
      const body = await response.json().catch(() => ({})) as BatchDraftResponse;
      if (!response.ok) throw new Error(body.error || '读取成片库失败');
      setItems((body.items || []).map(item => ({ ...item, tagText: item.tags.join(' '), selected: true })));
      setSkipped(body.skipped || []);
    }).catch(loadError => {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : '读取成片库失败');
      setItems([]);
      setSkipped([]);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open]);

  const selectedCount = useMemo(() => items.filter(item => item.selected).length, [items]);
  const allSelected = items.length > 0 && items.every(item => item.selected);
  const update = (id: string, patch: Partial<BatchDraftItem>) => setItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));

  const save = () => {
    if (!selectedCount) return;
    setSaving(true);
    setError('');
    try {
      const additions = items.filter(item => item.selected).map(batchDraftToQueueItem).filter((item): item is PublishQueueItem => Boolean(item));
      const merged = mergePublishItems(readStoredPublishQueue(storageScope), additions);
      localStorage.setItem(publishStorageKey(PUBLISH_QUEUE_STORAGE_KEY, storageScope), JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent(PUBLISH_QUEUE_UPDATED_EVENT, { detail: { storageScope } }));
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存待发布内容失败');
    } finally {
      setSaving(false);
    }
  };

  return <Modal
    title="新建发布内容"
    open={open}
    width={920}
    destroyOnHidden
    onCancel={() => { if (!saving) onCancel(); }}
    footer={[
      <Button key="cancel" onClick={onCancel} disabled={saving}>取消</Button>,
      <Button key="save" type="primary" loading={saving} disabled={loading || selectedCount === 0} onClick={save}>保存到待发布内容（{selectedCount}）</Button>,
    ]}
  >
    <div className="space-y-4">
      <Alert type="info" showIcon title="默认已选择全部可发布成片" description="文案和 Tag 来自对应生产任务，可在保存前逐条修改。保存后只进入待发布队列，不会立即发布到平台。"/>
      {error && (
        <Alert type="error" showIcon title={error}/>
      )}
      {loading ? <div className="flex min-h-48 items-center justify-center"><Spin tip="正在读取成片库"/></div> : items.length ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <Checkbox checked={allSelected} indeterminate={selectedCount > 0 && !allSelected} onChange={event => setItems(previous => previous.map(item => ({ ...item, selected: event.target.checked })))}>全选可发布成片</Checkbox>
          <span className="text-xs text-text-secondary">已选择 {selectedCount} / {items.length} 条</span>
        </div>
        <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
          {items.map(item => <article key={item.id} className={`rounded-lg border p-4 ${item.selected ? 'border-accent bg-surface' : 'border-border bg-surface-2'}`}>
            <div className="flex items-start gap-3">
              <Checkbox aria-label={`选择 ${item.title}`} checked={item.selected} onChange={event => update(item.id, { selected: event.target.checked })}/>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-text-primary">{item.title || '未命名成片'}</strong><Tag>{item.platform || 'youtube'}</Tag><Tag>{item.ratio || '9:16'}</Tag></div>
                <label className="block text-xs font-medium text-text-secondary">发布文案<Input.TextArea className="mt-1" autoSize={{ minRows: 2, maxRows: 5 }} value={item.description} disabled={!item.selected} onChange={event => update(item.id, { description: event.target.value })}/></label>
                <label className="block text-xs font-medium text-text-secondary">Tag（空格或逗号分隔）<Input className="mt-1" value={item.tagText} disabled={!item.selected} onChange={event => update(item.id, { tagText: event.target.value })}/></label>
              </div>
            </div>
          </article>)}
        </div>
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="成片库中暂时没有可加入发布队列的成片"/>}
      {skipped.length > 0 && <details className="rounded-lg border border-border bg-surface-2 p-3"><summary className="cursor-pointer text-sm text-text-secondary">另有 {skipped.length} 条未加入（查看原因）</summary><ul className="mt-2 space-y-1 text-xs text-text-muted">{skipped.map(item => <li key={item.id}>{item.title || '未命名成片'}：{item.reason}</li>)}</ul></details>}
    </div>
  </Modal>;
}
