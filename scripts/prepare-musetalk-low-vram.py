#!/usr/bin/env python3
"""Prepare the pinned MuseTalk v1.5 checkout for an 8 GB CUDA worker.

The upstream checkpoint loader may restore CUDA-tagged tensors directly to the
GPU, temporarily holding both the 3.4 GB state dict and the fp16 module.  This
script applies one narrowly pinned source edit so deserialization happens on
CPU and the temporary state dict is released before moving the model to CUDA.

The operation is deliberately fail-closed: both the Git commit and the exact
target-file digest must be known before the file can be changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from typing import Literal


MUSE_TALK_COMMIT = "0a89dec45a0192b824e3cf4daf96c239440c5ed8"
TARGET_RELATIVE_PATH = Path("musetalk/models/unet.py")
EXPECTED_GIT_MODE = "100755"
UNPATCHED_SHA256 = "05d5dadfde2e726b61d8387a4876336d4dcacc696636e8dcfec69863ce819256"
PATCHED_SHA256 = "e245234f6620194deedc84a752b4da7fc21ddd4932d87f4137069bf35cdeb934"

UNPATCHED_BLOCK = """        weights = torch.load(model_path) if torch.cuda.is_available() else torch.load(model_path, map_location=self.device)
        self.model.load_state_dict(weights)
"""

PATCHED_BLOCK = """        # Always deserialize checkpoints on CPU. Some MuseTalk v1.5 checkpoints
        # retain CUDA storage tags; loading them directly onto an 8 GB GPU
        # duplicates the state dict and the module during the fp16 transfer.
        weights = torch.load(model_path, map_location="cpu")
        self.model.load_state_dict(weights)
        del weights
"""


class PreparationError(RuntimeError):
    """A version, source-pattern, or atomic-write safety check failed."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def rewrite_payload(
    payload: bytes,
    *,
    unpatched_sha256: str = UNPATCHED_SHA256,
    patched_sha256: str = PATCHED_SHA256,
) -> tuple[bytes, Literal["patched", "already_prepared"]]:
    """Return the exact known low-VRAM source or reject an unknown file."""

    digest = sha256_bytes(payload)
    try:
        source = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PreparationError("MuseTalk target is not valid UTF-8; refusing to modify") from error

    if digest == patched_sha256:
        if source.count(PATCHED_BLOCK) != 1 or UNPATCHED_BLOCK in source:
            raise PreparationError("known patched digest does not match the required loader pattern")
        return payload, "already_prepared"

    if digest != unpatched_sha256:
        raise PreparationError(
            f"unsupported MuseTalk unet.py sha256 {digest}; expected {unpatched_sha256} or {patched_sha256}"
        )
    if source.count(UNPATCHED_BLOCK) != 1 or PATCHED_BLOCK in source:
        raise PreparationError("known upstream file does not contain exactly one expected loader pattern")

    rewritten = source.replace(UNPATCHED_BLOCK, PATCHED_BLOCK, 1).encode("utf-8")
    actual = sha256_bytes(rewritten)
    if actual != patched_sha256:
        raise PreparationError(
            f"low-VRAM rewrite digest {actual} did not match pinned digest {patched_sha256}"
        )
    return rewritten, "patched"


def atomic_replace(target: Path, payload: bytes, original_mode: int) -> None:
    """Replace one regular file in-place without exposing a partial write."""

    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=f".{target.name}.lingshu-low-vram-",
            suffix=".tmp",
            dir=target.parent,
            delete=False,
        ) as handle:
            temporary_name = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, stat.S_IMODE(original_mode))
        os.replace(temporary_name, target)
        temporary_name = ""
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def prepare_target(
    target: Path,
    *,
    check_only: bool = False,
    unpatched_sha256: str = UNPATCHED_SHA256,
    patched_sha256: str = PATCHED_SHA256,
) -> dict[str, object]:
    if target.is_symlink() or not target.is_file():
        raise PreparationError("MuseTalk target must be an existing regular, non-symlink file")
    original = target.read_bytes()
    rewritten, status = rewrite_payload(
        original,
        unpatched_sha256=unpatched_sha256,
        patched_sha256=patched_sha256,
    )
    if check_only and status == "patched":
        raise PreparationError("known MuseTalk source still needs the low-VRAM patch")
    if status == "patched":
        mode = target.stat().st_mode
        atomic_replace(target, rewritten, mode)
        if target.read_bytes() != rewritten or sha256_bytes(target.read_bytes()) != patched_sha256:
            # Restore the known original rather than leaving an unverifiable
            # worker dependency behind. The caller still receives a failure.
            atomic_replace(target, original, mode)
            raise PreparationError("post-write verification failed; original MuseTalk source was restored")
    return {
        "ok": True,
        "status": status,
        "target": str(target),
        "sha256": patched_sha256 if status == "patched" else sha256_bytes(original),
    }


def git_output(repo: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repo), *arguments],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()[-400:]
        raise PreparationError(f"MuseTalk Git validation failed: {detail or completed.returncode}")
    return completed.stdout.strip()


def validate_checkout(repo: Path) -> Path:
    if repo.is_symlink() or not repo.is_dir():
        raise PreparationError("MuseTalk repository must be an existing, non-symlink directory")
    root = Path(git_output(repo, "rev-parse", "--show-toplevel")).resolve()
    if root != repo.resolve():
        raise PreparationError(f"--repo is not the MuseTalk checkout root: {root}")
    commit = git_output(repo, "rev-parse", "HEAD")
    if commit != MUSE_TALK_COMMIT:
        raise PreparationError(
            f"unsupported MuseTalk commit {commit}; expected {MUSE_TALK_COMMIT}; refusing to modify"
        )
    index = git_output(repo, "ls-files", "-s", TARGET_RELATIVE_PATH.as_posix()).split()
    if len(index) < 4 or index[0] != EXPECTED_GIT_MODE or index[3] != TARGET_RELATIVE_PATH.as_posix():
        raise PreparationError("MuseTalk target path or Git mode does not match the pinned v1.5 checkout")
    return repo / TARGET_RELATIVE_PATH


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Prepare pinned MuseTalk v1.5 for an 8 GB CUDA worker")
    result.add_argument("--repo", required=True, type=Path, help="MuseTalk Git checkout root")
    result.add_argument("--check", action="store_true", help="verify that the pinned low-VRAM patch is already present")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        repo = args.repo.expanduser().resolve()
        target = validate_checkout(repo)
        result = prepare_target(target, check_only=args.check)
        result.update({"commit": MUSE_TALK_COMMIT, "cudaAllocator": "expandable_segments:True"})
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
        return 0
    except (PreparationError, OSError, subprocess.SubprocessError) as error:
        print(
            json.dumps(
                {"ok": False, "error": str(error)[:800], "expectedCommit": MUSE_TALK_COMMIT},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
