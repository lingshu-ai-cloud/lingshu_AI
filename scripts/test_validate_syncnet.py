"""Destructive-boundary tests; fake model bytes never run real inference."""

import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock


SCRIPT = Path(__file__).with_name("validate-syncnet.py")
spec = importlib.util.spec_from_file_location("validate_syncnet", SCRIPT)
validate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate)


class WorkDirectorySafetyTest(unittest.TestCase):
    def test_rejects_broad_roots_and_ambiguous_paths(self):
        cwd = os.getcwd()
        home = os.path.expanduser("~")
        for candidate in ("", " ", "/", home, cwd, os.path.dirname(cwd),
                          "relative/path", "~/scratch"):
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                validate.safe_work_parent(candidate)

    def test_rejects_symlink_components(self):
        with tempfile.TemporaryDirectory() as root:
            root = str(Path(root).resolve())
            target = Path(root) / "actual"
            target.mkdir()
            link = Path(root) / "link"
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                validate.safe_work_parent(str(link / "child"))

    def test_rejects_other_repository_root(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root).resolve() / "other-repo"
            repo.mkdir()
            (repo / ".git").mkdir()
            with self.assertRaisesRegex(ValueError, "repository root"):
                validate.safe_work_parent(str(repo))

    def test_only_created_child_is_deleted_and_existing_files_survive(self):
        with tempfile.TemporaryDirectory() as root:
            root = str(Path(root).resolve())
            model_dir = Path(root) / "model" / "data"
            model_dir.mkdir(parents=True)
            (model_dir / "syncnet_v2.model").write_bytes(b"fake-test-bytes")
            face_weights = model_dir.parent / "detectors" / "s3fd" / "weights"
            face_weights.mkdir(parents=True)
            (face_weights / "sfd_face.pth").write_bytes(b"fake-face-bytes")
            work = Path(root) / "existing-work"
            work.mkdir()
            marker = work / "keep.txt"
            marker.write_text("keep")
            seen = []

            def fake_run(command, cwd):
                child = Path(command[command.index("--data_dir") + 1])
                self.assertEqual(child.parent, work)
                self.assertTrue(child.is_dir())
                seen.append(child)
                if len(seen) == 1:
                    crops = child / "pycrop" / "quality_gate"
                    crops.mkdir(parents=True)
                    (crops / "00000.avi").write_bytes(b"fake-crop")
                return "AV offset: 0\nConfidence: 8.0" if len(seen) == 2 else ""

            argv = [str(SCRIPT), "--video", str(Path(root) / "fake.mp4"),
                    "--work-dir", str(work), "--syncnet-dir", str(model_dir.parent)]
            report = io.StringIO()
            with mock.patch.object(sys, "argv", argv), mock.patch.object(validate, "run", side_effect=fake_run), redirect_stdout(report):
                self.assertEqual(validate.main(), 2)
            self.assertIn('target_face_track_and_speech_window_unverified', report.getvalue())
            self.assertIn('face_detector_sha256', report.getvalue())
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(seen[0], seen[1])
            self.assertFalse(seen[0].exists())

    def test_multi_track_high_first_score_cannot_pass(self):
        with tempfile.TemporaryDirectory() as root:
            root = str(Path(root).resolve())
            model = Path(root) / "model"
            (model / "data").mkdir(parents=True)
            (model / "data" / "syncnet_v2.model").write_bytes(b"fixture")
            face = model / "detectors" / "s3fd" / "weights"
            face.mkdir(parents=True)
            (face / "sfd_face.pth").write_bytes(b"fixture")
            work = Path(root) / "work"

            def fake_run(command, cwd):
                child = Path(command[command.index("--data_dir") + 1])
                crops = child / "pycrop" / "quality_gate"
                crops.mkdir(parents=True, exist_ok=True)
                for index in range(2):
                    (crops / f"{index:05d}.avi").write_bytes(b"fixture")
                return "AV offset: 0\nConfidence: 9.0\nAV offset: 4\nConfidence: 2.0" if "run_syncnet.py" in command[1] else ""

            report = io.StringIO()
            argv = [str(SCRIPT), "--video", str(Path(root) / "fake.mp4"),
                    "--work-dir", str(work), "--syncnet-dir", str(model)]
            with mock.patch.object(sys, "argv", argv), mock.patch.object(validate, "run", side_effect=fake_run), redirect_stdout(report):
                self.assertEqual(validate.main(), 2)
            self.assertIn('multiple_face_tracks_unattributed', report.getvalue())
            self.assertIn('"observed_face_track_count": 2', report.getvalue())

    def test_failed_pipeline_still_preserves_existing_parent(self):
        with tempfile.TemporaryDirectory() as root:
            root = str(Path(root).resolve())
            model_dir = Path(root) / "model" / "data"
            model_dir.mkdir(parents=True)
            (model_dir / "syncnet_v2.model").write_bytes(b"fake-test-bytes")
            work = Path(root) / "existing-work"
            work.mkdir()
            marker = work / "keep.txt"
            marker.write_text("keep")
            seen = []

            def fail_run(command, cwd):
                seen.append(Path(command[command.index("--data_dir") + 1]))
                raise RuntimeError("mock pipeline failed")

            argv = [str(SCRIPT), "--video", str(Path(root) / "fake.mp4"),
                    "--work-dir", str(work), "--syncnet-dir", str(model_dir.parent)]
            with mock.patch.object(sys, "argv", argv), mock.patch.object(validate, "run", side_effect=fail_run):
                with self.assertRaisesRegex(RuntimeError, "mock pipeline failed"):
                    validate.main()
            self.assertEqual(marker.read_text(), "keep")
            self.assertFalse(seen[0].exists())


if __name__ == "__main__":
    unittest.main()
