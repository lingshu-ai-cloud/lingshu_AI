#!/usr/bin/env python3
"""Composite a generated actor onto the original video background.

This is an MVP for expert-mode experiments. The source video remains the
timeline and background authority; the candidate contributes only its person
pixels. The source audio is copied without re-encoding by ffmpeg.
"""

import argparse
import os
import subprocess
import tempfile
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


def soften(mask: np.ndarray, threshold: float, close_size: int, blur_size: int) -> np.ndarray:
    binary = (mask >= threshold).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    soft = cv2.GaussianBlur(binary, (blur_size, blur_size), 0).astype(np.float32) / 255.0
    return np.clip(soft, 0.0, 1.0)


def limb_capsule_mask(pose_landmarks, width: int, height: int) -> np.ndarray:
    """Approximate arms and hands when person segmentation misses fast fingers."""
    mask = np.zeros((height, width), dtype=np.uint8)
    if not pose_landmarks:
        return mask
    landmarks = pose_landmarks.landmark
    # MediaPipe Pose: shoulders, elbows, wrists, pinkies, indexes and thumbs.
    chains = ((11, 13, 15, 17, 19, 21), (12, 14, 16, 18, 20, 22))
    arm_width = max(14, round(width * 0.045))
    hand_radius = max(18, round(width * 0.040))

    def point(index: int):
        item = landmarks[index]
        if item.visibility < 0.20 or not (-0.15 <= item.x <= 1.15 and -0.15 <= item.y <= 1.15):
            return None
        return int(item.x * width), int(item.y * height)

    for chain in chains:
        resolved = [point(index) for index in chain]
        for start, end in zip(resolved, resolved[1:]):
            if start is not None and end is not None:
                cv2.line(mask, start, end, 255, arm_width, cv2.LINE_AA)
        for item in resolved[2:]:
            if item is not None:
                cv2.circle(mask, item, hand_radius, 255, -1, cv2.LINE_AA)
    return mask


def build_clean_plate(video_path: str, width: int, height: int, threshold: float) -> np.ndarray:
    """Estimate a static background from pixels visible outside the actor over time."""
    capture = cv2.VideoCapture(video_path)
    segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
    pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=1, min_detection_confidence=0.35)
    total = np.zeros((height, width, 3), dtype=np.float64)
    weight = np.zeros((height, width), dtype=np.float32)
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % 4:
            index += 1
            continue
        frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        probability = segmenter.process(rgb).segmentation_mask
        limb = limb_capsule_mask(pose.process(rgb).pose_landmarks, width, height)
        foreground = np.maximum((probability > max(0.05, threshold * 0.45)).astype(np.uint8) * 255, limb)
        foreground = cv2.dilate(foreground, np.ones((25, 25), np.uint8))
        visible = foreground == 0
        total[visible] += frame[visible]
        weight[visible] += 1
        index += 1
    capture.release()
    segmenter.close()
    pose.close()

    plate = np.zeros((height, width, 3), dtype=np.uint8)
    known = weight >= 2
    plate[known] = np.clip(total[known] / weight[known][:, None], 0, 255).astype(np.uint8)
    missing = (~known).astype(np.uint8) * 255

    # Inpaint the large permanently occluded center at low resolution. This
    # produces a smooth wall/room plate and avoids high-resolution Telea pulling
    # skin or hair colors back across the mask boundary.
    small_size = (max(96, width // 4), max(160, height // 4))
    small_plate = cv2.resize(plate, small_size, interpolation=cv2.INTER_AREA)
    small_missing = cv2.resize(missing, small_size, interpolation=cv2.INTER_NEAREST)
    small_missing = cv2.dilate(small_missing, np.ones((7, 7), np.uint8))
    repaired = cv2.inpaint(small_plate, small_missing, 7, cv2.INPAINT_TELEA)
    repaired = cv2.resize(repaired, (width, height), interpolation=cv2.INTER_CUBIC)
    # Use one coherent low-frequency plate. Blending observed pixels back into
    # the repaired center leaves a stationary contour around the old actor.
    return repaired


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("candidate")
    parser.add_argument("output")
    parser.add_argument("--threshold", type=float, default=0.36)
    parser.add_argument("--temporal-smoothing", type=float, default=0.72)
    parser.add_argument("--background-mode", choices=("frame-inpaint", "clean-plate"), default="frame-inpaint")
    parser.add_argument("--background-video", help="Optional repaired background video from a neural inpainting worker")
    parser.add_argument("--ffmpeg", required=True)
    args = parser.parse_args()

    source = cv2.VideoCapture(args.source)
    candidate = cv2.VideoCapture(args.candidate)
    if not source.isOpened() or not candidate.isOpened():
        raise SystemExit("video_open_failed")

    fps = source.get(cv2.CAP_PROP_FPS) or 24.0
    width = int(candidate.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(candidate.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(source.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps
    clean_plate = build_clean_plate(args.source, width, height, args.threshold) if args.background_mode == "clean-plate" and not args.background_video else None
    repaired_background = cv2.VideoCapture(args.background_video) if args.background_video else None
    if repaired_background is not None and not repaired_background.isOpened():
        raise SystemExit("background_video_open_failed")

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="person-layer-") as temp_dir:
        silent_path = os.path.join(temp_dir, "silent.mp4")
        writer = cv2.VideoWriter(silent_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        if not writer.isOpened():
            raise SystemExit("video_writer_failed")

        segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
        pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=1, min_detection_confidence=0.35)
        previous_source = None
        previous_candidate = None
        rendered = 0

        for index in range(frame_count):
            source.set(cv2.CAP_PROP_POS_MSEC, index * 1000.0 / fps)
            candidate.set(cv2.CAP_PROP_POS_MSEC, index * 1000.0 / fps)
            ok_source, source_frame = source.read()
            ok_candidate, candidate_frame = candidate.read()
            if not ok_source or not ok_candidate:
                break

            source_frame = cv2.resize(source_frame, (width, height), interpolation=cv2.INTER_AREA)
            candidate_frame = cv2.resize(candidate_frame, (width, height), interpolation=cv2.INTER_AREA)
            source_rgb = cv2.cvtColor(source_frame, cv2.COLOR_BGR2RGB)
            candidate_rgb = cv2.cvtColor(candidate_frame, cv2.COLOR_BGR2RGB)
            source_prob = segmenter.process(source_rgb).segmentation_mask
            candidate_prob = segmenter.process(candidate_rgb).segmentation_mask
            source_limb = limb_capsule_mask(pose.process(source_rgb).pose_landmarks, width, height).astype(np.float32) / 255.0
            candidate_limb = limb_capsule_mask(pose.process(candidate_rgb).pose_landmarks, width, height).astype(np.float32) / 255.0

            if previous_source is not None:
                source_prob = args.temporal_smoothing * previous_source + (1 - args.temporal_smoothing) * source_prob
                candidate_prob = args.temporal_smoothing * previous_candidate + (1 - args.temporal_smoothing) * candidate_prob
            previous_source, previous_candidate = source_prob, candidate_prob

            source_mask = np.maximum(soften(source_prob, args.threshold, 13, 17), cv2.GaussianBlur(source_limb, (17, 17), 0))
            candidate_mask = np.maximum(soften(candidate_prob, args.threshold, 13, 17), cv2.GaussianBlur(candidate_limb, (17, 17), 0))

            # Only repair source-person pixels the new actor does not cover.
            # This avoids reconstructing the entire static background unnecessarily.
            # Build a clean plate for the complete original subject before the
            # new actor is overlaid. Cleaning only the uncovered difference
            # leaves dark hair inside the candidate's feathered edge.
            exposed_source = (source_mask > 0.045).astype(np.uint8) * 255
            exposed_source = cv2.dilate(exposed_source, np.ones((15, 15), np.uint8))
            if repaired_background is not None:
                repaired_background.set(cv2.CAP_PROP_POS_MSEC, index * 1000.0 / fps)
                ok_background, clean_background = repaired_background.read()
                if not ok_background:
                    raise SystemExit(f"background_video_frame_missing:{index}")
                clean_background = cv2.resize(clean_background, (width, height), interpolation=cv2.INTER_AREA)
            else:
                clean_background = clean_plate if clean_plate is not None else source_frame
            if repaired_background is None and clean_plate is None and exposed_source.any():
                clean_background = cv2.inpaint(source_frame, exposed_source, 9, cv2.INPAINT_TELEA)

            alpha = candidate_mask[..., None]
            composite = candidate_frame.astype(np.float32) * alpha + clean_background.astype(np.float32) * (1 - alpha)
            writer.write(np.clip(composite, 0, 255).astype(np.uint8))
            rendered += 1

        segmenter.close()
        pose.close()
        writer.release()
        source.release()
        candidate.release()
        if repaired_background is not None:
            repaired_background.release()

        if rendered == 0:
            raise SystemExit("no_frames_rendered")

        subprocess.run([
            args.ffmpeg, "-hide_banner", "-nostdin", "-y",
            "-i", silent_path, "-i", str(Path(args.source).resolve()),
            "-map", "0:v:0", "-map", "1:a:0?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", f"{duration:.6f}",
            "-movflags", "+faststart", str(output),
        ], check=True)

    print(f"rendered_frames={rendered}")
    print(f"output={output}")


if __name__ == "__main__":
    main()
