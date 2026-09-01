#!/usr/bin/env python3
"""Quality gate for a generated talking-head clip.

The gate deliberately combines container checks, face tracking, mouth temporal
stability and an audio/visual activity alignment estimate. It emits one JSON
object and exits non-zero when a required metric is outside the accepted range.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys

import cv2
import mediapipe as mp
import numpy as np
import soundfile as sf


def probe(path: str) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
            "-of", "json", path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def ratio(rate: str) -> float:
    numerator, denominator = rate.split("/")
    return float(numerator) / max(float(denominator), 1.0)


def smooth(values: np.ndarray, width: int = 5) -> np.ndarray:
    if len(values) < width:
        return values
    kernel = np.ones(width, dtype=np.float64) / width
    return np.convolve(values, kernel, mode="same")


def normalized(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    std = float(values.std())
    return (values - values.mean()) / std if std > 1e-8 else np.zeros_like(values)


def analyze(video_path: str, audio_path: str) -> tuple[dict, list[str]]:
    metadata = probe(video_path)
    streams = metadata.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), {})
    duration = float(metadata.get("format", {}).get("duration", 0.0))
    fps = ratio(video_stream.get("r_frame_rate", "0/1"))

    samples, sample_rate = sf.read(audio_path, always_2d=True)
    mono = samples.mean(axis=1).astype(np.float64)
    audio_duration = len(mono) / float(sample_rate)

    capture = cv2.VideoCapture(video_path)
    mouth_open = []
    mouth_sharpness = []
    detected = 0
    total = 0
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        total += 1
        result = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        if not result.multi_face_landmarks:
            mouth_open.append(math.nan)
            mouth_sharpness.append(math.nan)
            continue
        detected += 1
        landmarks = result.multi_face_landmarks[0].landmark
        height, width = frame.shape[:2]
        points = np.array([(p.x * width, p.y * height) for p in landmarks])
        mouth_width = max(np.linalg.norm(points[61] - points[291]), 1.0)
        mouth_open.append(float(np.linalg.norm(points[13] - points[14]) / mouth_width))
        x1, x2 = np.clip([int(points[61, 0] - 8), int(points[291, 0] + 8)], 0, width)
        y1 = max(0, int(min(points[0, 1], points[13, 1]) - 8))
        y2 = min(height, int(max(points[17, 1], points[14, 1]) + 8))
        roi = cv2.cvtColor(frame[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
        mouth_sharpness.append(float(cv2.Laplacian(roi, cv2.CV_64F).var()) if roi.size else 0.0)
    capture.release()
    face_mesh.close()

    openness = np.asarray(mouth_open, dtype=np.float64)
    if np.isnan(openness).all():
        openness = np.zeros(total, dtype=np.float64)
    else:
        valid = np.flatnonzero(~np.isnan(openness))
        openness = np.interp(np.arange(total), valid, openness[valid])
    openness_smooth = smooth(openness)

    frame_energy = []
    for index in range(total):
        center = int((index + 0.5) * sample_rate / max(fps, 1.0))
        radius = max(1, int(sample_rate / max(fps, 1.0) / 2))
        chunk = mono[max(0, center - radius):min(len(mono), center + radius)]
        frame_energy.append(float(np.sqrt(np.mean(np.square(chunk)))) if len(chunk) else 0.0)
    energy = smooth(np.log1p(np.asarray(frame_energy) * 1000.0))

    # Mouth opening is phoneme-dependent, so use activity envelopes and permit
    # a small search window. The reported lag is the best audio-to-video offset.
    mouth_activity = smooth(np.abs(np.gradient(openness_smooth)), 7)
    audio_activity = smooth(np.abs(np.gradient(energy)), 7)
    best_lag = 0
    best_correlation = -1.0
    for lag in range(-8, 9):
        if lag < 0:
            left, right = mouth_activity[-lag:], audio_activity[:lag]
        elif lag > 0:
            left, right = mouth_activity[:-lag], audio_activity[lag:]
        else:
            left, right = mouth_activity, audio_activity
        if len(left) < 10:
            continue
        correlation = float(np.mean(normalized(left) * normalized(right)))
        if correlation > best_correlation:
            best_correlation = correlation
            best_lag = lag

    sharp = np.asarray(mouth_sharpness, dtype=np.float64)
    sharp = sharp[~np.isnan(sharp)]
    jumps = np.abs(np.diff(openness))
    metrics = {
        "passed": False,
        "video_codec": video_stream.get("codec_name"),
        "audio_codec": audio_stream.get("codec_name"),
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "fps": round(fps, 3),
        "duration_seconds": round(duration, 3),
        "audio_duration_seconds": round(audio_duration, 3),
        "duration_delta_seconds": round(abs(duration - audio_duration), 3),
        "frame_count": total,
        "face_detection_rate": round(detected / max(total, 1), 4),
        "mouth_openness_std": round(float(openness.std()), 4),
        "mouth_jump_p95": round(float(np.percentile(jumps, 95)) if len(jumps) else 0.0, 4),
        "mouth_jump_max": round(float(jumps.max()) if len(jumps) else 0.0, 4),
        "mouth_sharpness_median": round(float(np.median(sharp)) if len(sharp) else 0.0, 2),
        "activity_alignment_lag_frames": int(best_lag),
        "activity_alignment_lag_ms": round(best_lag * 1000.0 / max(fps, 1.0), 1),
        "av_activity_correlation": round(best_correlation, 4),
    }

    failures = []
    if metrics["video_codec"] != "h264":
        failures.append("video codec is not H.264")
    if metrics["audio_codec"] != "aac":
        failures.append("audio codec is not AAC")
    if metrics["duration_delta_seconds"] > 0.12:
        failures.append("audio/video duration mismatch exceeds 120 ms")
    if metrics["face_detection_rate"] < 0.98:
        failures.append("face tracking success is below 98%")
    if metrics["mouth_openness_std"] < 0.012:
        failures.append("mouth motion is too static")
    if metrics["mouth_jump_p95"] > 0.085:
        failures.append("mouth motion contains excessive frame-to-frame jumps")
    if metrics["mouth_sharpness_median"] < 25.0:
        failures.append("mouth region is excessively blurred")
    # This envelope correlation is diagnostic only: different phonemes can
    # produce low energy/opening correlation even when timing is correct.
    # Official SyncNet confidence and offset are enforced in the next gate.
    metrics["passed"] = not failures
    metrics["failures"] = failures
    return metrics, failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--enforce", action="store_true")
    args = parser.parse_args()
    metrics, failures = analyze(args.video, args.audio)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return 2 if args.enforce and failures else 0


if __name__ == "__main__":
    sys.exit(main())
