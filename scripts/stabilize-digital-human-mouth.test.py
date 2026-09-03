#!/usr/bin/env python3
"""Focused deterministic tests for stabilize-digital-human-mouth.py."""

from __future__ import annotations

import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np


SCRIPT = Path(__file__).with_name("stabilize-digital-human-mouth.py")
SPEC = importlib.util.spec_from_file_location("stabilize_digital_human_mouth", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class WeightAndTemporalTests(unittest.TestCase):
    def test_weights_are_normalized_and_defaults_are_mode_specific(self) -> None:
        self.assertEqual(MODULE.parse_weights(None, "causal"), (0.15, 0.30, 0.55))
        self.assertEqual(MODULE.parse_weights(None, "centered"), (0.30, 0.40, 0.30))
        self.assertEqual(MODULE.parse_weights("1,2,1", "centered"), (0.25, 0.50, 0.25))
        with self.assertRaises(MODULE.StabilizationError):
            MODULE.parse_weights("0,0,0", "causal")
        with self.assertRaises(MODULE.StabilizationError):
            MODULE.parse_weights("1,2", "centered")
        self.assertEqual(
            MODULE.parse_weights(None, "centered", 5),
            (0.15, 0.20, 0.30, 0.20, 0.15),
        )
        with self.assertRaises(MODULE.StabilizationError):
            MODULE.parse_weights("1,2,3", "centered", 5)

    def test_centered_and_causal_three_frame_blends_are_distinct(self) -> None:
        patches = [np.full((2, 2, 3), value, dtype=np.uint8) for value in (0, 100, 200)]
        centered = MODULE.blend_temporal_patches(patches, "centered", (0.25, 0.50, 0.25))
        causal = MODULE.blend_temporal_patches(patches, "causal", (0.15, 0.30, 0.55))
        self.assertEqual(int(centered[1][0, 0, 0]), 100)
        self.assertEqual(int(causal[1][0, 0, 0]), 55)
        self.assertEqual(int(causal[2][0, 0, 0]), 140)

    def test_five_frame_centered_window_clamps_edges_and_blends_symmetrically(self) -> None:
        patches = [np.full((1, 1, 3), value, dtype=np.uint8) for value in (0, 50, 100, 150, 200)]
        weights = (0.15, 0.20, 0.30, 0.20, 0.15)
        blended = MODULE.blend_temporal_patches(patches, "centered", weights)
        self.assertEqual(MODULE.temporal_indices(0, 5, "centered", 5), (0, 0, 0, 1, 2))
        self.assertEqual(MODULE.temporal_indices(4, 5, "centered", 5), (2, 3, 4, 4, 4))
        self.assertEqual(int(blended[2][0, 0, 0]), 100)


class GeometryAndLocalityTests(unittest.TestCase):
    def geometry(self):
        return MODULE.build_mouth_transform(
            (70.0, 80.0), (130.0, 80.0), 200, 160, 120, 72,
            1.5, 0.8, 1.0, 10.0,
        )

    def test_mouth_transform_normalizes_corners_and_rejects_overflow(self) -> None:
        geometry = self.geometry()
        source = np.asarray([[[70.0, 80.0], [130.0, 80.0]]], dtype=np.float32)
        normalized = cv2.transform(source, geometry.forward)[0]
        self.assertLess(normalized[0, 0], normalized[1, 0])
        self.assertAlmostEqual(float(normalized[0, 1]), float(normalized[1, 1]), places=4)
        with self.assertRaises(MODULE.StabilizationError):
            MODULE.build_mouth_transform(
                (2.0, 4.0), (30.0, 4.0), 200, 160, 120, 72,
                2.0, 1.0, 1.0, 10.0,
            )

    def test_feathered_composite_changes_only_the_local_mask(self) -> None:
        frame = np.full((160, 200, 3), 20, dtype=np.uint8)
        geometry = self.geometry()
        patch = np.full((72, 120, 3), 220, dtype=np.uint8)
        mask = MODULE.feather_mask(120, 72, 0.25)
        result, coverage, outside_delta = MODULE.composite_local_patch(frame, patch, mask, geometry)
        self.assertGreater(int(np.max(result)), 20)
        self.assertLess(coverage, 0.20)
        self.assertEqual(outside_delta, 0)
        self.assertTrue(np.array_equal(result[0, 0], frame[0, 0]))

    def test_sharpen_is_single_pass_and_validates_kernel(self) -> None:
        patch = np.zeros((15, 15, 3), dtype=np.uint8)
        patch[7, 7] = 180
        sharpened = MODULE.sharpen_patch_once(patch, 0.7, 5)
        self.assertGreaterEqual(int(sharpened[7, 7, 0]), 180)
        with self.assertRaises(MODULE.StabilizationError):
            MODULE.sharpen_patch_once(patch, 0.7, 4)


class FailClosedTests(unittest.TestCase):
    def test_tracking_stats_exposes_any_contiguous_gap(self) -> None:
        stats = MODULE.TrackingStats()
        stats.detected(42.0)
        stats.missing()
        stats.missing(boundary_failure=True)
        stats.detected(43.0)
        audit = stats.audit()
        self.assertEqual(audit["maximumConsecutiveMissingFrames"], 2)
        self.assertEqual(audit["boundaryFailureFrames"], 1)
        self.assertLess(audit["detectionRate"], 1.0)

    def test_integrity_rejects_frame_duration_resolution_and_audio_changes(self) -> None:
        source = {
            "frameCount": 75, "durationSeconds": 3.0, "width": 1080, "height": 1920,
            "fps": 25.0, "videoCodec": "h264", "audioCodec": "aac",
        }
        valid = MODULE.validate_media_integrity(source, dict(source), 75, 25.0, 0.045, "a" * 64, "a" * 64)
        self.assertTrue(valid["passed"])
        changed = dict(source, frameCount=74, durationSeconds=3.2, width=720)
        invalid = MODULE.validate_media_integrity(source, changed, 75, 25.0, 0.045, "a" * 64, "b" * 64)
        self.assertFalse(invalid["passed"])
        self.assertGreaterEqual(len(invalid["failures"]), 4)

    def test_missing_input_emits_failed_audit_and_no_video(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "must-not-exist.mp4"
            audit_path = root / "audit.json"
            args = MODULE.build_parser().parse_args([
                "--input", str(root / "missing.mp4"),
                "--output", str(output),
                "--audit", str(audit_path),
            ])
            audit = MODULE.stabilize(args)
            persisted = json.loads(audit_path.read_text(encoding="utf-8"))
            self.assertFalse(audit["passed"])
            self.assertFalse(persisted["passed"])
            self.assertIn("does not exist", persisted["failures"][0])
            self.assertFalse(output.exists())

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg tools are required")
    def test_successful_cli_flow_writes_verified_h264_aac_and_v2_audit(self) -> None:
        class FakeFaceMesh:
            def __init__(self, **_kwargs):
                pass

            def process(self, _rgb):
                landmarks = [SimpleNamespace(x=0.5, y=0.5) for _ in range(478)]
                landmarks[MODULE.MOUTH_LEFT_INDEX] = SimpleNamespace(x=0.4, y=0.5)
                landmarks[MODULE.MOUTH_RIGHT_INDEX] = SimpleNamespace(x=0.6, y=0.5)
                return SimpleNamespace(multi_face_landmarks=[SimpleNamespace(landmark=landmarks)])

            def close(self):
                pass

        fake_mediapipe = SimpleNamespace(
            solutions=SimpleNamespace(face_mesh=SimpleNamespace(FaceMesh=FakeFaceMesh)),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            output = root / "output.mp4"
            audit_path = root / "audit.json"
            subprocess.run(
                [
                    shutil.which("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "color=c=gray:s=192x256:r=25:d=0.24",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=0.24",
                    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    str(source),
                ],
                check=True,
            )
            stdout = io.StringIO()
            with patch.dict(sys.modules, {"mediapipe": fake_mediapipe}), redirect_stdout(stdout):
                exit_code = MODULE.main([
                    "--input", str(source),
                    "--output", str(output),
                    "--audit", str(audit_path),
                    "--maximum-mask-fraction", "0.12",
                ])
            reported = json.loads(stdout.getvalue())
            persisted = json.loads(audit_path.read_text(encoding="utf-8"))
            self.assertEqual(exit_code, 0)
            self.assertTrue(output.is_file())
            self.assertTrue(reported["passed"])
            self.assertTrue(persisted["passed"])
            self.assertEqual(persisted["schemaVersion"], "digital-human-mouth-stabilization-audit-v2")
            self.assertEqual(persisted["parameters"]["minimumDetectionConfidence"], 0.5)
            self.assertEqual(persisted["parameters"]["minimumTrackingConfidence"], 0.5)
            self.assertEqual(persisted["tracking"]["detectionRate"], 1.0)
            self.assertEqual(persisted["tracking"]["maximumConsecutiveMissingFrames"], 0)
            self.assertEqual(persisted["integrity"]["inputFrameCount"], persisted["integrity"]["outputFrameCount"])
            self.assertTrue(persisted["integrity"]["audioPacketHashMatch"])
            self.assertEqual(persisted["output"]["videoCodec"], "h264")
            self.assertEqual(persisted["output"]["audioCodec"], "aac")
            self.assertEqual(len(persisted["input"]["sha256"]), 64)
            self.assertEqual(len(persisted["output"]["sha256"]), 64)


if __name__ == "__main__":
    unittest.main(verbosity=2)
