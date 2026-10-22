import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { uploadProductEvidence } from '../../lib/enterpriseProductAssetUpload';
import { normalizeProductItems } from './enterpriseProfileNormalization';
import { mergeConfirmedProductDocuments, uploadEnterpriseProductDocuments } from './enterpriseProductDocumentUpload';
import type { ProductItem, Profile } from './enterpriseProfileTypes';

interface Options {
  products: ProductItem[];
  setProfile: Dispatch<SetStateAction<Profile>>;
  productImportConfirming: boolean;
  maxDocuments: number;
}

export function useEnterpriseProductDocuments({ products, setProfile, productImportConfirming, maxDocuments }: Options) {
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const inFlightRef = useRef(false);

  const addDocuments = async (index: number, files: FileList | null) => {
    if (!files?.length || inFlightRef.current) return;
    if (productImportConfirming) {
      setMessage('请等待产品导入确认完成后再上传资质凭证');
      return;
    }
    const product = products[index];
    if (!product) return;
    inFlightRef.current = true;
    setUploading(true);
    setMessage('');
    try {
      const result = await uploadEnterpriseProductDocuments(
        Array.from(files), product.documents?.length ?? 0, maxDocuments, uploadProductEvidence,
      );
      if (result.confirmed.length) {
        setProfile(prev => {
          const items = normalizeProductItems(prev.products);
          const current = items[index]?.documents ?? [];
          if (!items[index]) return prev;
          items[index] = { ...items[index], documents: mergeConfirmedProductDocuments(current, result.confirmed, maxDocuments) };
          return { ...prev, products: { ...prev.products, items } };
        });
      }
      if (result.unresolvedNames.length) {
        setMessage(`${result.unresolvedNames.length} 份资质凭证上传结果未确认，未加入产品资料。请先核对服务端资产，勿直接重复上传。`);
      } else if (result.skippedCount) {
        setMessage(`已达每个产品最多 ${maxDocuments} 份资质凭证；${result.skippedCount} 份文件未提交。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '资质凭证上传结果未确认，请先核对服务端资产');
    } finally {
      inFlightRef.current = false;
      setUploading(false);
    }
  };

  return { message, uploading, isUploading: () => inFlightRef.current, addDocuments };
}
