import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { authHeader } from '../../lib/auth';
import type { FaqItem, FaqPack, Profile } from './enterpriseProfileTypes';

interface Options {
  profile: Profile;
  setProfile: Dispatch<SetStateAction<Profile>>;
  setSaveError: Dispatch<SetStateAction<string>>;
  pageSize: number;
}

interface FaqPackResponse {
  packs?: FaqPack[];
  recommendedIndustry?: string;
}

export function faqPackQuestions(selection: Record<string, string[]>, pack: FaqPack): string[] {
  return selection[pack.id] ?? pack.items.filter(item => item.ready && !item.exists).map(item => item.q);
}

export function toggleFaqPackSelection(selection: Record<string, string[]>, pack: FaqPack, question: string): Record<string, string[]> {
  const current = faqPackQuestions(selection, pack);
  const next = current.includes(question) ? current.filter(item => item !== question) : [...current, question];
  return { ...selection, [pack.id]: next };
}

export function useEnterpriseFaq({ profile, setProfile, setSaveError, pageSize }: Options) {
  const [faqPreview, setFaqPreview] = useState<FaqItem[]>([]);
  const [faqStructuring, setFaqStructuring] = useState(false);
  const [faqPacks, setFaqPacks] = useState<FaqPack[]>([]);
  const [recommendedPackIndustry, setRecommendedPackIndustry] = useState('general');
  const [faqPacksOpen, setFaqPacksOpen] = useState(false);
  const [openPackId, setOpenPackId] = useState('');
  const [selectedPackQuestions, setSelectedPackQuestions] = useState<Record<string, string[]>>({});
  const [packImporting, setPackImporting] = useState('');
  const [faqPage, setFaqPage] = useState(1);
  const faqItems = profile.faq ?? [];
  const visibleFaqs = faqItems.slice((faqPage - 1) * pageSize, faqPage * pageSize);

  useEffect(() => {
    setFaqPage(page => Math.min(page, Math.max(1, Math.ceil(faqItems.length / pageSize))));
  }, [faqItems.length, pageSize]);

  const acceptLoadedPacks = (packData: FaqPackResponse) => {
    const packs = Array.isArray(packData.packs) ? packData.packs : [];
    setFaqPacks(packs);
    setRecommendedPackIndustry(packData.recommendedIndustry || 'general');
    setOpenPackId(packs.find(pack => pack.industry === packData.recommendedIndustry)?.id || packs[0]?.id || '');
  };

  const addFaq = () => {
    setFaqPage(Math.max(1, Math.ceil((faqItems.length + 1) / pageSize)));
    setProfile(prev => ({ ...prev, faq: [...(prev.faq ?? []), { id: crypto.randomUUID(), question: '', answer: '', approvedForAuto: false }] }));
  };

  const updateFaq = (id: string, patch: Partial<FaqItem>) => {
    setProfile(prev => ({ ...prev, faq: (prev.faq ?? []).map(item => item.id === id ? { ...item, ...patch } : item) }));
  };

  const removeFaq = (id: string) => {
    setProfile(prev => ({ ...prev, faq: (prev.faq ?? []).filter(item => item.id !== id) }));
  };

  const structureLegacyFaq = async () => {
    const source = profile.customers?.commonQuestions?.trim();
    if (!source) return;
    setFaqStructuring(true);
    try {
      const result = await fetch('/api/overseas/enterprise/faq/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ text: source }),
      }).then(r => r.json());
      setFaqPreview(Array.isArray(result.items) ? result.items : []);
    } finally {
      setFaqStructuring(false);
    }
  };

  const importFaqPreview = () => {
    setFaqPage(Math.max(1, Math.ceil((faqItems.length + faqPreview.length) / pageSize)));
    setProfile(prev => ({ ...prev, faq: [...(prev.faq ?? []), ...faqPreview] }));
    setFaqPreview([]);
  };

  const reloadFaqPacks = async () => {
    const data = await fetch('/api/overseas/enterprise/faq/packs', { headers: authHeader() })
      .then(r => r.json()).catch(() => ({ packs: [], recommendedIndustry: 'general' }));
    const packs = Array.isArray(data.packs) ? data.packs : [];
    setFaqPacks(packs);
    setRecommendedPackIndustry(data.recommendedIndustry || 'general');
  };

  const selectedQuestionsForPack = (pack: FaqPack) => faqPackQuestions(selectedPackQuestions, pack);

  const togglePackQuestion = (pack: FaqPack, question: string) => {
    setSelectedPackQuestions(prev => toggleFaqPackSelection(prev, pack, question));
  };

  const importFaqPack = async (pack: FaqPack) => {
    setPackImporting(pack.id);
    setSaveError('');
    try {
      const response = await fetch('/api/overseas/enterprise/faq/packs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          industry: pack.industry,
          scenario: pack.scenario,
          questions: selectedQuestionsForPack(pack),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || '知识包导入失败');
      if (result.profile?.faq) {
        setFaqPage(Math.max(1, Math.ceil(result.profile.faq.length / pageSize)));
        setProfile(prev => ({ ...prev, faq: result.profile.faq }));
      }
      await reloadFaqPacks();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '知识包导入失败');
    } finally {
      setPackImporting('');
    }
  };

  return {
    faqPreview, setFaqPreview, faqStructuring, faqPacks, recommendedPackIndustry,
    faqPacksOpen, setFaqPacksOpen, openPackId, setOpenPackId, packImporting,
    faqPage, setFaqPage, faqItems, visibleFaqs, acceptLoadedPacks,
    addFaq, updateFaq, removeFaq, structureLegacyFaq, importFaqPreview,
    selectedQuestionsForPack, togglePackQuestion, importFaqPack,
  };
}
