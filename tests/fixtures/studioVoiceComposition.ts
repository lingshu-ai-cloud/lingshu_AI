import { restoreStudioBoundaryComposition } from './studioBoundaryComposition';

export function restoreStudioVoiceComposition(source: string): string {
  return restoreStudioBoundaryComposition(source, {
    moduleNames: [
      'studioVoiceTranslationActions.ts',
      'studioVoiceSynthesisActions.ts',
      'studioVoicePlayback.ts',
      'useStudioSubtitleReview.ts',
      'studioVoiceSoundtrack.ts',
      'useStudioVoiceState.ts',
      'useStudioVoiceModel.ts',
      'useStudioVoiceLifecycle.ts',
    ],
    portBinding: 'voicePorts',
    actionFactories: [
      'createStudioVoiceTranslationActions',
      'createStudioVoiceSynthesisActions',
      'createStudioVoicePlaybackActions',
      'createStudioSubtitleActions',
      'createStudioSoundtrackActions',
    ],
  });
}
