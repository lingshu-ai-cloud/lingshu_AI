#!/usr/bin/env python3
"""Fail-closed, mouth-local temporal stabilization for digital-human clips.

The filter tracks one face on every frame, normalizes a mouth region from the
mouth corners, blends a configurable three- or five-frame window, sharpens that
patch once, and feathers only the mouth region back onto the untouched source frame.  The
original AAC packets are stream-copied into an H.264 MP4 and verified by hash.

This program is deliberately independent from the production Worker.  It is a
candidate post-processor whose audit is suitable for later receipt integration.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import cv2
import numpy as np


ALGORITHM_VERSION = "mouth-roi-temporal-stabilizer-v1"
AUDIT_SCHEMA_VERSION = "digital-human-mouth-stabilization-audit-v2"
MOUTH_LEFT_INDEX = 61
MOUTH_RIGHT_INDEX = 291
DEFAULT_CAUSAL_WEIGHTS = (0.15, 0.30, 0.55)  # t-2, t-1, t
DEFAULT_CENTERED_WEIGHTS = (0.30, 0.40, 0.30)  # t-1, t, t+1; validated EN slot-1 profile
DEFAULT_CAUSAL_WEIGHTS_5 = (0.08, 0.12, 0.18, 0.27, 0.35)  # t-4 .. t
DEFAULT_CENTERED_WEIGHTS_5 = (0.15, 0.20, 0.30, 0.20, 0.15)  # t-2 .. t+2


class StabilizationError(RuntimeError):
    """A fail-closed processing or integrity error."""


@dataclass(frozen=True)
class MouthTransform:
    forward: np.ndarray
    inverse: np.ndarray
    quad: np.ndarray
    mouth_width_pixels: float


@dataclass
class TrackingStats:
    total_frames: int = 0
    detected_frames: int = 0
    current_missing: int = 0
    max_consecutive_missing: int = 0
    missing_frames: int = 0
    multiple_face_frames: int = 0
    boundary_failure_frames: int = 0
    minimum_mouth_width_pixels: float | None = None
    maximum_mouth_width_pixels: float | None = None

    def detected(self, mouth_width_pixels: float) -> None:
        self.total_frames += 1
        self.detected_frames += 1
        self.current_missing = 0
        self.minimum_mouth_width_pixels = (
            mouth_width_pixels if self.minimum_mouth_width_pixels is None
            else min(self.minimum_mouth_width_pixels, mouth_width_pixels)
        )
        self.maximum_mouth_width_pixels = (
            mouth_width_pixels if self.maximum_mouth_width_pixels is None
            else max(self.maximum_mouth_width_pixels, mouth_width_pixels)
        )

    def missing(self, *, multiple_faces: bool = False, boundary_failure: bool = False) -> None:
        self.total_frames += 1
        self.missing_frames += 1
        self.current_missing += 1
        self.max_consecutive_missing = max(self.max_consecutive_missing, self.current_missing)
        if multiple_faces:
            self.multiple_face_frames += 1
        if boundary_failure:
            self.boundary_failure_frames += 1

    def audit(self) -> dict[str, Any]:
        return {
            "totalFrames": self.total_frames,
            "detectedFrames": self.detected_frames,
            "missingFrames": self.missing_frames,
            "detectionRate": round(self.detected_frames / max(1, self.total_frames), 6),
            "maximumConsecutiveMissingFrames": self.max_consecutive_missing,
            "multipleFaceFrames": self.multiple_face_frames,
            "boundaryFailureFrames": self.boundary_failure_frames,
            "minimumMouthWidthPixels": rounded(self.minimum_mouth_width_pixels),
            "maximumMouthWidthPixels": rounded(self.maximum_mouth_width_pixels),
        }


def rounded(value: float | None, digits: int = 6) -> float | None:
    return None if value is None or not math.isfinite(value) else round(float(value), digits)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_rate(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text or text == "N/A":
        return None
    try:
        if "/" in text:
            numerator, denominator = text.split("/", 1)
            denominator_value = float(denominator)
            return float(numerator) / denominator_value if denominator_value else None
        return float(text)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def finite_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def finite_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def parse_weights(value: str | None, mode: str, window_size: int = 3) -> tuple[float, ...]:
    if window_size not in (3, 5):
        raise StabilizationError("temporal window size must be 3 or 5")
    if value is None:
        if window_size == 3:
            return DEFAULT_CAUSAL_WEIGHTS if mode == "causal" else DEFAULT_CENTERED_WEIGHTS
        return DEFAULT_CAUSAL_WEIGHTS_5 if mode == "causal" else DEFAULT_CENTERED_WEIGHTS_5
    try:
        weights = tuple(float(item.strip()) for item in value.split(","))
    except ValueError as error:
        raise StabilizationError(f"weights must be {window_size} finite comma-separated numbers") from error
    if len(weights) != window_size or any(not math.isfinite(item) or item < 0 for item in weights):
        raise StabilizationError(f"weights must be {window_size} finite non-negative numbers")
    total = sum(weights)
    if total <= 0:
        raise StabilizationError("weights must have a positive sum")
    return tuple(item / total for item in weights)


def temporal_indices(index: int, count: int, mode: str, window_size: int = 3) -> tuple[int, ...]:
    if count <= 0 or index < 0 or index >= count:
        raise StabilizationError("temporal index is outside the patch sequence")
    if window_size not in (3, 5):
        raise StabilizationError("temporal window size must be 3 or 5")
    if mode == "causal":
        return tuple(max(0, index - offset) for offset in range(window_size - 1, -1, -1))
    if mode == "centered":
        radius = window_size // 2
        return tuple(min(count - 1, max(0, index + offset)) for offset in range(-radius, radius + 1))
    raise StabilizationError("temporal mode must be causal or centered")


def blend_temporal_patches(
    patches: Sequence[np.ndarray],
    mode: str,
    weights: tuple[float, ...],
) -> list[np.ndarray]:
    if not patches:
        raise StabilizationError("no normalized mouth patches were produced")
    shape = patches[0].shape
    if any(patch.shape != shape for patch in patches):
        raise StabilizationError("normalized mouth patches have inconsistent dimensions")
    output: list[np.ndarray] = []
    for index in range(len(patches)):
        indices = temporal_indices(index, len(patches), mode, len(weights))
        accumulator = np.zeros(shape, dtype=np.float32)
        for weight, patch_index in zip(weights, indices):
            accumulator += patches[patch_index].astype(np.float32) * float(weight)
        output.append(np.clip(np.rint(accumulator), 0, 255).astype(np.uint8))
    return output


def build_mouth_transform(
    left: tuple[float, float],
    right: tuple[float, float],
    frame_width: int,
    frame_height: int,
    canonical_width: int,
    canonical_height: int,
    roi_width_scale: float,
    roi_height_scale: float,
    boundary_margin_pixels: float,
    minimum_mouth_width_pixels: float,
) -> MouthTransform:
    left_point = np.asarray(left, dtype=np.float64)
    right_point = np.asarray(right, dtype=np.float64)
    axis = right_point - left_point
    mouth_width = float(np.linalg.norm(axis))
    if not math.isfinite(mouth_width) or mouth_width < minimum_mouth_width_pixels:
        raise StabilizationError("mouth width is below the tracking safety minimum")
    x_axis = axis / mouth_width
    y_axis = np.asarray((-x_axis[1], x_axis[0]), dtype=np.float64)
    center = (left_point + right_point) / 2.0
    half_width = mouth_width * roi_width_scale / 2.0
    half_height = mouth_width * roi_height_scale / 2.0
    top_left = center - x_axis * half_width - y_axis * half_height
    top_right = center + x_axis * half_width - y_axis * half_height
    bottom_left = center - x_axis * half_width + y_axis * half_height
    bottom_right = center + x_axis * half_width + y_axis * half_height
    quad = np.asarray((top_left, top_right, bottom_right, bottom_left), dtype=np.float32)
    minimum_x, minimum_y = float(np.min(quad[:, 0])), float(np.min(quad[:, 1]))
    maximum_x, maximum_y = float(np.max(quad[:, 0])), float(np.max(quad[:, 1]))
    if (
        minimum_x < boundary_margin_pixels
        or minimum_y < boundary_margin_pixels
        or maximum_x > frame_width - 1 - boundary_margin_pixels
        or maximum_y > frame_height - 1 - boundary_margin_pixels
    ):
        raise StabilizationError("normalized mouth ROI crosses the source-frame boundary")
    source = np.asarray((top_left, top_right, bottom_left), dtype=np.float32)
    destination = np.asarray(
        ((0, 0), (canonical_width - 1, 0), (0, canonical_height - 1)),
        dtype=np.float32,
    )
    forward = cv2.getAffineTransform(source, destination)
    inverse = cv2.invertAffineTransform(forward)
    if not np.all(np.isfinite(forward)) or not np.all(np.isfinite(inverse)):
        raise StabilizationError("mouth normalization transform is not finite")
    return MouthTransform(forward=forward, inverse=inverse, quad=quad, mouth_width_pixels=mouth_width)


def extract_normalized_patch(frame: np.ndarray, transform: MouthTransform, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    return cv2.warpAffine(
        frame,
        transform.forward,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def feather_mask(width: int, height: int, feather_fraction: float) -> np.ndarray:
    if width < 8 or height < 8:
        raise StabilizationError("canonical mouth dimensions are too small")
    if not 0 < feather_fraction < 0.5:
        raise StabilizationError("feather fraction must be between 0 and 0.5")
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    normalized_x = (xx - (width - 1) / 2) / max(1.0, width * 0.48)
    normalized_y = (yy - (height - 1) / 2) / max(1.0, height * 0.46)
    radius = np.sqrt(normalized_x * normalized_x + normalized_y * normalized_y)
    inner = 1.0 - feather_fraction
    alpha = np.clip((1.0 - radius) / max(1e-6, 1.0 - inner), 0.0, 1.0)
    alpha = alpha * alpha * (3.0 - 2.0 * alpha)
    return alpha.astype(np.float32)


def sharpen_patch_once(patch: np.ndarray, amount: float, kernel_size: int) -> np.ndarray:
    if not math.isfinite(amount) or amount < 0 or amount > 5:
        raise StabilizationError("local sharpen amount must be between 0 and 5")
    if kernel_size < 3 or kernel_size % 2 == 0:
        raise StabilizationError("local sharpen kernel must be an odd integer >= 3")
    if amount == 0:
        return patch.copy()
    blurred = cv2.GaussianBlur(patch, (kernel_size, kernel_size), 0)
    sharpened = patch.astype(np.float32) * (1.0 + amount) - blurred.astype(np.float32) * amount
    return np.clip(np.rint(sharpened), 0, 255).astype(np.uint8)


def composite_local_patch(
    frame: np.ndarray,
    patch: np.ndarray,
    canonical_mask: np.ndarray,
    transform: MouthTransform,
) -> tuple[np.ndarray, float, int]:
    height, width = frame.shape[:2]
    restored_patch = cv2.warpAffine(
        patch,
        transform.inverse,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    restored_alpha = cv2.warpAffine(
        canonical_mask,
        transform.inverse,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    restored_alpha = np.clip(restored_alpha, 0.0, 1.0)
    affected = restored_alpha > 1e-6
    result = frame.copy()
    if np.any(affected):
        alpha = restored_alpha[affected, None]
        blended = frame[affected].astype(np.float32) * (1.0 - alpha) + restored_patch[affected].astype(np.float32) * alpha
        result[affected] = np.clip(np.rint(blended), 0, 255).astype(np.uint8)
    outside = ~affected
    maximum_outside_delta = int(np.max(np.abs(result[outside].astype(np.int16) - frame[outside].astype(np.int16)))) if np.any(outside) else 0
    coverage = float(np.count_nonzero(affected) / max(1, width * height))
    return result, coverage, maximum_outside_delta


def ffprobe_media(path: Path, ffprobe: str) -> dict[str, Any]:
    command = [
        ffprobe,
        "-v", "error",
        "-count_frames",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration,nb_frames,nb_read_frames",
        "-of", "json",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise StabilizationError(f"ffprobe failed: {result.stderr.strip()[-1200:]}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise StabilizationError("ffprobe did not return valid JSON") from error
    streams = payload.get("streams") if isinstance(payload.get("streams"), list) else []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    if not isinstance(video, dict) or not isinstance(audio, dict):
        raise StabilizationError("input and output must each contain a video stream and an audio stream")
    frame_count = finite_int(video.get("nb_read_frames"))
    if frame_count is None:
        frame_count = finite_int(video.get("nb_frames"))
    return {
        "durationSeconds": finite_float((payload.get("format") or {}).get("duration")),
        "videoDurationSeconds": finite_float(video.get("duration")),
        "audioDurationSeconds": finite_float(audio.get("duration")),
        "videoCodec": str(video.get("codec_name") or ""),
        "audioCodec": str(audio.get("codec_name") or ""),
        "width": finite_int(video.get("width")),
        "height": finite_int(video.get("height")),
        "fps": parse_rate(video.get("avg_frame_rate")),
        "frameCount": frame_count,
    }


def audio_packet_sha256(path: Path, ffmpeg: str) -> str:
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-map", "0:a:0", "-c:a", "copy", "-f", "adts", "pipe:1"],
        capture_output=True,
        check=False,
    )
    if result.returncode or not result.stdout:
        message = result.stderr.decode("utf-8", errors="replace").strip()[-1200:]
        raise StabilizationError(f"unable to hash AAC packets: {message}")
    return hashlib.sha256(result.stdout).hexdigest()


def validate_media_integrity(
    input_probe: dict[str, Any],
    output_probe: dict[str, Any],
    decoded_frame_count: int,
    fps: float,
    duration_tolerance_seconds: float,
    input_audio_sha256: str,
    output_audio_sha256: str,
) -> dict[str, Any]:
    failures: list[str] = []
    if input_probe.get("frameCount") != decoded_frame_count:
        failures.append("input ffprobe frame count does not equal the fully decoded frame count")
    if output_probe.get("frameCount") != decoded_frame_count:
        failures.append("output frame count changed")
    if output_probe.get("width") != input_probe.get("width") or output_probe.get("height") != input_probe.get("height"):
        failures.append("output resolution changed")
    output_fps = finite_float(output_probe.get("fps"))
    if output_fps is None or abs(output_fps - fps) > 0.001:
        failures.append("output frame rate changed")
    if output_probe.get("videoCodec") != "h264":
        failures.append("output video codec is not H.264")
    if output_probe.get("audioCodec") != "aac":
        failures.append("output audio codec is not AAC")
    input_duration = finite_float(input_probe.get("durationSeconds"))
    output_duration = finite_float(output_probe.get("durationSeconds"))
    duration_delta = None if input_duration is None or output_duration is None else abs(output_duration - input_duration)
    if duration_delta is None or duration_delta > duration_tolerance_seconds:
        failures.append("output duration changed beyond the configured tolerance")
    audio_hash_match = bool(input_audio_sha256 and input_audio_sha256 == output_audio_sha256)
    if not audio_hash_match:
        failures.append("output AAC packet hash differs from the input")
    return {
        "passed": not failures,
        "failures": failures,
        "decodedFrameCount": decoded_frame_count,
        "inputFrameCount": input_probe.get("frameCount"),
        "outputFrameCount": output_probe.get("frameCount"),
        "inputDurationSeconds": input_duration,
        "outputDurationSeconds": output_duration,
        "durationDeltaSeconds": rounded(duration_delta),
        "durationToleranceSeconds": rounded(duration_tolerance_seconds),
        "fpsPreserved": output_fps is not None and abs(output_fps - fps) <= 0.001,
        "resolutionPreserved": output_probe.get("width") == input_probe.get("width") and output_probe.get("height") == input_probe.get("height"),
        "inputAudioPacketSha256": input_audio_sha256,
        "outputAudioPacketSha256": output_audio_sha256,
        "audioPacketHashMatch": audio_hash_match,
    }


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def run_ffmpeg_writer(
    input_path: Path,
    temporary_output: Path,
    frames: Iterable[np.ndarray],
    width: int,
    height: int,
    fps: float,
    ffmpeg: str,
    preset: str,
    crf: int,
) -> int:
    command = [
        ffmpeg,
        "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s:v", f"{width}x{height}", "-r", f"{fps:.10f}", "-i", "pipe:0",
        "-i", str(input_path),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart",
        str(temporary_output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    written_frames = 0
    try:
        assert process.stdin is not None
        for frame in frames:
            if frame.shape != (height, width, 3) or frame.dtype != np.uint8:
                raise StabilizationError("output frame shape or dtype changed")
            process.stdin.write(frame.tobytes())
            written_frames += 1
        if written_frames == 0:
            raise StabilizationError("there are no output frames")
        process.stdin.close()
        process.stdin = None
        _, stderr = process.communicate()
    except Exception:
        process.kill()
        process.wait()
        raise
    if process.returncode:
        raise StabilizationError(f"ffmpeg encode/mux failed: {stderr.decode('utf-8', errors='replace').strip()[-1600:]}")
    if not temporary_output.is_file() or temporary_output.stat().st_size < 1024:
        raise StabilizationError("ffmpeg did not create a usable output")
    return written_frames


def stabilize(args: argparse.Namespace) -> dict[str, Any]:
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    audit_path = Path(args.audit).expanduser().resolve() if args.audit else Path(f"{output_path}.mouth-stabilization.json")
    weights = parse_weights(args.weights, args.mode, args.window_size)
    parameters = {
        "mode": args.mode,
        "windowSize": args.window_size,
        "weights": list(weights),
        "canonicalWidth": args.canonical_width,
        "canonicalHeight": args.canonical_height,
        "roiWidthScale": args.roi_width_scale,
        "roiHeightScale": args.roi_height_scale,
        "featherFraction": args.feather,
        "localSharpenAmount": args.sharpen,
        "localSharpenKernel": args.sharpen_kernel,
        "minimumMouthWidthPixels": args.minimum_mouth_width,
        "minimumDetectionConfidence": args.minimum_detection_confidence,
        "minimumTrackingConfidence": args.minimum_tracking_confidence,
        "boundaryMarginPixels": args.boundary_margin,
        "maximumMaskFraction": args.maximum_mask_fraction,
        "durationToleranceMilliseconds": args.duration_tolerance_ms,
        "encoder": {"codec": "libx264", "preset": args.preset, "crf": args.crf, "pixelFormat": "yuv420p"},
        "audio": {"codec": "copy", "requiredInputCodec": "aac"},
    }
    audit: dict[str, Any] = {
        "schemaVersion": AUDIT_SCHEMA_VERSION,
        "algorithmVersion": ALGORITHM_VERSION,
        "passed": False,
        "parameters": parameters,
        "input": {"path": str(input_path)},
        "output": {"path": str(output_path)},
        "tracking": None,
        "locality": None,
        "integrity": None,
        "failures": [],
    }
    temporary_output: Path | None = None
    face_mesh: Any | None = None
    tracking = TrackingStats()
    try:
        if not input_path.is_file():
            raise StabilizationError("input video does not exist")
        if input_path == output_path:
            raise StabilizationError("input and output paths must differ")
        if output_path.exists() and not args.overwrite:
            raise StabilizationError("output already exists; pass --overwrite to replace it")
        if shutil.which(args.ffmpeg) is None or shutil.which(args.ffprobe) is None:
            raise StabilizationError("ffmpeg and ffprobe must be installed or supplied explicitly")
        for name, value, minimum in (
            ("canonical width", args.canonical_width, 32),
            ("canonical height", args.canonical_height, 24),
        ):
            if value < minimum:
                raise StabilizationError(f"{name} is below the safety minimum")
        if args.roi_width_scale <= 1 or args.roi_height_scale <= 0:
            raise StabilizationError("mouth ROI scales are invalid")
        if not 0 < args.maximum_mask_fraction <= 0.2:
            raise StabilizationError("maximum mask fraction must be in (0, 0.2]")

        input_sha256 = sha256_file(input_path)
        input_probe = ffprobe_media(input_path, args.ffprobe)
        if input_probe.get("audioCodec") != "aac":
            raise StabilizationError("input audio must be AAC so packets can be copied losslessly")
        input_audio_sha256 = audio_packet_sha256(input_path, args.ffmpeg)
        audit["input"] = {**audit["input"], "sha256": input_sha256, **input_probe, "audioPacketSha256": input_audio_sha256}

        capture = cv2.VideoCapture(str(input_path))
        if not capture.isOpened():
            raise StabilizationError("OpenCV cannot open the input video")
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        declared_frames = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0))
        frame_width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0))
        frame_height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0))
        if fps <= 0 or frame_width <= 0 or frame_height <= 0 or declared_frames <= 0:
            capture.release()
            raise StabilizationError("input video metadata is invalid")

        # Lazy import keeps pure helper tests independent of MediaPipe startup.
        import mediapipe as mp  # pylint: disable=import-outside-toplevel

        face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=args.minimum_detection_confidence,
            min_tracking_confidence=args.minimum_tracking_confidence,
        )
        transforms: list[MouthTransform | None] = []
        patches: list[np.ndarray | None] = []
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                result = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                faces = list(result.multi_face_landmarks or [])
                if len(faces) != 1:
                    tracking.missing(multiple_faces=len(faces) > 1)
                    transforms.append(None)
                    patches.append(None)
                    continue
                landmarks = faces[0].landmark
                left = landmarks[MOUTH_LEFT_INDEX]
                right = landmarks[MOUTH_RIGHT_INDEX]
                try:
                    transform = build_mouth_transform(
                        (left.x * frame_width, left.y * frame_height),
                        (right.x * frame_width, right.y * frame_height),
                        frame_width,
                        frame_height,
                        args.canonical_width,
                        args.canonical_height,
                        args.roi_width_scale,
                        args.roi_height_scale,
                        args.boundary_margin,
                        args.minimum_mouth_width,
                    )
                    patch = extract_normalized_patch(frame, transform, (args.canonical_width, args.canonical_height))
                except StabilizationError:
                    tracking.missing(boundary_failure=True)
                    transforms.append(None)
                    patches.append(None)
                    continue
                tracking.detected(transform.mouth_width_pixels)
                transforms.append(transform)
                patches.append(patch)
        finally:
            capture.release()
            face_mesh.close()
            face_mesh = None

        audit["tracking"] = tracking.audit()
        if tracking.total_frames != declared_frames:
            raise StabilizationError("fully decoded input frame count differs from the declared frame count")
        if tracking.missing_frames or tracking.max_consecutive_missing:
            raise StabilizationError("face/mouth tracking was not continuous on every frame")
        if tracking.boundary_failure_frames:
            raise StabilizationError("one or more mouth ROIs crossed a frame boundary")
        if any(item is None for item in transforms) or any(item is None for item in patches):
            raise StabilizationError("mouth tracking evidence is incomplete")

        normalized_patches = [item for item in patches if item is not None]
        blended_patches = blend_temporal_patches(normalized_patches, args.mode, weights)
        processed_patches = [sharpen_patch_once(item, args.sharpen, args.sharpen_kernel) for item in blended_patches]
        canonical_alpha = feather_mask(args.canonical_width, args.canonical_height, args.feather)

        mask_coverages: list[float] = []
        maximum_outside_delta = [0]
        second_decode_count = [0]

        # Only normalized mouth patches are retained in memory. Full-resolution
        # frames are composited and streamed directly to ffmpeg, keeping memory
        # bounded for production-length clips.
        def composited_frames() -> Iterable[np.ndarray]:
            capture = cv2.VideoCapture(str(input_path))
            if not capture.isOpened():
                raise StabilizationError("OpenCV cannot open the input video for the render pass")
            try:
                while True:
                    ok, frame = capture.read()
                    if not ok:
                        break
                    frame_index = second_decode_count[0]
                    if frame_index >= len(processed_patches):
                        raise StabilizationError("second decode produced more frames than tracking")
                    processed, coverage, outside_delta = composite_local_patch(
                        frame,
                        processed_patches[frame_index],
                        canonical_alpha,
                        transforms[frame_index],  # type: ignore[arg-type]
                    )
                    mask_coverages.append(coverage)
                    maximum_outside_delta[0] = max(maximum_outside_delta[0], outside_delta)
                    second_decode_count[0] += 1
                    if coverage > args.maximum_mask_fraction:
                        raise StabilizationError("mouth mask coverage exceeds the configured local-only limit")
                    if outside_delta != 0:
                        raise StabilizationError("pixels outside the mouth mask changed before encoding")
                    yield processed
            finally:
                capture.release()

        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_output = output_path.with_name(f".{output_path.stem}.{uuid.uuid4().hex}.part{output_path.suffix or '.mp4'}")
        written_frames = run_ffmpeg_writer(
            input_path,
            temporary_output,
            composited_frames(),
            frame_width,
            frame_height,
            fps,
            args.ffmpeg,
            args.preset,
            args.crf,
        )
        if second_decode_count[0] != tracking.total_frames or written_frames != tracking.total_frames:
            raise StabilizationError("second decode frame count differs from the tracking pass")
        maximum_mask_coverage = max(mask_coverages, default=0.0)
        audit["locality"] = {
            "meanMaskCoverageFraction": rounded(float(np.mean(mask_coverages)) if mask_coverages else 0.0),
            "maximumMaskCoverageFraction": rounded(maximum_mask_coverage),
            "maximumAllowedMaskCoverageFraction": args.maximum_mask_fraction,
            "maximumOutsideMaskPixelDeltaBeforeEncoding": maximum_outside_delta[0],
            "fullFrameTemporalFilterApplied": False,
            "localSharpenPasses": 1,
            "fullResolutionFramesBuffered": 0,
        }
        if maximum_mask_coverage > args.maximum_mask_fraction:
            raise StabilizationError("mouth mask coverage exceeds the configured local-only limit")
        if maximum_outside_delta[0] != 0:
            raise StabilizationError("pixels outside the mouth mask changed before encoding")
        output_probe = ffprobe_media(temporary_output, args.ffprobe)
        output_audio_sha256 = audio_packet_sha256(temporary_output, args.ffmpeg)
        duration_tolerance_seconds = max(0.0, args.duration_tolerance_ms / 1000.0)
        integrity = validate_media_integrity(
            input_probe,
            output_probe,
            tracking.total_frames,
            fps,
            duration_tolerance_seconds,
            input_audio_sha256,
            output_audio_sha256,
        )
        audit["integrity"] = integrity
        if not integrity["passed"]:
            raise StabilizationError("; ".join(integrity["failures"]))
        output_sha256 = sha256_file(temporary_output)
        os.replace(temporary_output, output_path)
        temporary_output = None
        audit["output"] = {**audit["output"], "sha256": output_sha256, **output_probe, "audioPacketSha256": output_audio_sha256}
        audit["passed"] = True
        audit["failures"] = []
    except Exception as error:  # Always leave machine-readable fail-closed evidence.
        if temporary_output is not None:
            temporary_output.unlink(missing_ok=True)
        message = str(error) if isinstance(error, Exception) else repr(error)
        audit["passed"] = False
        audit["failures"] = [message or error.__class__.__name__]
    finally:
        if face_mesh is not None:
            face_mesh.close()
        write_json_atomic(audit_path, audit)
    return audit


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Input MP4 containing H.264/AAC")
    parser.add_argument("--output", required=True, help="Output H.264/AAC MP4")
    parser.add_argument("--audit", help="Audit JSON path; defaults next to output")
    parser.add_argument("--mode", choices=("causal", "centered"), default="centered")
    parser.add_argument("--window-size", type=int, choices=(3, 5), default=3)
    parser.add_argument("--weights", help="Comma-separated weights matching --window-size, ordered oldest to newest")
    parser.add_argument("--canonical-width", type=int, default=256)
    parser.add_argument("--canonical-height", type=int, default=144)
    parser.add_argument("--roi-width-scale", type=float, default=1.85)
    parser.add_argument("--roi-height-scale", type=float, default=1.05)
    parser.add_argument("--feather", type=float, default=0.28)
    parser.add_argument("--sharpen", type=float, default=2.50)
    parser.add_argument("--sharpen-kernel", type=int, default=5)
    parser.add_argument("--minimum-mouth-width", type=float, default=12.0)
    parser.add_argument("--boundary-margin", type=float, default=1.0)
    parser.add_argument("--maximum-mask-fraction", type=float, default=0.08)
    parser.add_argument("--minimum-detection-confidence", type=float, default=0.5)
    parser.add_argument("--minimum-tracking-confidence", type=float, default=0.5)
    parser.add_argument("--duration-tolerance-ms", type=float, default=45.0)
    parser.add_argument("--preset", choices=("veryfast", "faster", "fast", "medium", "slow"), default="medium")
    parser.add_argument("--crf", type=int, choices=range(0, 36), default=18)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--overwrite", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    audit = stabilize(args)
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    return 0 if audit.get("passed") is True else 2


if __name__ == "__main__":
    sys.exit(main())
