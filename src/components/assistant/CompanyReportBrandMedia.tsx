import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { LsMediaStateFrame, LsProgressiveMedia } from '../ui/LsExperiencePrimitives';
import { companyReportBrandMedia, type CompanyBrandMedia } from './companyReportBrandMediaCatalog';
import './companyReportBrandMedia.css';

function OfficialBrandPicture({ item, onFailure }: { item: CompanyBrandMedia; onFailure: (id: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  return <figure className="company-report-brand-media__item">
    <a href={item.originalImageUrl} target="_blank" rel="noopener noreferrer" aria-label={`查看${item.brand}官方产品原图`}>
      <LsMediaStateFrame state={loaded ? 'ready' : 'loading'} className="company-report-brand-media__image">
        <LsProgressiveMedia src={item.image} alt={`${item.brand}官方产品图片`} preview={false} loading="lazy" width="100%"
          height={210} style={{ objectFit: 'contain' }} onLoad={() => setLoaded(true)} onError={() => onFailure(item.id)}/>
      </LsMediaStateFrame>
    </a>
    <figcaption><strong>{item.brand}</strong><span>官方产品系列 / 品类图片</span>
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">官方来源<ArrowUpRight size={12} aria-hidden="true"/></a>
    </figcaption>
  </figure>;
}

export default function CompanyReportBrandMedia({ companyId, text }: { companyId: string; text: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const media = companyReportBrandMedia(companyId, text).filter(item => !failed.includes(item.id));
  if (!media.length) return null;
  return <aside className="company-report-brand-media" aria-label="官方品牌与产品图片">
    <div className="company-report-brand-media__grid">{media.map(item => <OfficialBrandPicture key={item.id} item={item}
      onFailure={id => setFailed(previous => previous.includes(id) ? previous : [...previous, id])}/>)}</div>
    <p className="company-report-brand-media__note">来源：{media[0].sourceName} · 读取于 {media[0].retrievedOn}。图片展示官方品牌或产品系列，不代表所述事件中的具体单品或报告期销量。{media[0].attribution}。</p>
  </aside>;
}
