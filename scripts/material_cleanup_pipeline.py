#!/usr/bin/env python3
"""Preserved, inactive candidate worker for future My Materials admission.

No current upload route invokes this script; enabling it requires separate
confirmation, dependency installation and integration acceptance.

The worker deliberately has no cloud-generation fallback. It detects text with
PaddleOCR, refines and propagates masks with SAM 2 plus optical flow, repairs
small regions with OpenCV, preserves audio with FFmpeg, and emits a fail-closed
JSON report consumed by the Node admission gate.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from importlib import metadata, resources
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from paddleocr import TextDetection
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor


def write_report(path: Path, **values: Any) -> None:
    report = {
        "schemaVersion": "material-cleanup.v1",
        "status": "rejected",
        "toolchain": {
            "ocr": "paddleocr",
            "maskTracker": "sam2",
            "inpaint": "opencv-temporal",
            "compositor": "ffmpeg",
            "seedanceUsed": False,
        },
        "framesProcessed": 0,
        "totalFrames": 0,
        "residualTextDetections": 0,
        "unresolvedRegions": 0,
        "maximumMaskCoverage": 0.0,
        "temporalFlickerScore": 1.0,
        **values,
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def paddle_boxes(detector: TextDetection, frame: np.ndarray, minimum_score: float) -> list[np.ndarray]:
    boxes: list[np.ndarray] = []
    try:
        predictions = list(detector.predict(frame))
        for prediction in predictions:
            data = prediction.json if hasattr(prediction, "json") else prediction
            if isinstance(data, str):
                data = json.loads(data)
            if isinstance(data, dict) and isinstance(data.get("res"), dict):
                data = data["res"]
            if not isinstance(data, dict):
                continue
            polygons = data.get("dt_polys") or data.get("rec_polys") or []
            scores = data.get("dt_scores") or [1.0] * len(polygons)
            for polygon, score in zip(polygons, scores):
                if float(score) >= minimum_score:
                    boxes.append(np.asarray(polygon, dtype=np.float32).reshape(-1, 2))
        return boxes
    except Exception as error:
        raise RuntimeError(f"paddle_text_detection_failed:{error}") from error


def mask_from_boxes(predictor: SAM2ImagePredictor, rgb: np.ndarray, boxes: list[np.ndarray]) -> np.ndarray:
    height, width = rgb.shape[:2]
    union = np.zeros((height, width), dtype=np.uint8)
    if not boxes:
        return union
    predictor.set_image(rgb)
    for polygon in boxes:
        x1, y1 = np.maximum(np.floor(polygon.min(axis=0) - 4), 0)
        x2, y2 = np.minimum(np.ceil(polygon.max(axis=0) + 4), [width - 1, height - 1])
        masks, scores, _ = predictor.predict(
            box=np.asarray([x1, y1, x2, y2], dtype=np.float32),
            multimask_output=True,
        )
        if len(masks):
            union = np.maximum(union, masks[int(np.argmax(scores))].astype(np.uint8) * 255)
        cv2.fillPoly(union, [polygon.astype(np.int32)], 255)
    return cv2.dilate(union, np.ones((7, 7), dtype=np.uint8), iterations=1)


def expanded_text_mask(shape: tuple[int, int], boxes: list[np.ndarray]) -> np.ndarray:
    """Conservative second-pass mask for OCR remnants after SAM inpainting."""
    height, width = shape
    mask = np.zeros((height, width), dtype=np.uint8)
    for polygon in boxes:
        x1, y1 = np.maximum(np.floor(polygon.min(axis=0) - 10), 0).astype(int)
        x2, y2 = np.minimum(np.ceil(polygon.max(axis=0) + 10), [width - 1, height - 1]).astype(int)
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, thickness=-1)
    return cv2.dilate(mask, np.ones((9, 9), dtype=np.uint8), iterations=1)


def propagate_mask(previous_gray: np.ndarray | None, gray: np.ndarray, previous_mask: np.ndarray | None) -> np.ndarray:
    if previous_gray is None or previous_mask is None or not np.any(previous_mask):
        return np.zeros_like(gray)
    flow = cv2.calcOpticalFlowFarneback(previous_gray, gray, None, 0.5, 3, 21, 3, 5, 1.2, 0)
    height, width = gray.shape
    grid_x, grid_y = np.meshgrid(np.arange(width), np.arange(height))
    map_x = (grid_x - flow[..., 0]).astype(np.float32)
    map_y = (grid_y - flow[..., 1]).astype(np.float32)
    return cv2.remap(previous_mask, map_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)


def residual_count(detector: TextDetection, frame: np.ndarray) -> int:
    return len(paddle_boxes(detector, frame, 0.58))


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] == "--self-check":
        checkpoint_value = os.environ.get("MATERIAL_CLEANUP_SAM2_CHECKPOINT", "")
        checkpoint = Path(checkpoint_value) if checkpoint_value else None
        model_config = os.environ.get("MATERIAL_CLEANUP_SAM2_CONFIG", "")
        config_path = resources.files("sam2").joinpath(model_config) if model_config else None
        configured_ffmpeg = os.environ.get("MATERIAL_CLEANUP_FFMPEG", "ffmpeg")
        resolved_ffmpeg = configured_ffmpeg if os.path.isabs(configured_ffmpeg) else shutil.which(configured_ffmpeg)
        failures = []
        if checkpoint is None or not checkpoint.is_file() or checkpoint.stat().st_size < 10 * 1024 * 1024:
            failures.append("sam2_checkpoint_missing_or_invalid")
        if config_path is None or not config_path.is_file():
            failures.append("sam2_config_missing")
        if not resolved_ffmpeg or not os.path.isfile(resolved_ffmpeg) or not os.access(resolved_ffmpeg, os.X_OK):
            failures.append("ffmpeg_missing_or_not_executable")
        ready = not failures
        print(json.dumps({
            "ready": ready,
            "toolchain": {
                "ocr": "paddleocr", "maskTracker": "sam2", "inpaint": "opencv-temporal",
                "compositor": "ffmpeg", "seedanceUsed": False,
            },
            "versions": {
                "python": sys.version.split()[0],
                "torch": torch.__version__,
                "opencv": cv2.__version__,
                "paddleocr": metadata.version("paddleocr"),
                "paddlepaddle": metadata.version("paddlepaddle"),
                "sam2": metadata.version("SAM-2"),
            },
            "reason": "" if ready else ",".join(failures),
        }))
        raise SystemExit(0 if ready else 1)
    if len(sys.argv) != 4:
        raise SystemExit("usage: material_cleanup_pipeline.py INPUT OUTPUT REPORT")
    source, output, report_path = map(Path, sys.argv[1:])
    checkpoint = Path(os.environ.get("MATERIAL_CLEANUP_SAM2_CHECKPOINT", ""))
    model_config = os.environ.get("MATERIAL_CLEANUP_SAM2_CONFIG", "")
    ffmpeg = os.environ.get("MATERIAL_CLEANUP_FFMPEG", "ffmpeg")
    if not source.is_file() or not checkpoint.is_file() or not model_config:
        write_report(report_path, failures=["missing_source_or_sam2_configuration"])
        raise SystemExit("missing source, SAM 2 checkpoint, or model config")

    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        write_report(report_path, failures=["video_open_failed"])
        raise SystemExit("video_open_failed")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 24.0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if width <= 0 or height <= 0 or total <= 0:
        capture.release()
        write_report(report_path, totalFrames=total, failures=["invalid_video_metadata"])
        raise SystemExit("invalid_video_metadata")

    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    model = build_sam2(model_config, str(checkpoint), device=device)
    predictor = SAM2ImagePredictor(model)
    ocr = TextDetection(
        model_name=os.environ.get("MATERIAL_CLEANUP_OCR_DETECTION_MODEL", "PP-OCRv5_mobile_det"),
        limit_side_len=int(os.environ.get("MATERIAL_CLEANUP_OCR_LIMIT_SIDE", "736")),
    )

    with tempfile.TemporaryDirectory(prefix="lingshu-cleanup-") as temporary:
        silent = Path(temporary) / "silent.mp4"
        writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        if not writer.isOpened():
            capture.release()
            write_report(report_path, totalFrames=total, failures=["video_writer_failed"])
            raise SystemExit("video_writer_failed")
        processed = 0
        residual = 0
        unresolved = 0
        maximum_coverage = 0.0
        flicker_values: list[float] = []
        previous_gray: np.ndarray | None = None
        previous_mask: np.ndarray | None = None
        previous_clean: np.ndarray | None = None
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                boxes = paddle_boxes(ocr, frame, 0.45)
                current_mask = mask_from_boxes(predictor, rgb, boxes)
                tracked_mask = propagate_mask(previous_gray, gray, previous_mask)
                mask = np.maximum(current_mask, tracked_mask)
                coverage = float(np.count_nonzero(mask)) / float(mask.size)
                frame_unresolved = coverage > 0.22
                maximum_coverage = max(maximum_coverage, coverage)
                if frame_unresolved:
                    unresolved += 1
                    clean = frame
                elif np.any(mask):
                    clean = cv2.inpaint(frame, mask, 5, cv2.INPAINT_TELEA)
                    if previous_clean is not None and np.any(tracked_mask):
                        alpha = (tracked_mask.astype(np.float32) / 255.0 * 0.25)[..., None]
                        clean = np.clip(clean * (1.0 - alpha) + previous_clean * alpha, 0, 255).astype(np.uint8)
                else:
                    clean = frame
                if previous_clean is not None and previous_mask is not None:
                    common = np.maximum(mask, previous_mask) > 0
                    if np.any(common):
                        difference = cv2.absdiff(clean, previous_clean).mean(axis=2)
                        flicker_values.append(float(difference[common].mean()) / 255.0)
                remaining_boxes = paddle_boxes(ocr, clean, 0.58)
                if remaining_boxes and coverage <= 0.22:
                    second_pass_mask = expanded_text_mask(gray.shape, remaining_boxes)
                    combined_mask = np.maximum(mask, second_pass_mask)
                    combined_coverage = float(np.count_nonzero(combined_mask)) / float(combined_mask.size)
                    maximum_coverage = max(maximum_coverage, combined_coverage)
                    if combined_coverage > 0.22:
                        unresolved += 1
                        frame_unresolved = True
                    else:
                        clean = cv2.inpaint(clean, second_pass_mask, 7, cv2.INPAINT_TELEA)
                        mask = combined_mask
                        remaining_boxes = paddle_boxes(ocr, clean, 0.58)
                residual += len(remaining_boxes)
                writer.write(clean)
                processed += 1
                if processed == 1 or processed == total or processed % max(1, total // 20) == 0:
                    print(json.dumps({"event": "progress", "framesProcessed": processed, "totalFrames": total}), flush=True)
                previous_gray, previous_mask, previous_clean = gray, mask, clean
                # Admission requires every frame to be repairable and clean.
                # Once a frame still has text or exceeds the area limit, later
                # frames cannot change the final rejection, so fail fast.
                if remaining_boxes or frame_unresolved:
                    break
        finally:
            writer.release()
            capture.release()

        flicker = float(np.percentile(flicker_values, 95)) if flicker_values else 0.0
        failures = []
        if processed != total:
            failures.append("frame_count_mismatch")
        if residual:
            failures.append("residual_text_detected")
        if unresolved:
            failures.append("repair_area_too_large")
        if flicker > 0.08:
            failures.append("temporal_flicker")
        status = "passed" if not failures else "rejected"
        write_report(
            report_path,
            status=status,
            framesProcessed=processed,
            totalFrames=total,
            residualTextDetections=residual,
            unresolvedRegions=unresolved,
            maximumMaskCoverage=maximum_coverage,
            temporalFlickerScore=flicker,
            failures=failures,
        )
        if failures:
            raise SystemExit("cleanup_quality_gate_failed")
        subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", str(silent), "-i", str(source), "-map", "0:v:0", "-map", "1:a?",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", str(output),
        ], check=True)


if __name__ == "__main__":
    main()
