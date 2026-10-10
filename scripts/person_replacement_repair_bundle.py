#!/usr/bin/env python3
"""Export frame-wise removal masks for a GPU video-inpainting worker."""

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from person_layer_composite import limb_capsule_mask


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output_dir")
    parser.add_argument("--width", type=int, default=720)
    parser.add_argument("--height", type=int, default=1280)
    args = parser.parse_args()

    root = Path(args.output_dir).resolve()
    frame_dir, mask_dir = root / "frames", root / "masks"
    frame_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)

    capture = cv2.VideoCapture(args.source)
    if not capture.isOpened():
        raise SystemExit("video_open_failed")
    fps = capture.get(cv2.CAP_PROP_FPS) or 24.0
    segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
    pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=1, min_detection_confidence=0.35)
    count = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frame = cv2.resize(frame, (args.width, args.height), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        probability = segmenter.process(rgb).segmentation_mask
        limb = limb_capsule_mask(pose.process(rgb).pose_landmarks, args.width, args.height)
        mask = np.maximum((probability > 0.045).astype(np.uint8) * 255, limb)
        mask = cv2.dilate(mask, np.ones((25, 25), np.uint8))
        mask = cv2.GaussianBlur(mask, (9, 9), 0)
        name = f"{count:05d}.png"
        cv2.imwrite(str(frame_dir / name), frame)
        cv2.imwrite(str(mask_dir / name), mask)
        count += 1

    capture.release()
    segmenter.close()
    pose.close()
    manifest = {
        "version": 1,
        "source": str(Path(args.source).resolve()),
        "width": args.width,
        "height": args.height,
        "fps": fps,
        "frameCount": count,
        "frames": "frames",
        "masks": "masks",
        "purpose": "remove original actor and reconstruct a temporally stable clean background",
        "preferredProductionProvider": "Apache-2.0-compatible video inpainting worker",
        "researchOnlyProvider": "ProPainter is excluded from commercial production by its non-commercial license",
    }
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(root)


if __name__ == "__main__":
    main()
