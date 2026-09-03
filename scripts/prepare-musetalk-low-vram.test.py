#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("prepare-musetalk-low-vram.py")
SPEC = importlib.util.spec_from_file_location("prepare_musetalk_low_vram", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class MuseTalkLowVramPreparationTests(unittest.TestCase):
    def fixture(self) -> tuple[bytes, bytes]:
        before = ("header\n" + MODULE.UNPATCHED_BLOCK + "footer\n").encode("utf-8")
        after = ("header\n" + MODULE.PATCHED_BLOCK + "footer\n").encode("utf-8")
        return before, after

    def test_known_source_is_rewritten_and_second_run_is_idempotent(self) -> None:
        before, after = self.fixture()
        rewritten, status = MODULE.rewrite_payload(
            before,
            unpatched_sha256=digest(before),
            patched_sha256=digest(after),
        )
        self.assertEqual((rewritten, status), (after, "patched"))
        unchanged, second_status = MODULE.rewrite_payload(
            rewritten,
            unpatched_sha256=digest(before),
            patched_sha256=digest(after),
        )
        self.assertEqual((unchanged, second_status), (after, "already_prepared"))

    def test_unknown_source_fails_closed_without_modifying_file(self) -> None:
        before, after = self.fixture()
        unknown = before.replace(b"torch.load(model_path)", b"torch.jit.load(model_path)")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "unet.py"
            target.write_bytes(unknown)
            with self.assertRaisesRegex(MODULE.PreparationError, "unsupported MuseTalk unet.py"):
                MODULE.prepare_target(
                    target,
                    unpatched_sha256=digest(before),
                    patched_sha256=digest(after),
                )
            self.assertEqual(target.read_bytes(), unknown)

    def test_check_mode_requires_patch_to_be_present(self) -> None:
        before, after = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "unet.py"
            target.write_bytes(before)
            with self.assertRaisesRegex(MODULE.PreparationError, "still needs the low-VRAM patch"):
                MODULE.prepare_target(
                    target,
                    check_only=True,
                    unpatched_sha256=digest(before),
                    patched_sha256=digest(after),
                )
            self.assertEqual(target.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
