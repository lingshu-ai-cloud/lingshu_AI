from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


def load_validator_module():
    # These optional runtime dependencies are exercised by the production WSL
    # validator. The strict threshold helper under test is intentionally pure.
    for name in ("cv2", "mediapipe", "numpy", "soundfile"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
    filename = Path(__file__).with_name("validate-digital-human.py")
    spec = importlib.util.spec_from_file_location("validate_digital_human", filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load validate-digital-human.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


validator = load_validator_module()


class MouthQualityStrictnessTests(unittest.TestCase):
    def test_exact_thresholds_pass(self):
        reported, failures, failure_codes = validator.evaluate_mouth_quality(
            validator.MOUTH_JUMP_P95_MAXIMUM,
            0.2,
            validator.MOUTH_SHARPNESS_MEDIAN_MINIMUM,
        )
        self.assertEqual(reported["mouth_jump_p95"], 0.085)
        self.assertEqual(reported["mouth_sharpness_median"], 25.0)
        self.assertEqual(failures, [])
        self.assertEqual(failure_codes, [])

    def test_unrounded_values_fail_even_when_report_rounds_to_thresholds(self):
        reported, failures, failure_codes = validator.evaluate_mouth_quality(
            0.08504,
            0.123456,
            24.999,
        )
        self.assertEqual(reported, {
            "mouth_jump_p95": 0.085,
            "mouth_jump_max": 0.1235,
            "mouth_sharpness_median": 25.0,
        })
        self.assertEqual(failures, [
            "mouth motion contains excessive frame-to-frame jumps",
            "mouth region is excessively blurred",
        ])
        self.assertEqual(failure_codes, [
            validator.MOUTH_JUMP_FAILURE_CODE,
            validator.MOUTH_SHARPNESS_FAILURE_CODE,
        ])

    def test_each_failure_code_is_independent(self):
        _, jump_failures, jump_codes = validator.evaluate_mouth_quality(0.086, 0.1, 25.0)
        self.assertEqual(jump_codes, [validator.MOUTH_JUMP_FAILURE_CODE])
        self.assertEqual(len(jump_failures), 1)

        _, sharpness_failures, sharpness_codes = validator.evaluate_mouth_quality(0.08, 0.1, 24.88)
        self.assertEqual(sharpness_codes, [validator.MOUTH_SHARPNESS_FAILURE_CODE])
        self.assertEqual(len(sharpness_failures), 1)


if __name__ == "__main__":
    unittest.main()
