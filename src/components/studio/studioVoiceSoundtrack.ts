import { fileToDataUrl } from '../../lib/studioFileInputs';
import { useEffect, useRef, useState } from 'react';
import { studioApi } from '../../lib/studioApi';
import { type EffectIntensity, type EffectPresetId } from '../../../shared/contracts/effectPlan';
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer';
import { BGMS } from './studioWorkspaceCatalog.js';
import { materialVersionKey } from './studioMaterialPresentation.js';
import type { Bgm } from './studioWorkspaceContracts.js';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function createStudioSoundtrackActions(ports: Pick<StudioVoiceLifecyclePorts,
  | "setBgms"
  | "audioRef"
  | "playingBgm"
  | "setPlayingBgm"
  | "setFavoriteBgms"
  | "setBgmUploading"
  | "setBgmNotice"
  | "setBgm"
  | "setAssemblyBgms"
  | "activeAssemblyId"
  | "setMaterialVersionBgms"
  | "activeVoiceLang"
  | "setRendered"
  | "setRenderOutputPath"
  | "setRenderOutputPreviewUrl"
  | "setLanguageRenderOutputs"
>) {

  const refreshBgm = async () => {
    const {
      setBgms,
    } = ports;

    const list = await studioApi.listBgm();
    setBgms(list as Bgm[]);
  };

  const togglePlay = (track: Bgm) => {
    const {
      audioRef, playingBgm, setPlayingBgm,
    } = ports;

    if (!track.url) return;
    const el = audioRef.current;
    if (!el) return;
    if (playingBgm === track.id) {
      el.pause();
      setPlayingBgm(null);
      return;
    }
    el.src = track.url;
    void el.play().then(() => setPlayingBgm(track.id)).catch(() => setPlayingBgm(null));
  };

  const toggleFavoriteBgm = (id: string) => {
    const {
      setFavoriteBgms,
    } = ports;

    setFavoriteBgms(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const handleBgmUpload = async (files: FileList | null) => {
    const {
      setBgmUploading, setBgmNotice, setBgm,
      setAssemblyBgms, activeAssemblyId, setMaterialVersionBgms,
      activeVoiceLang,
    } = ports;

    if (!files?.length) return;
    setBgmUploading(true);
    setBgmNotice('正在上传音乐…');
    const f = files[0];
    try {
      const dataBase64 = await fileToDataUrl(f);
      const { track } = await studioApi.uploadBgm({ name: f.name, dataBase64, mimeType: f.type });
      await refreshBgm();
      if (track?.id) {
        setBgm(track.id);
        setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: track.id }));
        setMaterialVersionBgms(current => ({ ...current, [materialVersionKey(activeAssemblyId, activeVoiceLang)]: track.id }));
        setBgmNotice(`已上传并选中「${track.name || f.name}」`);
      } else {
        setBgmNotice('音乐已上传，但未返回可用曲目，请刷新后重试。');
      }
    } catch (error: any) {
      setBgmNotice(error?.message || '音乐上传失败，请检查文件格式后重试。');
    } finally {
      setBgmUploading(false);
    }
  };

  const invalidateMusicRender = () => {
    const {
      setRendered, setRenderOutputPath, setRenderOutputPreviewUrl,
      setLanguageRenderOutputs,
    } = ports;

    setRendered(false); setRenderOutputPath(null); setRenderOutputPreviewUrl(null);
    setLanguageRenderOutputs({});
  };

  const applyWorkbenchBgm = (trackId: string) => {
    const {
      setBgm, setAssemblyBgms, activeAssemblyId,
      setMaterialVersionBgms, activeVoiceLang,
    } = ports;

    invalidateMusicRender();
    setBgm(trackId);
    setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: trackId }));
    setMaterialVersionBgms(current => ({ ...current, [materialVersionKey(activeAssemblyId, activeVoiceLang)]: trackId }));
  };

  return { refreshBgm, togglePlay, toggleFavoriteBgm, handleBgmUpload, invalidateMusicRender, applyWorkbenchBgm };
}

export function useStudioSoundtrackState() {
  const [bgm, setBgm] = useState('');   // 无内置曲库，默认不选
  const [bgmCandidates, setBgmCandidates] = useState<string[]>([]);
  const [platformBgms, setPlatformBgms] = useState<Record<string, string>>({});
  const [assemblyBgms, setAssemblyBgms] = useState<Record<string, string>>({});
  const [materialVersionBgms, setMaterialVersionBgms] = useState<Record<string, string>>({});
  const [bgmMatchMode, setBgmMatchMode] = useState<'smart' | 'unified'>('smart');
  const [bgmLibraryOpen, setBgmLibraryOpen] = useState(false);
  const bgmLibraryRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(bgmLibraryOpen, bgmLibraryRef, () => setBgmLibraryOpen(false));
  const [soundCandidatesPerContent, setSoundCandidatesPerContent] = useState<1 | 2>(1);
  const [bgmVol, setBgmVol] = useState(35);
  const [voiceVol, setVoiceVol] = useState(100);
  const [effectPreset, setEffectPreset] = useState<EffectPresetId>('natural');
  const [effectIntensity, setEffectIntensity] = useState<EffectIntensity>(0);
  const [disabledEffectSceneIds, setDisabledEffectSceneIds] = useState<string[]>([]);
  const [bgms, setBgms] = useState<Bgm[]>(BGMS);
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);
  const [bgmNotice, setBgmNotice] = useState('');
  const [bgmTab, setBgmTab] = useState<'library' | 'favorites'>('library');
  const [favoriteBgms, setFavoriteBgms] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ow_favorite_bgms') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);

  return { bgm, setBgm, bgmCandidates, setBgmCandidates, platformBgms, setPlatformBgms, assemblyBgms, setAssemblyBgms, materialVersionBgms, setMaterialVersionBgms, bgmMatchMode, setBgmMatchMode, bgmLibraryOpen, setBgmLibraryOpen, bgmLibraryRef, soundCandidatesPerContent, setSoundCandidatesPerContent, bgmVol, setBgmVol, voiceVol, setVoiceVol, effectPreset, setEffectPreset, effectIntensity, setEffectIntensity, disabledEffectSceneIds, setDisabledEffectSceneIds, bgms, setBgms, playingBgm, setPlayingBgm, bgmUploading, setBgmUploading, bgmNotice, setBgmNotice, bgmTab, setBgmTab, favoriteBgms, setFavoriteBgms, audioRef, bgmInputRef };
}

export function useStudioSoundtrackCatalog(ports: Pick<StudioVoiceLifecyclePorts,
  | "refreshBgm"
>) {
  useEffect(() => {
    const {
      refreshBgm,
    } = ports;
    void refreshBgm(); }, []);
}

export function useStudioSoundtrackStep(ports: Pick<StudioVoiceLifecyclePorts,
  | "step"
  | "refreshBgm"
>) {
  const {
    step,
  } = ports;
  useEffect(() => {
    const {
      refreshBgm,
    } = ports;

    if (step === 'bgm') void refreshBgm();
  }, [step]);
}

export function useStudioSoundtrackFavorites(ports: Pick<StudioVoiceLifecyclePorts,
  | "favoriteBgms"
>) {
  const {
    favoriteBgms,
  } = ports;
  useEffect(() => {
    try {
      localStorage.setItem('ow_favorite_bgms', JSON.stringify(favoriteBgms));
    } catch {
      // Embedded browsers can disable localStorage; favorites simply become session-only.
    }
  }, [favoriteBgms]);
}

export function useStudioSoundtrackStop(ports: Pick<StudioVoiceLifecyclePorts,
  | "step"
  | "audioRef"
  | "setPlayingBgm"
>) {
  const {
    step,
  } = ports;
  useEffect(() => {
    const {
      audioRef, setPlayingBgm,
    } = ports;

    if (step !== 'bgm' && audioRef.current) {
      audioRef.current.pause();
      setPlayingBgm(null);
    }
  }, [step]);
}
