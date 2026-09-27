#!/usr/bin/env python3
"""Run the official SyncNet face-track pipeline and enforce sync thresholds."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys


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
    shutil.rmtree(args.work_dir, ignore_errors=True)
    reference = "quality_gate"
    run([
        args.python,
        os.path.join(args.syncnet_dir, "run_pipeline.py"),
        "--videofile", args.video,
        "--data_dir", args.work_dir,
        "--reference", reference,
        "--min_track", "25",
        "--overwrite",
    ], args.syncnet_dir)
    output = run([
        args.python,
        os.path.join(args.syncnet_dir, "run_syncnet.py"),
        "--data_dir", args.work_dir,
        "--reference", reference,
        "--initial_model", model,
    ], args.syncnet_dir)
    offsets = [int(value) for value in re.findall(r"AV offset:\s*(-?\d+)", output)]
    confidences = [float(value) for value in re.findall(r"Confidence:\s*(-?\d+(?:\.\d+)?)", output)]
    if not offsets or not confidences:
        raise SystemExit("SyncNet did not return offset/confidence metrics")
    offset = offsets[0]
    confidence = confidences[0]
    failures = []
    if abs(offset) > args.max_offset:
        failures.append(f"absolute AV offset {abs(offset)} exceeds {args.max_offset} frames")
    if confidence < args.min_confidence:
        failures.append(f"SyncNet confidence {confidence:.3f} is below {args.min_confidence:.3f}")
    result = {
        "version": 1,
        "detector": "official_syncnet",
        "model_sha256": sha256(model),
        "passed": not failures,
        "av_offset_frames": offset,
        "av_offset_ms_at_25fps": offset * 40,
        "syncnet_confidence": round(confidence, 3),
        "thresholds": {
            "absolute_offset_frames_max": args.max_offset,
            "confidence_min": args.min_confidence,
        },
        "failures": failures,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    shutil.rmtree(args.work_dir, ignore_errors=True)
    return 2 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
