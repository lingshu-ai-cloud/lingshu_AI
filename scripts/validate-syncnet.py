#!/usr/bin/env python3
"""Run the official SyncNet face-track pipeline and enforce sync thresholds."""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile


def safe_work_parent(raw: str) -> str:
    """Validate a caller-owned parent; only a fresh child may be deleted."""
    if not raw or not raw.strip() or not os.path.isabs(raw) or "~" in raw.split(os.sep):
        raise ValueError("SyncNet work directory must be a non-empty absolute path")
    target = os.path.abspath(raw)
    home = os.path.abspath(os.path.expanduser("~"))
    cwd = os.path.abspath(os.getcwd())
    # A workspace root (or any ancestor of one) must never be used as a
    # scratch parent. Subdirectories within it remain allowed.
    for protected in (home, cwd):
        if os.path.commonpath((target, protected)) == target:
            raise ValueError("SyncNet work directory is a protected root")
    if target == os.path.abspath(os.sep):
        raise ValueError("SyncNet work directory is a filesystem root")
    if os.path.exists(os.path.join(target, ".git")):
        raise ValueError("SyncNet work directory is a repository root")
    current = os.path.abspath(os.sep)
    for part in target.split(os.sep)[1:]:
        current = os.path.join(current, part)
        if os.path.islink(current):
            raise ValueError("SyncNet work directory contains a symbolic link")
    if os.path.exists(target) and not os.path.isdir(target):
        raise ValueError("SyncNet work directory is not a directory")
    return target


def run(command: list[str], cwd: str) -> str:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    output = result.stdout + "\n" + result.stderr
    if result.returncode:
        raise RuntimeError(output.strip())
    return output


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def observed_track_metrics(output: str, work_dir: str, reference: str) -> tuple[list[int], list[float], list[str]]:
    """Never promote the first face track into a target-presenter verdict."""
    offsets = [int(value) for value in re.findall(r"AV offset:\s*(-?\d+)", output)]
    confidences = [float(value) for value in re.findall(r"Confidence:\s*(-?\d+(?:\.\d+)?)", output)]
    crops = sorted(glob.glob(os.path.join(work_dir, "pycrop", reference, "0*.avi")))
    if not offsets or len(offsets) != len(confidences) or len(offsets) != len(crops):
        raise RuntimeError("SyncNet face-track metrics or crop inventory is incomplete")
    return offsets, confidences, crops


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--syncnet-dir", default="/syncnet_python")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--min-confidence", type=float, default=3.0)
    parser.add_argument("--max-offset", type=int, default=3)
    args = parser.parse_args()

    model = os.path.join(args.syncnet_dir, "data", "syncnet_v2.model")
    if not os.path.isfile(model):
        raise SystemExit("SyncNet checkpoint is not installed: " + model)
    work_parent = safe_work_parent(args.work_dir)
    os.makedirs(work_parent, mode=0o700, exist_ok=True)
    safe_work_parent(work_parent)
    # Never remove a pre-existing caller path. The pipeline only sees a
    # per-invocation child created here, whose exact path is cleaned below.
    work_dir = tempfile.mkdtemp(prefix="syncnet-qa-", dir=work_parent)
    created = os.lstat(work_dir)
    reference = "quality_gate"
    try:
        run([
            args.python,
            os.path.join(args.syncnet_dir, "run_pipeline.py"),
            "--videofile", args.video,
            "--data_dir", work_dir,
            "--reference", reference,
            "--min_track", "25",
            "--overwrite",
        ], args.syncnet_dir)
        output = run([
            args.python,
            os.path.join(args.syncnet_dir, "run_syncnet.py"),
            "--data_dir", work_dir,
            "--reference", reference,
            "--initial_model", model,
        ], args.syncnet_dir)
        offsets, confidences, crops = observed_track_metrics(output, work_dir, reference)
        face_model = os.path.join(args.syncnet_dir, "detectors", "s3fd", "weights", "sfd_face.pth")
        if not os.path.isfile(face_model):
            raise RuntimeError("SyncNet face detector checkpoint is not installed")
        face_model_sha256 = sha256(face_model)
    finally:
        current = os.lstat(work_dir)
        if (current.st_dev, current.st_ino) != (created.st_dev, created.st_ino) or not stat.S_ISDIR(current.st_mode):
            raise RuntimeError("SyncNet temporary directory changed; refusing cleanup")
        shutil.rmtree(work_dir)
    # The official pipeline does not bind a face track to the enrolled presenter
    # or attest full coverage of the frozen speech window. Even one high-scoring
    # track is only an observation, never an automatic commercial QA pass.
    offset = offsets[0] if len(offsets) == 1 else None
    confidence = confidences[0] if len(confidences) == 1 else None
    failures = ["target_face_track_and_speech_window_unverified"]
    if len(crops) != 1:
        failures.append("multiple_face_tracks_unattributed")
    if offset is not None and abs(offset) > args.max_offset:
        failures.append(f"absolute AV offset {abs(offset)} exceeds {args.max_offset} frames")
    if confidence is not None and confidence < args.min_confidence:
        failures.append(f"SyncNet confidence {confidence:.3f} is below {args.min_confidence:.3f}")
    result = {
        "version": 1,
        "detector": "official_syncnet",
        "model_sha256": sha256(model),
        "passed": False,
        "av_offset_frames": offset,
        "av_offset_ms_at_25fps": offset * 40 if offset is not None else None,
        "syncnet_confidence": round(confidence, 3) if confidence is not None else None,
        "face_detector_sha256": face_model_sha256,
        "observed_face_track_count": len(crops),
        "thresholds": {
            "absolute_offset_frames_max": args.max_offset,
            "confidence_min": args.min_confidence,
        },
        "failures": failures,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2


if __name__ == "__main__":
    sys.exit(main())
