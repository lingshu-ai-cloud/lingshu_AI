from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


def load_validator_module():
    # The threshold evaluator is pure; production-only media dependencies are
    # stubbed so this unit test does not require the WSL validation runtime.
    for name in ("cv2", "mediapipe", "numpy", "soundfile"):
        sys.modules.setdefault(name, types.ModuleType(name))

    validator_path = Path(__file__).with_name("validate-digital-human.py")
    spec = importlib.util.spec_from_file_location("validate_digital_human", validator_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load validate-digital-human.py")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


validator = load_validator_module()


class MouthQualityRawThresholdTests(unittest.TestCase):
    def test_raw_jump_above_limit_fails_even_when_display_rounds_to_limit(self):
        reported, failures, _ = validator.evaluate_mouth_quality(0.08504, 0.09, 25.0)

        self.assertEqual(reported["mouth_jump_p95"], 0.085)
        self.assertIn("mouth motion contains excessive frame-to-frame jumps", failures)

    def test_raw_sharpness_below_limit_fails_even_when_display_rounds_to_limit(self):
        reported, failures, _ = validator.evaluate_mouth_quality(0.08, 0.09, 24.995)

        self.assertEqual(reported["mouth_sharpness_median"], 25.0)
        self.assertIn("mouth region is excessively blurred", failures)


if __name__ == "__main__":
    unittest.main()
