#!/usr/bin/env python3
"""Controlled handheld-product replacement for similar-shape SKUs.

The MVP deliberately uses user-confirmed keyframes instead of hallucinating a
track.  It interpolates position, width and rotation, composites a transparent
product asset, restores optional foreground/hand occlusion polygons, and emits
a machine-readable temporal QA report.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import tempfile
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Keyframe:
    frame: int
    x: float
    y: float
    width: float
    angle: float
    occlusion: list[list[float]]


def load_keyframes(path: str) -> list[Keyframe]:
    raw = json.load(open(path, encoding="utf-8"))
    result = [Keyframe(
        frame=int(item["frame"]), x=float(item["x"]), y=float(item["y"]),
        width=float(item["width"]), angle=float(item.get("angle", 0)),
        occlusion=list(item.get("occlusion", [])),
    ) for item in raw.get("keyframes", [])]
    if len(result) < 2 or result != sorted(result, key=lambda item: item.frame):
        raise ValueError("至少需要两个按帧号升序排列的关键帧")
    if any(item.width <= 2 for item in result):
        raise ValueError("商品宽度必须大于2像素")
    return result


def interpolate(keyframes: list[Keyframe], frame: int) -> Keyframe | None:
    if frame < keyframes[0].frame or frame > keyframes[-1].frame:
        return None
    left, right = keyframes[0], keyframes[-1]
    for a, b in zip(keyframes, keyframes[1:]):
        if a.frame <= frame <= b.frame:
            left, right = a, b
            break
    ratio = 0 if right.frame == left.frame else (frame - left.frame) / (right.frame - left.frame)
    # Ease interpolation prevents visible velocity discontinuities at endpoints.
    eased = ratio * ratio * (3 - 2 * ratio)
    lerp = lambda a, b: a + (b - a) * eased
    occlusion = left.occlusion if ratio < 0.5 else right.occlusion
    return Keyframe(frame, lerp(left.x, right.x), lerp(left.y, right.y), lerp(left.width, right.width), lerp(left.angle, right.angle), occlusion)


def transformed_product(asset: np.ndarray, track: Keyframe) -> tuple[np.ndarray, int, int]:
    height, width = asset.shape[:2]
    scale = track.width / max(width, 1)
    resized = cv2.resize(asset, (max(2, round(width * scale)), max(2, round(height * scale))), interpolation=cv2.INTER_LANCZOS4)
    rh, rw = resized.shape[:2]
    diagonal = int(math.ceil(math.hypot(rw, rh))) + 4
    canvas = np.zeros((diagonal, diagonal, 4), dtype=np.uint8)
    x0, y0 = (diagonal - rw) // 2, (diagonal - rh) // 2
    canvas[y0:y0 + rh, x0:x0 + rw] = resized
    matrix = cv2.getRotationMatrix2D((diagonal / 2, diagonal / 2), -track.angle, 1.0)
    rotated = cv2.warpAffine(canvas, matrix, (diagonal, diagonal), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    return rotated, round(track.x - diagonal / 2), round(track.y - diagonal / 2)


def composite(frame: np.ndarray, original_frame: np.ndarray, product: np.ndarray, track: Keyframe) -> np.ndarray:
    overlay, ox, oy = transformed_product(product, track)
    height, width = frame.shape[:2]
    x1, y1 = max(0, ox), max(0, oy)
    x2, y2 = min(width, ox + overlay.shape[1]), min(height, oy + overlay.shape[0])
    if x2 <= x1 or y2 <= y1:
        return frame
    sx1, sy1 = x1 - ox, y1 - oy
    layer = overlay[sy1:sy1 + (y2 - y1), sx1:sx1 + (x2 - x1)]
    alpha = cv2.GaussianBlur(layer[:, :, 3].astype(np.float32) / 255.0, (3, 3), 0)[:, :, None]
    original = frame[y1:y2, x1:x2].copy()
    frame[y1:y2, x1:x2] = np.clip(layer[:, :, :3] * alpha + original * (1 - alpha), 0, 255).astype(np.uint8)
    if track.occlusion:
        polygon = np.asarray(track.occlusion, dtype=np.float32)
        polygon[:, 0] *= width
        polygon[:, 1] *= height
        mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(mask, [polygon.astype(np.int32)], 255)
        mask = cv2.GaussianBlur(mask, (5, 5), 0)
        a = (mask.astype(np.float32) / 255.0)[:, :, None]
        frame[:] = np.clip(original_frame * a + frame * (1 - a), 0, 255).astype(np.uint8)
    return frame


def mux_audio(silent_video: str, source: str, output: str) -> None:
    command = ["ffmpeg", "-y", "-v", "error", "-i", silent_video, "-i", source,
               "-map", "0:v:0", "-map", "1:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
               "-movflags", "+faststart", "-shortest", output]
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--product", required=True, help="transparent PNG")
    parser.add_argument("--track", required=True, help="confirmed keyframe JSON")
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    args = parser.parse_args()
    keyframes = load_keyframes(args.track)
    product = cv2.imread(args.product, cv2.IMREAD_UNCHANGED)
    if product is None or product.ndim != 3 or product.shape[2] != 4:
        raise SystemExit("商品资产必须是带透明通道的PNG")
    capture = cv2.VideoCapture(args.video)
    fps = capture.get(cv2.CAP_PROP_FPS) or 25
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if keyframes[-1].frame >= total:
        raise SystemExit("关键帧超出视频时长")
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    temp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    temp.close()
    writer = cv2.VideoWriter(temp.name, cv2.VideoWriter_fourcc(*"avc1"), fps, (width, height))
    if not writer.isOpened():
        writer = cv2.VideoWriter(temp.name, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    centers, widths, angles, replaced = [], [], [], 0
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        original_frame = frame.copy()
        track = interpolate(keyframes, index)
        if track:
            frame = composite(frame, original_frame, product, track)
            centers.append((track.x, track.y)); widths.append(track.width); angles.append(track.angle); replaced += 1
        writer.write(frame)
        index += 1
    capture.release(); writer.release()
    mux_audio(temp.name, args.video, args.output)
    os.unlink(temp.name)
    center_jumps = [math.dist(a, b) for a, b in zip(centers, centers[1:])]
    width_jumps = [abs(a - b) / max(a, 1) for a, b in zip(widths, widths[1:])]
    angle_jumps = [abs(a - b) for a, b in zip(angles, angles[1:])]
    percentile = lambda values, p: float(np.percentile(values, p)) if values else 0.0
    report = {
        "passed": replaced > 0 and percentile(center_jumps, 95) <= max(widths or [1]) * 0.12
                  and percentile(width_jumps, 95) <= 0.08 and percentile(angle_jumps, 95) <= 8,
        "mode": "keyframe_assisted_similar_product",
        "frames_total": index, "frames_replaced": replaced,
        "replacement_coverage": round(replaced / max(index, 1), 4),
        "center_jump_p95_px": round(percentile(center_jumps, 95), 3),
        "width_jump_p95_ratio": round(percentile(width_jumps, 95), 4),
        "angle_jump_p95_deg": round(percentile(angle_jumps, 95), 3),
        "manual_review_required": ["原商品残留", "手指遮挡", "接触点", "品牌外观", "反光与运动模糊"],
    }
    report_path = args.report or f"{args.output}.quality.json"
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
