#!/usr/bin/env python3
"""Fail-closed local Qwen3-TTS CustomVoice runner for LingShu.

The runner intentionally emits a single JSON result on its final stdout line.
All model/cache paths are supplied explicitly so production never downloads a
model into the web-server account's home directory by accident.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import contextlib
import fcntl
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from typing import Any, Iterator


MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
MODEL_LICENSE = "Apache-2.0"
LANGUAGES = {"zh": "Chinese", "en": "English", "es": "Spanish"}
LANGUAGE_ALIASES = {
    "chinese": "zh",
    "mandarin": "zh",
    "english": "en",
    "spanish": "es",
}
SPEAKERS = {
    "Vivian",
    "Serena",
    "Uncle_Fu",
    "Dylan",
    "Eric",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
}
REQUIRED_MODEL_FILES = (
    "config.json",
    "generation_config.json",
    "model.safetensors",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "speech_tokenizer/config.json",
    "speech_tokenizer/model.safetensors",
    "speech_tokenizer/preprocessor_config.json",
)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def append_shared_runtime(path: str) -> None:
    """Use an existing CUDA Torch runtime read-only without modifying it.

    The Qwen virtualenv remains the write target and takes precedence. This is
    useful on the 8 GB development machine; a production install may omit the
    setting after installing Torch and torchaudio into the isolated venv.
    """

    shared = str(path or "").strip()
    if not shared:
        return
    candidate = Path(shared)
    if not candidate.is_dir():
        raise RuntimeError(f"shared runtime directory does not exist: {shared}")
    sys.path.append(str(candidate))


def missing_model_files(model_dir: Path) -> list[str]:
    return [name for name in REQUIRED_MODEL_FILES if not (model_dir / name).is_file()]


def dtype_from_name(torch: Any, value: str) -> Any:
    normalized = str(value or "bfloat16").strip().lower()
    mapping = {
        "bfloat16": torch.bfloat16,
        "bf16": torch.bfloat16,
        "float16": torch.float16,
        "fp16": torch.float16,
        "float32": torch.float32,
        "fp32": torch.float32,
    }
    if normalized not in mapping:
        raise RuntimeError(f"unsupported dtype: {value}")
    return mapping[normalized]


def resolve_language(value: str) -> str:
    code = str(value or "").strip().lower().replace("_", "-").split("-", 1)[0]
    code = LANGUAGE_ALIASES.get(code, code)
    if code not in LANGUAGES:
        raise RuntimeError(f"unsupported local Qwen3-TTS language: {value}")
    return code


def resolve_request_text(text: str, text_base64: str) -> str:
    """Decode the ASCII-safe Windows -> WSL text transport.

    ``--text`` remains supported for direct/legacy callers. New callers should
    use ``--text-base64`` so wsl.exe never has to transport locale-sensitive
    Unicode arguments. The decoded value is deliberately never emitted.
    """

    legacy = str(text or "")
    encoded = str(text_base64 or "").strip()
    if legacy and encoded:
        raise RuntimeError("use either --text or --text-base64, not both")
    if not encoded:
        return legacy
    try:
        payload = base64.b64decode(encoded.encode("ascii"), validate=True)
        return payload.decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError, binascii.Error, ValueError) as error:
        raise RuntimeError("invalid --text-base64; expected strict base64-encoded UTF-8") from error


def validate_model_dir(model_dir: Path) -> None:
    if not model_dir.is_dir():
        raise RuntimeError(f"model directory does not exist: {model_dir}")
    missing = missing_model_files(model_dir)
    if missing:
        raise RuntimeError(f"model directory is incomplete: {', '.join(missing)}")


@contextlib.contextmanager
def exclusive_lock(lock_file: Path, timeout_seconds: float) -> Iterator[None]:
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    with lock_file.open("a+", encoding="utf-8") as handle:
        deadline = time.monotonic() + max(0.1, timeout_seconds)
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("local Qwen3-TTS is busy")
                time.sleep(0.2)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def wav_metrics(path: Path) -> dict[str, Any]:
    import numpy as np
    import soundfile as sf

    info = sf.info(str(path))
    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = np.mean(audio, axis=1)
    duration = float(len(audio)) / float(sample_rate or 1)
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    rms = float(np.sqrt(np.mean(np.square(audio)))) if len(audio) else 0.0
    finite = bool(np.isfinite(audio).all()) if len(audio) else False
    return {
        "duration": round(duration, 3),
        "sampleRate": int(info.samplerate),
        "channels": int(info.channels),
        "frames": int(info.frames),
        "peak": round(peak, 6),
        "rms": round(rms, 6),
        "finite": finite,
    }


def validate_wav(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size < 4_000:
        raise RuntimeError("Qwen3-TTS did not create a non-empty WAV")
    metrics = wav_metrics(path)
    if metrics["duration"] < 0.2:
        raise RuntimeError("Qwen3-TTS WAV is too short")
    if metrics["sampleRate"] != 24_000 or metrics["channels"] != 1:
        raise RuntimeError("Qwen3-TTS WAV must be 24 kHz mono")
    if not metrics["finite"] or metrics["peak"] < 0.001 or metrics["rms"] < 0.0001:
        raise RuntimeError("Qwen3-TTS WAV is silent or invalid")
    return metrics


def atempo_filter(value: float) -> str:
    remaining = max(0.25, min(4.0, value))
    stages: list[float] = []
    while remaining > 2.0:
        stages.append(2.0)
        remaining /= 2.0
    while remaining < 0.5:
        stages.append(0.5)
        remaining /= 0.5
    stages.append(remaining)
    return ",".join(f"atempo={stage:.8f}" for stage in stages)


def pitch_filter(semitones: float) -> str:
    ratio = 2.0 ** (max(-4.0, min(4.0, float(semitones))) / 12.0)
    return f"rubberband=pitch={ratio:.8f}:formant=preserved:pitchq=quality"


def parse_loudnorm_json(stderr: str) -> dict[str, Any]:
    blocks = re.findall(r"\{\s*\"input_i\"[\s\S]*?\}", str(stderr or ""))
    if not blocks:
        raise RuntimeError("ffmpeg loudnorm returned no measurement JSON")
    try:
        return json.loads(blocks[-1])
    except json.JSONDecodeError as error:
        raise RuntimeError("ffmpeg loudnorm returned invalid measurement JSON") from error


def loudnorm_number(stats: dict[str, Any], key: str) -> float:
    try:
        value = float(stats[key])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f"ffmpeg loudnorm measurement is missing {key}") from error
    if not math.isfinite(value):
        raise RuntimeError(f"ffmpeg loudnorm measurement is not finite: {key}")
    return value


def normalize_loudness(
    source: Path,
    destination: Path,
    ffmpeg: str,
    target_lufs: float,
    target_true_peak_db: float,
    target_lra: float,
) -> dict[str, Any]:
    target_lufs = max(-30.0, min(-12.0, float(target_lufs)))
    target_true_peak_db = max(-6.0, min(-0.5, float(target_true_peak_db)))
    target_lra = max(1.0, min(20.0, float(target_lra)))
    base_filter = f"loudnorm=I={target_lufs:.2f}:TP={target_true_peak_db:.2f}:LRA={target_lra:.2f}"
    measure = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-nostdin",
            "-i",
            str(source),
            "-af",
            f"{base_filter}:print_format=json",
            "-f",
            "null",
            os.devnull,
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if measure.returncode != 0:
        raise RuntimeError(f"ffmpeg loudness measurement failed: {measure.stderr[-240:]}")
    first = parse_loudnorm_json(measure.stderr)
    input_i = loudnorm_number(first, "input_i")
    input_tp = loudnorm_number(first, "input_tp")
    input_lra = loudnorm_number(first, "input_lra")
    input_thresh = loudnorm_number(first, "input_thresh")
    target_offset = loudnorm_number(first, "target_offset")
    second_filter = (
        f"{base_filter}:measured_I={input_i:.2f}:measured_TP={input_tp:.2f}"
        f":measured_LRA={input_lra:.2f}:measured_thresh={input_thresh:.2f}"
        f":offset={target_offset:.2f}:linear=true:print_format=json"
    )
    normalize = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-af",
            second_filter,
            "-ar",
            "24000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if normalize.returncode != 0:
        raise RuntimeError(f"ffmpeg loudness normalization failed: {normalize.stderr[-240:]}")
    second = parse_loudnorm_json(normalize.stderr)
    output_i = loudnorm_number(second, "output_i")
    output_tp = loudnorm_number(second, "output_tp")
    if abs(output_i - target_lufs) > 1.0:
        raise RuntimeError(f"normalized loudness {output_i:.2f} LUFS missed target {target_lufs:.2f} LUFS")
    if output_tp > target_true_peak_db + 0.3:
        raise RuntimeError(f"normalized true peak {output_tp:.2f} dBTP exceeds target {target_true_peak_db:.2f} dBTP")
    return {
        "standard": "EBU R128 two-pass",
        "targetIntegratedLufs": round(target_lufs, 2),
        "targetTruePeakDb": round(target_true_peak_db, 2),
        "targetLra": round(target_lra, 2),
        "inputIntegratedLufs": round(input_i, 2),
        "inputTruePeakDb": round(input_tp, 2),
        "outputIntegratedLufs": round(output_i, 2),
        "outputTruePeakDb": round(output_tp, 2),
    }


def fit_timing(
    source: Path,
    destination: Path,
    ffmpeg: str,
    speed: float,
    target_duration: float,
    target_lufs: float,
    target_true_peak_db: float,
    target_lra: float,
    pitch_semitones: float,
) -> tuple[dict[str, Any], float, bool, dict[str, Any]]:
    raw = validate_wav(source)
    requested_speed = max(0.75, min(1.35, float(speed or 1.0)))
    tempo = requested_speed
    target_applied = False
    pitch_semitones = max(-4.0, min(4.0, float(pitch_semitones or 0.0)))
    if target_duration > 0:
        ideal = float(raw["duration"]) / target_duration
        # Keep automatic time-stretching in a voice-safe range. Larger timing
        # mismatches must be repaired by copy editing, never by mangling speech.
        tempo = max(0.75, min(1.35, ideal))
        target_applied = True

    fd, timed_name = tempfile.mkstemp(prefix="qwen3-tts-timed-", suffix=".wav", dir=str(destination.parent))
    os.close(fd)
    timed_path = Path(timed_name)
    try:
        filters: list[str] = []
        if abs(tempo - 1.0) > 0.005:
            filters.append(atempo_filter(tempo))
        if abs(pitch_semitones) > 0.01:
            filters.append(pitch_filter(pitch_semitones))
        if not filters:
            shutil.copyfile(source, timed_path)
        else:
            command = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-i",
                str(source),
                "-af",
                ",".join(filters),
                "-ar",
                "24000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(timed_path),
            ]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
            if completed.returncode != 0:
                raise RuntimeError(f"ffmpeg timing fit failed: {completed.stderr[-240:]}")
        timed = validate_wav(timed_path)
        loudness = normalize_loudness(
            timed_path,
            destination,
            ffmpeg,
            target_lufs,
            target_true_peak_db,
            target_lra,
        )
    finally:
        with contextlib.suppress(OSError):
            timed_path.unlink()

    fitted = validate_wav(destination)
    if fitted["peak"] > 0.95:
        raise RuntimeError("normalized WAV exceeds the safe PCM peak ceiling")
    if abs(float(fitted["duration"]) - float(timed["duration"])) > 0.08:
        raise RuntimeError("loudness normalization changed audio duration")
    target_satisfied = bool(
        target_duration > 0
        and abs(float(fitted["duration"]) - target_duration) <= max(0.12, target_duration * 0.02)
    )
    return fitted, tempo, target_applied and target_satisfied, loudness


def load_runtime(shared_site_packages: str) -> tuple[Any, Any, Any]:
    append_shared_runtime(shared_site_packages)
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    return torch, sf, Qwen3TTSModel


def device_status(torch: Any, device: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "requested": device,
        "cudaAvailable": bool(torch.cuda.is_available()),
    }
    if torch.cuda.is_available():
        free_bytes, total_bytes = torch.cuda.mem_get_info(0)
        result.update(
            {
                "gpu": torch.cuda.get_device_name(0),
                "freeVramMb": round(free_bytes / 1024 / 1024),
                "totalVramMb": round(total_bytes / 1024 / 1024),
            }
        )
    return result


def synthesize_once(args: argparse.Namespace, device: str) -> dict[str, Any]:
    torch, sf, model_type = load_runtime(args.shared_site_packages)
    if device.startswith("cuda"):
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is unavailable")
        free_bytes, _ = torch.cuda.mem_get_info(0)
        free_mb = free_bytes / 1024 / 1024
        if free_mb < args.min_free_vram_mb:
            raise RuntimeError(
                f"GPU_BUSY: free VRAM {free_mb:.0f} MB is below required {args.min_free_vram_mb:.0f} MB"
            )

    dtype = dtype_from_name(torch, args.dtype)
    if device == "cpu" and dtype != torch.float32:
        dtype = torch.float32
    if device.startswith("cuda"):
        torch.cuda.reset_peak_memory_stats(0)
        torch.manual_seed(args.seed)
        torch.cuda.manual_seed_all(args.seed)

    started = time.monotonic()
    model = model_type.from_pretrained(
        str(args.model),
        device_map=device,
        dtype=dtype,
        attn_implementation=args.attention,
        local_files_only=True,
    )
    loaded = time.monotonic()
    wavs, sample_rate = model.generate_custom_voice(
        text=args.text,
        language=LANGUAGES[resolve_language(args.language)],
        speaker=args.speaker,
        do_sample=True,
        temperature=args.temperature,
        top_p=args.top_p,
        top_k=args.top_k,
        repetition_penalty=args.repetition_penalty,
        max_new_tokens=args.max_new_tokens,
    )
    generated = time.monotonic()

    destination = Path(args.output).expanduser().resolve()
    if destination.suffix.lower() != ".wav":
        raise RuntimeError("output must use the .wav extension")
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, raw_name = tempfile.mkstemp(prefix="qwen3-tts-", suffix=".wav", dir=str(destination.parent))
    os.close(fd)
    raw_path = Path(raw_name)
    try:
        sf.write(str(raw_path), wavs[0], sample_rate, subtype="PCM_16")
        metrics, applied_tempo, target_satisfied, loudness = fit_timing(
            raw_path,
            destination,
            args.ffmpeg,
            args.speed,
            args.target_duration,
            args.loudness_lufs,
            args.true_peak_db,
            args.loudness_range,
            args.pitch_semitones,
        )
    finally:
        with contextlib.suppress(OSError):
            raw_path.unlink()

    peak_gpu_mb = 0
    if device.startswith("cuda"):
        peak_gpu_mb = round(torch.cuda.max_memory_allocated(0) / 1024 / 1024)
    result = {
        "ok": True,
        "source": "qwen3_tts_local",
        "model": MODEL_ID,
        "modelPath": str(args.model),
        "license": MODEL_LICENSE,
        "speaker": args.speaker,
        "language": resolve_language(args.language),
        "device": device,
        "dtype": str(dtype).replace("torch.", ""),
        "output": str(destination),
        **metrics,
        "requestedTargetDuration": round(args.target_duration, 3) if args.target_duration > 0 else None,
        "targetDurationSatisfied": target_satisfied,
        "appliedTempo": round(applied_tempo, 5),
        "pitchAdjustmentSemitones": round(args.pitch_semitones, 3),
        "pitchProcessing": "rubberband_formant_preserved" if abs(args.pitch_semitones) > 0.01 else "none",
        "loudnessNormalization": loudness,
        "loadSeconds": round(loaded - started, 3),
        "generationSeconds": round(generated - loaded, 3),
        "totalSeconds": round(time.monotonic() - started, 3),
        "peakGpuMemoryMb": peak_gpu_mb,
    }
    del wavs, model
    gc.collect()
    if device.startswith("cuda"):
        torch.cuda.empty_cache()
    return result


def health(args: argparse.Namespace) -> dict[str, Any]:
    model_dir = Path(args.model).expanduser().resolve()
    missing = missing_model_files(model_dir) if model_dir.is_dir() else list(REQUIRED_MODEL_FILES)
    payload: dict[str, Any] = {
        "ok": False,
        "source": "qwen3_tts_local",
        "model": MODEL_ID,
        "modelPath": str(model_dir),
        "modelPresent": model_dir.is_dir() and not missing,
        "missingModelFiles": missing,
        "license": MODEL_LICENSE,
        "supportedLanguages": list(LANGUAGES),
        "speaker": args.speaker,
        "runtimeImportable": False,
        "loudnessNormalization": {
            "standard": "EBU R128 two-pass",
            "targetIntegratedLufs": round(args.loudness_lufs, 2),
            "targetTruePeakDb": round(args.true_peak_db, 2),
            "targetLra": round(args.loudness_range, 2),
        },
    }
    try:
        torch, _sf, _model_type = load_runtime(args.shared_site_packages)
        payload["runtimeImportable"] = True
        payload["torchVersion"] = str(torch.__version__)
        payload["device"] = device_status(torch, args.device)
        device_ready = args.device == "cpu" or bool(torch.cuda.is_available())
        payload["ok"] = bool(payload["modelPresent"] and device_ready)
    except Exception as error:  # fail closed and expose a bounded diagnostic
        payload["error"] = str(error)[:500]
    return payload


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Local Qwen3-TTS 0.6B CustomVoice runner")
    result.add_argument("--health", action="store_true")
    result.add_argument("--model", required=True, type=Path)
    result.add_argument("--text", default="")
    result.add_argument("--text-base64", default="")
    result.add_argument(
        "--text-transport-contract",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    result.add_argument("--language", default="zh")
    result.add_argument("--speaker", default="Ryan")
    result.add_argument("--output", default="")
    result.add_argument("--device", default="cuda:0")
    result.add_argument("--dtype", default="bfloat16")
    result.add_argument("--attention", choices=("eager", "sdpa"), default="sdpa")
    result.add_argument("--shared-site-packages", default="")
    result.add_argument("--ffmpeg", default="/usr/bin/ffmpeg")
    result.add_argument("--speed", type=float, default=1.0)
    result.add_argument("--target-duration", type=float, default=0.0)
    result.add_argument("--loudness-lufs", type=float, default=-18.0)
    result.add_argument("--true-peak-db", type=float, default=-1.5)
    result.add_argument("--loudness-range", type=float, default=7.0)
    result.add_argument("--pitch-semitones", type=float, default=0.0)
    result.add_argument("--min-free-vram-mb", type=float, default=4300.0)
    result.add_argument("--lock-file", type=Path, default=Path("/mnt/d/LINGSHU_models/qwen3-tts/inference.lock"))
    result.add_argument("--lock-timeout", type=float, default=3.0)
    result.add_argument("--allow-cpu-fallback", action="store_true")
    result.add_argument("--seed", type=int, default=20260903)
    result.add_argument("--temperature", type=float, default=0.85)
    result.add_argument("--top-p", type=float, default=0.9)
    result.add_argument("--top-k", type=int, default=50)
    result.add_argument("--repetition-penalty", type=float, default=1.05)
    result.add_argument("--max-new-tokens", type=int, default=2048)
    return result


def main() -> int:
    args = parser().parse_args()
    args.model = Path(args.model).expanduser().resolve()
    if args.speaker not in SPEAKERS:
        emit({"ok": False, "source": "qwen3_tts_local", "error": f"unsupported speaker: {args.speaker}"})
        return 2
    if args.health:
        payload = health(args)
        emit(payload)
        return 0 if payload.get("ok") else 2
    try:
        args.text = resolve_request_text(args.text, args.text_base64)
    except RuntimeError as error:
        emit({"ok": False, "source": "qwen3_tts_local", "error": str(error)})
        return 2
    if args.text_transport_contract:
        if not args.text.strip():
            emit({"ok": False, "source": "qwen3_tts_local", "error": "text is required"})
            return 2
        utf8 = args.text.encode("utf-8")
        emit(
            {
                "ok": True,
                "source": "qwen3_tts_local_text_transport",
                "characters": len(args.text),
                "utf8Bytes": len(utf8),
                "sha256": hashlib.sha256(utf8).hexdigest(),
            }
        )
        return 0
    if not args.text.strip() or not args.output:
        emit({"ok": False, "source": "qwen3_tts_local", "error": "text and output are required"})
        return 2

    try:
        validate_model_dir(args.model)
        resolve_language(args.language)
        ffmpeg = shutil.which(args.ffmpeg) if not Path(args.ffmpeg).is_file() else args.ffmpeg
        if not ffmpeg:
            raise RuntimeError(f"ffmpeg is unavailable: {args.ffmpeg}")
        args.ffmpeg = ffmpeg
        with exclusive_lock(args.lock_file, args.lock_timeout):
            try:
                result = synthesize_once(args, args.device)
            except RuntimeError as error:
                is_oom = "out of memory" in str(error).lower()
                if not (args.allow_cpu_fallback and args.device.startswith("cuda") and is_oom):
                    raise
                result = synthesize_once(args, "cpu")
                result["fallbackReason"] = "cuda_oom"
        emit(result)
        return 0
    except Exception as error:
        output = Path(args.output).expanduser() if args.output else None
        if output and output.exists():
            with contextlib.suppress(OSError):
                output.unlink()
        emit(
            {
                "ok": False,
                "source": "qwen3_tts_local",
                "error": str(error)[:1000],
                "errorType": type(error).__name__,
                "trace": traceback.format_exc(limit=4)[-2000:],
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
