#!/usr/bin/env python3
"""Deterministic synthetic-fixture tests for the performance observer."""
import importlib.util
import pathlib
import unittest

import cv2
import numpy as np

MODULE_PATH = pathlib.Path(__file__).with_name("validate-digital-human-performance.py")
SPEC = importlib.util.spec_from_file_location("performance_validator", MODULE_PATH)
validator = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(validator)


class PerformanceObserverFixtureTests(unittest.TestCase):
    def test_scene_cut_comes_from_pixels(self):
        dark = np.full((320, 180, 3), (20, 25, 35), dtype=np.uint8)
        bright = np.full((320, 180, 3), (220, 120, 30), dtype=np.uint8)
        signatures = [validator.frame_scene_signature(frame) for frame in (dark, dark, bright, bright)]
        changes, _ = validator.detect_scene_changes([0.0, 0.5, 1.0, 1.5], signatures)
        self.assertEqual(changes, [1.0])

    def test_static_span_resets_on_real_cut_and_motion(self):
        timestamps = [index * 0.5 for index in range(11)]
        moving = [False, False, False, False, True, False, False, False, False, False, False]
        eligible = [True] * len(timestamps)
        cuts = [False, False, False, False, False, False, False, True, False, False, False]
        self.assertAlmostEqual(validator.longest_static_span(timestamps, moving, eligible, cuts), 1.5)

    def test_observed_gesture_clustering_uses_pose_vectors(self):
        open_palm = np.asarray([0.0, 0.1, 0.1, 0.2, 0.0, 0.1, 0.1, 0.2, 0.5, 1, 1, 1, 1, 1, np.nan, np.nan, np.nan, np.nan, np.nan])
        open_palm_jitter = open_palm.copy()
        open_palm_jitter[:8] += 0.01
        count_three = open_palm.copy()
        count_three[9:14] = [0, 1, 1, 1, 0]
        self.assertEqual(validator.cluster_observed_states([open_palm, open_palm_jitter, count_three]), 2)

    def test_action_peaks_are_measured_not_manifest_claims(self):
        timestamps = [index * 0.25 for index in range(16)]
        strengths = [0.01, 0.02, 0.30, 0.02, 0.01, 0.02, 0.01, 0.28, 0.01, 0.01, 0.02, 0.01, 0.25, 0.01, 0.01, 0.01]
        peaks, threshold = validator.find_action_peaks(timestamps, strengths)
        self.assertEqual(peaks, [0.5, 1.75, 3.0])
        self.assertGreater(threshold, 0.03)

    def test_trajectory_descriptor_distinguishes_same_median_different_gesture(self):
        neutral = np.zeros(19, dtype=np.float32)
        raised = neutral.copy()
        raised[1] = -0.8
        side = neutral.copy()
        side[0] = 0.8
        records = []
        for beat, sequence in enumerate(([neutral, raised, neutral], [neutral, side, neutral])):
            for vector in sequence:
                records.append({"beat_index": beat, "presenter_expected": True, "action_signature": vector})
        medians = validator.median_vectors_by_beat(records, 2)
        trajectories = validator.trajectory_vectors_by_beat(records, 2)
        self.assertAlmostEqual(validator.nan_rms_distance(medians[0], medians[1]), 0.0)
        self.assertGreater(validator.nan_rms_distance(trajectories[0], trajectories[1]), 0.10)

    def test_trajectory_descriptor_skips_non_presenter_beat(self):
        vector = np.zeros(19, dtype=np.float32)
        records = [{"beat_index": 0, "presenter_expected": False, "action_signature": vector} for _ in range(4)]
        self.assertIsNone(validator.trajectory_vectors_by_beat(records, 1)[0])

    def test_gradual_camera_crop_counts_as_observed_composition(self):
        records = []
        for index in range(12):
            records.append({
                "timestamp": index * 0.25,
                "face_box": (0.5, 0.32, 0.12 + index * 0.005),
            })
        self.assertEqual(validator.count_face_composition_shifts(records, []), 1)

    def test_green_fringe_fixture_is_detected_only_when_applicable(self):
        frame = np.full((240, 160, 3), (35, 35, 35), dtype=np.uint8)
        cv2.rectangle(frame, (45, 35), (115, 205), (180, 180, 180), thickness=-1)
        cv2.rectangle(frame, (43, 33), (117, 207), (0, 220, 0), thickness=3)
        rate, green_pixels, edge_pixels = validator.green_edge_score(frame)
        self.assertGreater(green_pixels, 0)
        self.assertGreater(edge_pixels, green_pixels)
        self.assertGreater(rate, 0.025)
        applicable, _ = validator.infer_chroma_applicable({}, "no")
        self.assertFalse(applicable)

    def test_gate_requires_explicit_human_clearance(self):
        payload = {
            "schemaVersion": validator.SCHEMA_VERSION,
            "durationSeconds": 15.0,
            "ratio": "9:16",
            "semanticBeatCount": 3,
            "semanticBeatCountSource": "manifest_time_anchor",
            "sampledFrameCount": 120,
            "sceneSampleCount": 120,
            "presenterExpectedSampleCount": 100,
            "presenterDetectedSampleCount": 100,
            "poseSampleCount": 90,
            "observedDistinctGestureCount": 3,
            "observedExpressionChangeCount": 1,
            "observedAdjacentRepeatedActions": 0,
            "maximumNonMouthStaticSeconds": 2.5,
            "observedSceneOrCompositionCount": 3,
            "observedActionChangeCount": 2,
            "observedActionPeakCount": 3,
            "actionAlignmentObservationCount": 3,
            "actionAlignmentMaxMs": 500,
            "multipleFaceRate": 0.0,
            "missingPresenterFaceRate": 0.0,
            "identityGeometryOutlierRate": 0.01,
            "identityProxyStatus": "passed",
            "freezeSegments": 0,
            "handStructuralAnomalyDetected": False,
            "greenEdgeStatus": "not_applicable",
            "doubleMouthReview": "pending",
            "complexHandReview": "pending",
            "voiceMatchReview": "approved",
            "humanReviewRecordValid": True,
        }
        pending = validator.evaluate_gate_input(payload)
        self.assertTrue(pending["automated_passed"])
        self.assertFalse(pending["passed"])
        self.assertEqual(pending["validation_status"], "requires_human_review")
        self.assertEqual(len(pending["human_review_reasons"]), 2)
        payload.update({"doubleMouthReview": "approved", "complexHandReview": "approved"})
        approved = validator.evaluate_gate_input(payload)
        self.assertTrue(approved["passed"])


if __name__ == "__main__":
    unittest.main()
