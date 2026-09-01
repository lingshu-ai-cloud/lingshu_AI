export type ShotDigitalHumanStatus = 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled' | 'stale';

export interface ShotDigitalHumanBinding {
  jobId: string;
  avatarMaterialId: string;
  status: ShotDigitalHumanStatus;
  inputSignature: string;
  outputMaterialId?: string;
  error?: string;
}

export function shotDigitalHumanSignature(input: {
  slotId: string;
  script: string;
  language: string;
  voiceoverUrl: string;
  start: number;
  end: number;
  avatarMaterialId: string;
}) {
  return [input.slotId, input.script.trim(), input.language, input.voiceoverUrl, input.start.toFixed(3), input.end.toFixed(3), input.avatarMaterialId].join('|');
}

export function isShotDigitalHumanActive(status: ShotDigitalHumanStatus) {
  return ['queued', 'submitting', 'processing', 'quality_check'].includes(status);
}

export function isShotDigitalHumanCurrent(binding: ShotDigitalHumanBinding | undefined, signature: string) {
  return Boolean(binding && binding.inputSignature === signature && binding.status !== 'stale');
}
