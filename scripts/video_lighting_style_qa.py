#!/usr/bin/env python3
"""Compare coarse lighting/color statistics of candidate videos against a source.

This is a global visual proxy. It measures the central image region so borders and
UI-like overlays have less influence, but it does not judge identity or semantics.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def samples(path: str, sample_fps: float) -> list[np.ndarray]:
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    step = max(1, round(fps / sample_fps))
    frames: list[np.ndarray] = []
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index % step == 0:
            height, width = frame.shape[:2]
            frames.append(frame[int(height * 0.08):int(height * 0.88), int(width * 0.2):int(width * 0.8)])
        index += 1
    cap.release()
    return frames


def features(frame: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB).astype(np.float32)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(np.float32)
    return np.array([
        lab[..., 0].mean(), lab[..., 0].std(),
        lab[..., 1].mean(), lab[..., 2].mean(),
        hsv[..., 1].mean(),
    ], dtype=np.float32)


def compare(source: list[np.ndarray], candidate: list[np.ndarray]) -> dict[str, float | int]:
    count = min(len(source), len(candidate))
    src = np.stack([features(frame) for frame in source[:count]])
    dst = np.stack([features(frame) for frame in candidate[:count]])
    delta = np.abs(src - dst)
    return {
        "pairedSamples": count,
        "luminanceMeanMae": round(float(delta[:, 0].mean()), 6),
        "contrastMae": round(float(delta[:, 1].mean()), 6),
        "labColorMeanMae": round(float(delta[:, 2:4].mean()), 6),
        "saturationMeanMae": round(float(delta[:, 4].mean()), 6),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("candidates", nargs="+")
    parser.add_argument("--output", required=True)
    parser.add_argument("--sample-fps", type=float, default=8.0)
    args = parser.parse_args()

    source_frames = samples(args.source, args.sample_fps)
    report = {
        "version": 1,
        "sampleFps": args.sample_fps,
        "metrics": {
            candidate: compare(source_frames, samples(candidate, args.sample_fps))
            for candidate in args.candidates
        },
        "interpretation": "各项误差越低，中心画面的明暗、反差和综合色彩越接近源视频；这是全局代理，不评价身份或场景语义。",
    }
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
