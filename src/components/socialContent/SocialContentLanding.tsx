import { ArrowRight, Scissors, TrendingUp, type LucideIcon } from 'lucide-react';
import { Modal } from 'antd';
import type {
  SocialContentCreationPath,
  SocialContentMaterialInput,
} from '../../lib/socialContentModel';

export interface SocialContentLaunchOptions {
  creationPath: SocialContentCreationPath;
  materialInput: SocialContentMaterialInput;
  managedMode: 'one_click_managed';
}

interface CreationPathCard {
  id: SocialContentCreationPath;
  title: string;
  description: string;
  icon: LucideIcon;
  tint: string;
  iconTint: string;
}

const CREATION_PATHS: CreationPathCard[] = [
  {
    id: 'material_processing',
    title: '自由创作',
    description: '系统从“我的素材”和企业中心自动组织内容，你只需选择要宣传的产品。',
    icon: Scissors,
    tint: 'border-border bg-surface hover:border-accent hover:bg-surface-2',
    iconTint: 'text-accent',
  },
  {
    id: 'viral_replication',
    title: '爆款复刻',
    description: '沿用爆款口播与结构，仅替换企业、品牌和产品名称，再自动匹配制作。',
    icon: TrendingUp,
    tint: 'border-border bg-surface hover:border-accent hover:bg-surface-2',
    iconTint: 'text-accent',
  },
];

export default function SocialContentLanding({
  onStart,
  onSelectViralReplication,
  onClose = () => {},
}: {
  onStart: (options: SocialContentLaunchOptions) => void;
  onSelectViralReplication?: () => void;
  onClose?: () => void;
}) {
  return (
    <Modal open title="选择内容制作方式" onCancel={onClose} footer={null} width={640} centered>
        <p className="mb-5 text-sm leading-6 text-text-secondary">选择一种方式，进入逐句口播与画面制作台。</p>
        <div className="grid gap-3">
          {CREATION_PATHS.map(path => {
            const Icon = path.icon;
            return (
              <button
                key={path.id}
                type="button"
                onClick={() => {
                  if (path.id === 'viral_replication' && onSelectViralReplication) {
                    onSelectViralReplication();
                    return;
                  }
                  onStart({ creationPath: path.id, materialInput: path.id === 'viral_replication' ? 'ready' : 'none', managedMode: 'one_click_managed' });
                }}
                className={`group rounded-lg border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${path.tint}`}
              >
                <span className="flex items-start gap-4">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 ${path.iconTint}`}><Icon size={20} /></span>
                  <span className="min-w-0 flex-1">
                    <strong className="text-base font-semibold text-text-primary">{path.title}</strong>
                    <span className="mt-2 block text-xs leading-5 text-text-secondary">{path.description}</span>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent">进入制作 <ArrowRight size={14} /></span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
    </Modal>
  );
}
