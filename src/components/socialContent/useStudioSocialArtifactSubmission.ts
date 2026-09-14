import { useRef, useState } from 'react';
import {
  submitManualSocialArtifact,
  type ManualSocialArtifactSnapshot,
} from '../../lib/socialContentManualBridge';

type StudioSocialArtifactSubmissionOptions = {
  enabled: boolean;
  taskId?: string | null;
  snapshot: ManualSocialArtifactSnapshot;
  onSubmitted: () => void;
  onNotice: (message: string) => void;
};

export function useStudioSocialArtifactSubmission({
  enabled,
  taskId,
  snapshot,
  onSubmitted,
  onNotice,
}: StudioSocialArtifactSubmissionOptions) {
  const inFlightRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!enabled || !taskId || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    onNotice('');
    try {
      await submitManualSocialArtifact(taskId, snapshot);
      onSubmitted();
      onNotice('成品已提交到当前社媒任务，请返回灵小枢确认。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '成品提交失败，请稍后重试。');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return { ready: enabled, submitting, submit };
}
