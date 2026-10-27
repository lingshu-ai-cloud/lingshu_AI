import { useEffect, useRef, useState } from 'react';
import { useSocialProgram } from '../../contexts/SocialProgramContext';
import { showActionFeedback, showActionSuccess } from '../../lib/actionFeedback';
import { canProcessVideo } from '../../lib/inspirationDataQuality';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { cachedProductInspirationCandidate, resumeOrCreateInspirationTask, soleInspirationCreationAccount } from '../../lib/socialInspirationTask';
import type { Material } from '../../lib/studioApi';
import { useAssistantStore } from '../../stores/assistantStore';
import { assistantImageReplicationPortal } from '../assistant/assistantImageReplicationIntent';
import { PRIMARY_ASSISTANT_THREAD } from '../assistant/globalAssistantRuntime';
import { ASSISTANT_HOME_ACTIVITY_EVENT } from '../assistant/useAssistantHomeAnchor';
import { getAnalysis, inspirationCreationAvailability } from './inspirationAnalysisProjection';
import { type InspirationDashboardProps, type StateSetter } from './inspirationDashboardContracts';
import { visibleMaterialTags } from './inspirationMaterialLibrary';
import type { useInspirationAnalysis } from './useInspirationAnalysis';

interface Dependencies {
  onEnterWorkflow: InspirationDashboardProps['onEnterWorkflow'];
  setMaterialMessage: StateSetter<string>;
  setSelectedVideo: StateSetter<TrendVideo | null>;
  requestExactFullAnalysis: ReturnType<typeof useInspirationAnalysis>['requestExactFullAnalysis'];
}

export function useInspirationCreation({ onEnterWorkflow, setMaterialMessage, setSelectedVideo, requestExactFullAnalysis }: Dependencies) {
  const { activeProgram, accounts } = useSocialProgram();

  const [creationAccountId, setCreationAccountId] = useState('');

  useEffect(() => {
    setCreationAccountId(soleInspirationCreationAccount(accounts, activeProgram?.programId));
  }, [activeProgram?.programId, accounts]);

  const inspirationLaunches = useRef(new Set<string>());

  const [replicationTasks, setReplicationTasks] = useState<Record<string, string>>({});

  const [launchingReferences, setLaunchingReferences] = useState<string[]>([]);

  const enterMaterialSmartGeneration = (material: Material) => {
    const usableUrl = String(material.url || material.poster || '').trim();
    const invalidVideo = material.type === 'video' && !canProcessVideo({ contentFormat: 'video', duration: material.duration });
    if (material.type === 'audio' || invalidVideo || !usableUrl) {
      showActionFeedback({
        title: '当前素材无法直接创作',
        description: material.type === 'audio'
          ? '请选择视频或图片素材。'
          : invalidVideo
            ? '视频时长尚未识别完成，请等待素材分析后重试。'
            : '素材文件尚未准备好，请稍后重试。',
        tone: 'warning',
      });
      return;
    }
    const platform: TrendVideo['platform'] = /facebook/i.test(material.name) ? 'facebook'
      : /youtube/i.test(material.name) ? 'youtube' : /instagram/i.test(material.name) ? 'instagram' : 'tiktok';
    const title = material.name.replace(/\.[a-z0-9]+$/i, '');
    const isImageMaterial = material.type === 'image';
    const video: TrendVideo = {
      id: `material-${material.id}`,
      platform,
      title,
      thumbnail: material.poster || material.segments?.[0]?.poster || '',
      duration: isImageMaterial ? 1 : Math.max(1, Number(material.duration) || 0),
      tags: Array.from(new Set(['本地素材', ...visibleMaterialTags(material.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean)])),
      views: '本地素材',
      trend: 'stable',
      videoUrl: material.type === 'video' ? usableUrl : undefined,
      sourceUrl: material.sourceUrl || usableUrl,
      status: 'analyzed',
      crawledAt: material.createdAt,
      contentFormat: isImageMaterial ? 'image' : 'video',
    };
    onEnterWorkflow?.({
      source: 'material_library',
      materialRole: 'hook',
      video,
      generatedVideo: {
        id: material.id,
        title: material.name,
        url: usableUrl,
        poster: material.poster,
        duration: isImageMaterial ? 1 : Math.max(1, Number(material.duration) || 0),
        createdAt: material.createdAt,
        source: 'material_library',
        material,
      },
    });
    showActionSuccess('已带入自由创作', `正在打开“${material.name}”的制作页面。`);
  };

  const startImageCreation = () => {
    const now = new Date().toISOString();
    onEnterWorkflow?.({
      source: 'material_library',
      video: {
        id: `material-image-create-${Date.now()}`,
        platform: 'facebook',
        title: '新图片内容',
        thumbnail: '',
        duration: 1,
        tags: ['素材库图片制作'],
        views: '素材库',
        trend: 'stable',
        status: 'analyzed',
        crawledAt: now,
        contentFormat: 'image',
      },
    });
    showActionSuccess('已打开图片制作', '先选择产品，系统会根据编导分析推荐可用素材。');
  };

  const enterInspirationWorkflow = async (video: TrendVideo) => {
    const availability = inspirationCreationAvailability(video);
    if (!availability.ready) {
      setMaterialMessage(availability.reason);
      showActionFeedback({ title: '当前内容还不能开始创作', description: availability.reason, tone: 'warning' });
      return;
    }
    if (video.contentFormat === 'image') {
      const title = String(video.title || '已选爆款图文').trim().slice(0, 180);
      const prompt = `请参考这条已采集图文继续创作图片和配文：${title}`;
      const portal = assistantImageReplicationPortal(prompt);
      const sourceRecordId = String(video.recordId || video.id.replace(/^crawl-/, '')).trim().slice(0, 200);
      if (!portal || !sourceRecordId) {
        setMaterialMessage('这条图文缺少可核验的来源记录，请刷新素材后重试。');
        return;
      }
      const imageUrls = video.aiAnalysis?.imageUrls || [];
      const matchedImageIndex = imageUrls.findIndex(url => url === video.thumbnail);
      const referencedPortal = {
        ...portal,
        imageReplication: {
          ...portal.imageReplication,
          reference: {
            sourceRecordId,
            imageIndex: matchedImageIndex >= 0 ? matchedImageIndex : 0,
            name: title,
          },
        },
      };
      const store = useAssistantStore.getState();
      store.setMessages(PRIMARY_ASSISTANT_THREAD, [
        ...store.threads[PRIMARY_ASSISTANT_THREAD].messages,
        {
          role: 'assistant',
          content: '已带入原帖，请选择参考图。',
          creationPortal: referencedPortal,
        },
      ]);
      store.setFollowingLatest(PRIMARY_ASSISTANT_THREAD, true);
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'strategy' } }));
      window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_ACTIVITY_EVENT, { detail: { active: true } }));
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('lingshu:assistant-home-reference')), 0);
      return;
    }
    if (video.id.startsWith('material-')) {
      const analysis = getAnalysis(video);
      onEnterWorkflow?.({
        source: 'inspiration_analysis',
        video, scriptType: 'storyboard',
        referenceAnalysis: analysis ? { title: video.title, visualStyle: analysis.scriptSummary15s.visualStyle,
          coreEmotion: analysis.scriptSummary15s.coreEmotion, details: analysis.scriptDetails15s } : undefined,
      });
      return;
    }
    if (inspirationLaunches.current.has(video.id)) return;
    const openTask = (taskId: string) => {
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
        page: 'smartAssets', view: 'create',
        directStudio: true,
        socialContentTaskId: taskId,
        socialContentPage: 'smartAssets',
        contentCreationRequest: {
          requestId: Date.now(),
          themeId: 'product_value',
          mode: 'instant',
          creationPath: 'viral_replication',
          materialInput: video.videoUrl ? 'ready' : 'limited',
          managedMode: 'one_click_managed',
          continueTaskId: taskId,
          prefill: {
            title: `${video.title || '灵感视频'} · 爆款复刻`,
            topic: video.title || '',
            referenceLinks: [video.sourceUrl || video.videoUrl || ''].filter(Boolean),
            platforms: video.platform ? [video.platform] : undefined,
          },
          sourceContext: {
            originLabel: '来自灵感中心',
            referenceTitle: video.title || '已选参考视频',
            referenceThumbnail: video.thumbnail,
            referenceMediaUrl: video.videoUrl || undefined,
            referenceContentType: 'video', referenceCaption: video.aiAnalysis?.caption || '',
            aspectRatio: video.aiAnalysis?.gemini?.globalSettings?.aspectRatio,
            referenceShots: getAnalysis(video)?.scriptDetails15s.map(detail => ({ time: detail.time, dialogue: detail.dialogue, subtitle: detail.subtitle, visual: detail.visual, firstFrameRef: detail.materialEvidence?.firstFrameRef || undefined, firstFrameSeconds: detail.materialEvidence?.firstFrameSeconds })) || [],
          },
        },
      } }));
    };
    const candidateKey = `${video.id}:${creationAccountId}`;
    const existing = replicationTasks[candidateKey];
    if (existing) { openTask(existing); return; }
    inspirationLaunches.current.add(video.id);
    setLaunchingReferences(ids => [...ids, video.id]);
    setMaterialMessage('正在关联参考与经营背景，交给编导 Agent 和内容 Agent 执行…');
    try {
      const program = activeProgram?.status === 'active' ? activeProgram : undefined;
      const creationAccount = accounts.find(account => account.accountId === creationAccountId && account.status === 'active');
      const result = await resumeOrCreateInspirationTask(cachedProductInspirationCandidate(video,
        creationAccount ? {
          targetAccountRef: { objectType: 'social_owned_account', id: creationAccount.accountId, version: String(creationAccount.version) },
          platforms: [creationAccount.platform],
        } : undefined), program);
      setReplicationTasks(tasks => ({ ...tasks, [candidateKey]: result.task.taskId }));
      if (result.warning) {
        setMaterialMessage(`${result.warning} 已保留原任务，点击“继续制作”查看和恢复。`);
      }
      openTask(result.task.taskId);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '复刻任务暂时无法创建，请重试。');
    } finally {
      inspirationLaunches.current.delete(video.id);
      setLaunchingReferences(ids => ids.filter(id => id !== video.id));
    }
  };

  const startInspirationCreation = (video: TrendVideo) => {
    const availability = inspirationCreationAvailability(video);
    if (!availability.ready && video.contentFormat === 'video') {
      setSelectedVideo(video);
      setMaterialMessage('正在先补齐详细分析；分析完成后即可继续爆款复刻。');
      void requestExactFullAnalysis(video, ['paused', 'cancelled'].includes(String(video.aiAnalysis?.analysisProgress?.stage || '')) || video.aiAnalysis?.geminiStatus === 'paused');
      return;
    }
    void enterInspirationWorkflow(video);
  };

  return {
    creationAccountId,
    replicationTasks,
    launchingReferences,
    enterMaterialSmartGeneration,
    startImageCreation,
    enterInspirationWorkflow,
    startInspirationCreation
  };
}
