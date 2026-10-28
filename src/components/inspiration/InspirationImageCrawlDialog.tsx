import { Button, Form, Input, Modal, Select } from 'antd';
import type { InspirationImageCrawlPlatform } from '../../lib/inspirationImageCrawl';

interface InspirationImageCrawlDialogProps {
  open: boolean;
  busy: boolean;
  platform: InspirationImageCrawlPlatform;
  keyword: string;
  limit: number;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
  onPlatformChange: (value: InspirationImageCrawlPlatform) => void;
  onKeywordChange: (value: string) => void;
  onLimitChange: (value: number) => void;
}

export default function InspirationImageCrawlDialog({
  open, busy, platform, keyword, limit, error,
  onClose, onSubmit, onPlatformChange, onKeywordChange, onLimitChange,
}: InspirationImageCrawlDialogProps) {
  return (
    <Modal
      title="关键词补充采集"
      open={open}
      footer={null}
      width={560}
      closable={!busy}
      mask={{ closable: false }}
      onCancel={() => { if (!busy) onClose(); }}
      destroyOnHidden
    >
      <Form layout="vertical" onFinish={onSubmit} requiredMark={false}>
        <p className="mb-4 text-sm leading-6 text-text-secondary">用于补充对标账号库之外的单图线索；只保留一张静态图片及原帖配文，不采图组、轮播或 GIF。</p>
        <Form.Item label="平台">
          <Select value={platform} onChange={onPlatformChange} options={[
            { value: 'instagram', label: 'Instagram' },
            { value: 'linkedin', label: 'LinkedIn（仅授权账号采集）', disabled: true },
            { value: 'facebook', label: 'Facebook' },
            { value: 'tiktok', label: 'TikTok' },
            { value: 'youtube', label: 'YouTube 社区（暂无可核验单图）', disabled: true },
          ]} />
        </Form.Item>
        <Form.Item label="补充关键词" validateStatus={error ? 'error' : undefined} help={error || undefined}>
          <Input autoFocus allowClear value={keyword} onChange={event => onKeywordChange(event.target.value)} placeholder="例如：cosmetic packaging design" />
        </Form.Item>
        <Form.Item label="采集数量">
          <Select value={limit} onChange={onLimitChange} options={[
            { value: 6, label: '6 条' },
            { value: 12, label: '12 条' },
            { value: 20, label: '20 条' },
            { value: 30, label: '30 条' },
          ]} />
        </Form.Item>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button disabled={busy} onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit" loading={busy}>开始采集</Button>
        </div>
      </Form>
    </Modal>
  );
}
