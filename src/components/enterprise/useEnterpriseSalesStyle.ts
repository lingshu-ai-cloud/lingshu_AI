import { useState, type Dispatch, type SetStateAction } from 'react';
import { authHeader } from '../../lib/auth';
import type { Profile, SalesStyleProfile } from './enterpriseProfileTypes';
import {
  deleteSalesStyleField as removeField,
  deleteTabooPhrases as removeTaboos,
  updateSalesStyleField as editField,
  updateTabooPhrases as editTaboos,
  type EditableSalesStyleField,
} from './enterpriseSalesStyleModel';

interface Options {
  setProfile: Dispatch<SetStateAction<Profile>>;
  defaultStyle: SalesStyleProfile;
}

export function useEnterpriseSalesStyle({ setProfile, defaultStyle }: Options) {
  const [styleDistilling, setStyleDistilling] = useState(false);
  const [styleMessage, setStyleMessage] = useState('');

  const updateSalesStyleField = (key: EditableSalesStyleField, value: string) => {
    setProfile(prev => ({
      ...prev,
      salesStyleProfile: editField(prev.salesStyleProfile ?? defaultStyle, key, value),
    }));
  };

  const deleteSalesStyleField = (key: EditableSalesStyleField) => {
    setProfile(prev => ({
      ...prev,
      salesStyleProfile: removeField(prev.salesStyleProfile ?? defaultStyle, key),
    }));
  };

  const updateTabooPhrases = (value: string) => {
    setProfile(prev => ({
      ...prev,
      salesStyleProfile: editTaboos(prev.salesStyleProfile ?? defaultStyle, value),
    }));
  };

  const deleteTabooPhrases = () => {
    setProfile(prev => ({
      ...prev,
      salesStyleProfile: removeTaboos(prev.salesStyleProfile ?? defaultStyle),
    }));
  };

  const distillSalesStyle = async () => {
    setStyleDistilling(true);
    setStyleMessage('');
    try {
      const resp = await fetch('/api/overseas/enterprise/style-profile/distill', {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.message || data.error || '学习失败');
      setProfile(prev => ({ ...prev, salesStyleProfile: data.salesStyleProfile ?? prev.salesStyleProfile }));
      setStyleMessage('销售风格档案已更新');
    } catch (error) {
      setStyleMessage(error instanceof Error ? error.message : '学习失败');
    } finally {
      setStyleDistilling(false);
    }
  };

  return {
    styleDistilling, styleMessage, updateSalesStyleField, deleteSalesStyleField,
    updateTabooPhrases, deleteTabooPhrases, distillSalesStyle,
  };
}
