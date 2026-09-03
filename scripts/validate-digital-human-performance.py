#!/usr/bin/env python3
"""Measure performance quality on the rendered 15-second digital-human film.

The manifest supplies semantic time anchors only. Visual claims are measured from
decoded frames. Double-mouth and complex finger geometry are never auto-cleared;
they remain explicit human-review requirements.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Any, Sequence

import cv2
import numpy as np

SCHEMA_VERSION = "digital-human-performance-observation-v2"
GATE_VERSION = "performance-gate-v2"
VALIDATOR_VERSION = "2.0.0"
SAMPLE_FPS = 8.0
MAX_STATIC_SECONDS = 4.0
MAX_ALIGNMENT_MS = 900
MAX_MULTIPLE_FACE_RATE = 0.01
MAX_MISSING_FACE_RATE = 0.05
MAX_IDENTITY_OUTLIER_RATE = 0.08
MAX_IDENTITY_DISTANCE_P95 = 0.085
MAX_GREEN_EDGE_RATE = 0.025


@dataclass(frozen=True)
class SceneSignature:
    histogram: np.ndarray
    luminance: np.ndarray


def finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def rounded(value: float | None, digits: int = 5) -> float | None:
    return None if value is None or not math.isfinite(value) else round(float(value), digits)


def frame_scene_signature(frame: np.ndarray) -> SceneSignature:
    small = cv2.resize(frame, (96, 160), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], None, [18, 8], [0, 180, 0, 256])
    histogram = cv2.normalize(histogram, None).reshape(-1).astype(np.float32)
    luminance = cv2.resize(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (24, 40), interpolation=cv2.INTER_AREA)
    return SceneSignature(histogram, luminance.astype(np.float32) / 255.0)


def scene_signature_distance(left: SceneSignature, right: SceneSignature) -> tuple[float, float, float]:
    hist = float(cv2.compareHist(left.histogram, right.histogram, cv2.HISTCMP_BHATTACHARYYA))
    luma = float(np.mean(np.abs(left.luminance - right.luminance)))
    return 0.62 * hist + 0.38 * luma, hist, luma


def is_scene_change(left: SceneSignature | None, right: SceneSignature) -> tuple[bool, float]:
    if left is None:
        return False, 0.0
    combined, hist, luma = scene_signature_distance(left, right)
    return ((hist >= 0.22 and luma >= 0.07) or luma >= 0.18), combined


def detect_scene_changes(timestamps: Sequence[float], signatures: Sequence[SceneSignature], debounce: float = 0.65) -> tuple[list[float], list[float]]:
    changes: list[float] = []
    scores: list[float] = [0.0]
    last_change = -1e9
    for index in range(1, min(len(timestamps), len(signatures))):
        changed, score = is_scene_change(signatures[index - 1], signatures[index])
        scores.append(score)
        if changed and timestamps[index] - last_change >= debounce:
            changes.append(float(timestamps[index]))
            last_change = float(timestamps[index])
    return changes, scores


def nan_rms_distance(left: np.ndarray | None, right: np.ndarray | None) -> float | None:
    if left is None or right is None or left.shape != right.shape:
        return None
    valid = np.isfinite(left) & np.isfinite(right)
    if int(np.count_nonzero(valid)) < 4:
        return None
    return float(np.sqrt(np.mean(np.square(left[valid] - right[valid]))))


def nanmedian_vector(vectors: Sequence[np.ndarray]) -> np.ndarray:
    stack = np.stack(vectors)
    output = np.full(stack.shape[1], np.nan, dtype=np.float32)
    for index in range(stack.shape[1]):
        values = stack[:, index]
        values = values[np.isfinite(values)]
        if len(values):
            output[index] = float(np.median(values))
    return output


def cluster_observed_states(vectors: Sequence[np.ndarray], threshold: float = 0.18) -> int:
    centers: list[np.ndarray] = []
    members: list[list[np.ndarray]] = []
    for vector in vectors:
        distances = [nan_rms_distance(vector, center) for center in centers]
        valid = [(index, value) for index, value in enumerate(distances) if value is not None]
        best = min(valid, key=lambda item: item[1]) if valid else None
        if best is None or best[1] >= threshold:
            centers.append(vector.copy())
            members.append([vector.copy()])
        else:
            members[best[0]].append(vector.copy())
            centers[best[0]] = nanmedian_vector(members[best[0]])
    return len(centers)


def find_action_peaks(timestamps: Sequence[float], strengths: Sequence[float], separation: float = 0.6) -> tuple[list[float], float]:
    if not strengths:
        return [], 0.035
    values = np.asarray(strengths, dtype=np.float32)
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    threshold = max(0.035, median + max(2.5 * mad, 0.018))
    candidates: list[tuple[float, float]] = []
    for index, value in enumerate(values):
        left = values[index - 1] if index else -float("inf")
        right = values[index + 1] if index + 1 < len(values) else -float("inf")
        if value >= threshold and value >= left and value > right:
            candidates.append((float(timestamps[index]), float(value)))
    selected: list[tuple[float, float]] = []
    for candidate in sorted(candidates, key=lambda item: (-item[1], item[0])):
        if all(abs(candidate[0] - existing[0]) >= separation for existing in selected):
            selected.append(candidate)
    return [item[0] for item in sorted(selected)], threshold


def longest_static_span(timestamps: Sequence[float], moving: Sequence[bool], eligible: Sequence[bool], cuts: Sequence[bool]) -> float:
    if len(timestamps) < 2:
        return 0.0
    nominal = float(np.median(np.diff(np.asarray(timestamps))))
    longest = run = 0.0
    for index in range(1, min(len(timestamps), len(moving), len(eligible), len(cuts))):
        interval = max(0.0, float(timestamps[index] - timestamps[index - 1]))
        if eligible[index] and eligible[index - 1] and not cuts[index] and interval <= max(0.5, nominal * 1.8) and not moving[index]:
            run += interval
            longest = max(longest, run)
        else:
            run = 0.0
    return longest


def count_freeze_segments(timestamps: Sequence[float], differences: Sequence[float], threshold: float = 0.10, minimum: float = 0.5) -> tuple[int, float]:
    count = 0
    longest = run = 0.0
    active = False
    for index in range(1, min(len(timestamps), len(differences) + 1)):
        if differences[index - 1] <= threshold:
            run += max(0.0, timestamps[index] - timestamps[index - 1])
            longest = max(longest, run)
            if run >= minimum and not active:
                count += 1
                active = True
        else:
            run = 0.0
            active = False
    return count, longest


def green_edge_score(frame: np.ndarray, roi_mask: np.ndarray | None = None) -> tuple[float, int, int]:
    b, g, r = cv2.split(frame)
    green = ((g.astype(np.int16) - np.maximum(r, b).astype(np.int16)) >= 24) & (g >= 70)
    edges = cv2.Canny(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 60, 150) > 0
    kernel = np.ones((3, 3), dtype=np.uint8)
    near_edge = cv2.dilate(edges.astype(np.uint8), kernel, iterations=1) > 0
    candidate = green & near_edge & (cv2.dilate((~green).astype(np.uint8), kernel, iterations=1) > 0)
    if roi_mask is not None:
        usable = roi_mask.astype(bool)
        candidate &= usable
        near_edge &= usable
    edges_count = int(np.count_nonzero(near_edge))
    green_count = int(np.count_nonzero(candidate))
    return green_count / max(1, edges_count), green_count, edges_count


def beat_index(beats: Sequence[dict[str, Any]], timestamp: float) -> int:
    for index, beat in enumerate(beats):
        if float(beat.get("startMs", 0)) / 1000 <= timestamp < float(beat.get("endMs", 0)) / 1000:
            return index
    return max(0, len(beats) - 1)


def presenter_expected(beats: Sequence[dict[str, Any]], index: int) -> bool:
    if not beats:
        return True
    beat = beats[max(0, min(index, len(beats) - 1))]
    if "presenterExpected" in beat:
        return bool(beat["presenterExpected"])
    kind = str(beat.get("sourceType", beat.get("visualType", "digital_human"))).lower()
    return kind not in {"broll", "b-roll", "material", "product_only", "scene_only"}


def count_face_composition_shifts(records: Sequence[dict[str, Any]], scene_changes: Sequence[float]) -> int:
    """Count gradual camera/crop changes within hard-cut-delimited segments."""
    boundaries = [-float("inf"), *scene_changes, float("inf")]
    shifts = 0
    for start, end in zip(boundaries, boundaries[1:]):
        boxes = [record["face_box"] for record in records if start <= record["timestamp"] < end and record.get("face_box") is not None]
        if len(boxes) < 8:
            continue
        window = max(3, len(boxes) // 4)
        first = np.median(np.asarray(boxes[:window]), axis=0)
        last = np.median(np.asarray(boxes[-window:]), axis=0)
        center_shift = math.dist((float(first[0]), float(first[1])), (float(last[0]), float(last[1])))
        size_ratio = max(float(first[2]), float(last[2])) / max(1e-6, min(float(first[2]), float(last[2])))
        if center_shift >= 0.08 or size_ratio >= 1.22:
            shifts += 1
    return shifts


def infer_chroma_applicable(manifest: dict[str, Any], override: str) -> tuple[bool, str]:
    if override in {"yes", "no"}:
        return override == "yes", "cli"
    for key in ("chromaKeyExpected", "usesChromaKey", "greenScreenExpected"):
        if key in manifest:
            return bool(manifest[key]), f"manifest.{key}"
    pipeline = manifest.get("pipeline") if isinstance(manifest.get("pipeline"), dict) else {}
    for key in ("chromaKeyExpected", "usesChromaKey", "greenScreenExpected"):
        if key in pipeline:
            return bool(pipeline[key]), f"manifest.pipeline.{key}"
    return False, "not_declared"


def review_decision(review: dict[str, Any], key: str) -> str:
    raw = review.get(key, "pending")
    raw = raw.get("decision", "pending") if isinstance(raw, dict) else raw
    value = str(raw).strip().lower()
    value = {"pass": "approved", "passed": "approved", "fail": "rejected", "failed": "rejected"}.get(value, value)
    return value if value in {"approved", "rejected", "pending"} else "pending"


def face_geometry_signature(landmarks: Sequence[Any]) -> np.ndarray | None:
    indices = [10, 152, 234, 454, 127, 356, 33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 98, 327]
    points = np.asarray([[landmarks[index].x, landmarks[index].y] for index in indices], dtype=np.float32)
    left_eye, right_eye = (points[6] + points[7]) / 2, (points[8] + points[9]) / 2
    eye_vector = right_eye - left_eye
    scale = float(np.linalg.norm(eye_vector))
    if scale < 1e-4:
        return None
    angle = -math.atan2(float(eye_vector[1]), float(eye_vector[0]))
    rotation = np.asarray([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]], dtype=np.float32)
    return (((points - (left_eye + right_eye) / 2) @ rotation.T) / scale).reshape(-1)


def expression_signature(landmarks: Sequence[Any]) -> np.ndarray:
    face_width = max(1e-6, abs(landmarks[454].x - landmarks[234].x))
    return np.asarray([abs(landmarks[a].y - landmarks[b].y) / face_width for a, b in ((105, 159), (334, 386), (159, 145), (386, 374))], dtype=np.float32)


def finger_extensions(landmarks: Sequence[Any]) -> list[float]:
    output: list[float] = []
    for base, joint, tip in ((1, 2, 4), (5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20)):
        left = np.asarray([landmarks[base].x - landmarks[joint].x, landmarks[base].y - landmarks[joint].y])
        right = np.asarray([landmarks[tip].x - landmarks[joint].x, landmarks[tip].y - landmarks[joint].y])
        denominator = max(1e-8, float(np.linalg.norm(left) * np.linalg.norm(right)))
        angle = math.degrees(math.acos(float(np.clip(np.dot(left, right) / denominator, -1, 1))))
        output.append(1.0 if angle >= 145 else 0.0)
    return output


def action_signature(pose_result: Any, hand_result: Any) -> tuple[np.ndarray | None, int]:
    values = np.full(19, np.nan, dtype=np.float32)
    pose_landmarks = getattr(getattr(pose_result, "pose_landmarks", None), "landmark", None)
    if pose_landmarks:
        left, right = pose_landmarks[11], pose_landmarks[12]
        scale = math.dist((left.x, left.y), (right.x, right.y))
        if scale >= 0.02 and min(left.visibility, right.visibility) >= 0.35:
            origin_x, origin_y = (left.x + right.x) / 2, (left.y + right.y) / 2
            cursor = 0
            for index in (13, 15, 14, 16):
                landmark = pose_landmarks[index]
                if landmark.visibility >= 0.35:
                    values[cursor] = np.clip((landmark.x - origin_x) / scale / 3, -1.5, 1.5)
                    values[cursor + 1] = np.clip((landmark.y - origin_y) / scale / 3, -1.5, 1.5)
                cursor += 2
    hands = getattr(hand_result, "multi_hand_landmarks", None) or []
    handedness = getattr(hand_result, "multi_handedness", None) or []
    values[8] = min(4, len(hands)) / 2
    next_unlabelled = 9
    for index, hand in enumerate(hands[:4]):
        label = handedness[index].classification[0].label if index < len(handedness) and handedness[index].classification else ""
        slot = {"Left": 9, "Right": 14}.get(label, next_unlabelled)
        if slot + 5 <= len(values):
            values[slot : slot + 5] = finger_extensions(hand.landmark)
        if not label:
            next_unlabelled = 14
    return (values if np.count_nonzero(np.isfinite(values)) >= 4 else None), len(hands)


def presenter_mask(width: int, height: int, face: Any | None, pose_result: Any) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    boxes: list[tuple[float, float, float, float]] = []
    if face is not None:
        xs, ys = [p.x for p in face.landmark], [p.y for p in face.landmark]
        face_width, face_height = max(0.05, max(xs) - min(xs)), max(0.05, max(ys) - min(ys))
        center_x = (min(xs) + max(xs)) / 2
        boxes.append((max(0, center_x - face_width * 1.9), max(0, min(ys) - face_height * 0.4), min(1, center_x + face_width * 1.9), min(1, max(ys) + face_height * 4.6)))
    landmarks = getattr(getattr(pose_result, "pose_landmarks", None), "landmark", None)
    if landmarks:
        visible = [point for point in landmarks if point.visibility >= 0.4]
        if visible:
            xs, ys = [p.x for p in visible], [p.y for p in visible]
            boxes.append((max(0, min(xs) - 0.08), max(0, min(ys) - 0.08), min(1, max(xs) + 0.08), min(1, max(ys) + 0.08)))
    if not boxes:
        mask[:, :] = 1
    else:
        x1, y1 = int(min(b[0] for b in boxes) * width), int(min(b[1] for b in boxes) * height)
        x2, y2 = int(max(b[2] for b in boxes) * width), int(max(b[3] for b in boxes) * height)
        cv2.rectangle(mask, (x1, y1), (x2, y2), 1, thickness=-1)
    if face is not None:
        mouth = [face.landmark[index] for index in (61, 291, 0, 17, 13, 14, 78, 308)]
        x1, x2 = int(max(0, min(p.x for p in mouth) - 0.035) * width), int(min(1, max(p.x for p in mouth) + 0.035) * width)
        y1, y2 = int(max(0, min(p.y for p in mouth) - 0.028) * height), int(min(1, max(p.y for p in mouth) + 0.035) * height)
        cv2.rectangle(mask, (x1, y1), (x2, y2), 0, thickness=-1)
    return mask


def median_vectors_by_beat(records: Sequence[dict[str, Any]], beat_count: int) -> list[np.ndarray | None]:
    output: list[np.ndarray | None] = []
    for index in range(beat_count):
        vectors = [record["action_signature"] for record in records if record["beat_index"] == index and record["action_signature"] is not None]
        output.append(nanmedian_vector(vectors) if vectors else None)
    return output


def trajectory_vectors_by_beat(records: Sequence[dict[str, Any]], beat_count: int) -> list[np.ndarray | None]:
    """Describe the observed gesture over time instead of reducing it to one pose.

    Two shots can share a neutral median pose while containing clearly different
    gestures (for example, a raised-palm hook versus a two-hand explanation).
    The descriptor retains the median pose, movement range and start-to-end
    direction, so the adjacent-shot gate measures the performed trajectory.
    """
    output: list[np.ndarray | None] = []
    for index in range(beat_count):
        vectors = [record["action_signature"] for record in records
                   if record["beat_index"] == index and record["presenter_expected"]
                   and record["action_signature"] is not None]
        if len(vectors) < 3:
            output.append(None)
            continue
        stack = np.stack(vectors)
        median = nanmedian_vector(vectors)
        low = np.nanpercentile(stack, 15, axis=0)
        high = np.nanpercentile(stack, 85, axis=0)
        movement_range = high - low
        edge = max(1, min(3, len(vectors) // 4))
        start = nanmedian_vector(vectors[:edge])
        end = nanmedian_vector(vectors[-edge:])
        direction = end - start
        output.append(np.concatenate((median, movement_range, direction)).astype(np.float32))
    return output


def evaluate_gate_input(gate_input: dict[str, Any]) -> dict[str, Any]:
    """Fail closed; thresholds mirror the TypeScript production gate."""
    failures: list[str] = []
    review_reasons: list[str] = []
    checks: list[dict[str, Any]] = []

    def check(identifier: str, passed: bool, message: str, source: str = "observed_video") -> None:
        checks.append({"id": identifier, "status": "passed" if passed else "failed", "source": source, "message": message})
        if not passed:
            failures.append(message)

    numeric = [
        "durationSeconds", "semanticBeatCount", "sampledFrameCount", "sceneSampleCount",
        "presenterExpectedSampleCount", "presenterDetectedSampleCount", "poseSampleCount",
        "observedDistinctGestureCount", "observedExpressionChangeCount", "observedAdjacentRepeatedActions",
        "maximumNonMouthStaticSeconds", "observedSceneOrCompositionCount", "observedActionChangeCount",
        "observedActionPeakCount", "actionAlignmentObservationCount", "multipleFaceRate",
        "missingPresenterFaceRate", "identityGeometryOutlierRate", "freezeSegments",
    ]
    missing = [key for key in numeric if not finite(gate_input.get(key))]
    if gate_input.get("schemaVersion") != SCHEMA_VERSION:
        failures.append("表现力报告 schema 版本缺失或不受支持")
    if missing:
        failures.append("表现力报告缺少必填实测字段: " + ", ".join(missing))
    else:
        check("duration", 14.5 <= gate_input["durationSeconds"] <= 15.5, "成片时长不在15秒验收容差内")
        check("semantic_beats", gate_input["semanticBeatCount"] >= 3, "语义段落少于3个", "manifest_time_anchor")
        check("sample_coverage", gate_input["sampledFrameCount"] >= 60 and gate_input["sceneSampleCount"] >= 60, "视频实测采样覆盖不足")
        expected = max(1, gate_input["presenterExpectedSampleCount"])
        check("face_coverage", gate_input["presenterDetectedSampleCount"] / expected >= 0.95, "人物应出现区间的人脸实测覆盖不足")
        check("pose_coverage", gate_input["poseSampleCount"] / expected >= 0.35, "动作姿态实测覆盖不足")
        check("gestures", gate_input["observedDistinctGestureCount"] >= 2, "实测明确不同的手势少于2种")
        check("expression", gate_input["observedExpressionChangeCount"] >= 1, "未实测到自然可见的非嘴部表情变化")
        check("adjacent_actions", gate_input["observedAdjacentRepeatedActions"] == 0, "相邻分镜实测为重复动作")
        check("static_span", gate_input["maximumNonMouthStaticSeconds"] <= MAX_STATIC_SECONDS, "连续非嘴部静止超过4秒")
        check("composition", gate_input["observedSceneOrCompositionCount"] >= 2, "实测场景或构图少于2种")
        check("action_changes", gate_input["observedActionChangeCount"] >= 1, "未实测到明确动作状态变化")
        check("action_peaks", gate_input["observedActionPeakCount"] >= 2, "实测有效动作峰值少于2次")
        alignment = gate_input.get("actionAlignmentMaxMs")
        check("action_alignment", finite(alignment) and gate_input["actionAlignmentObservationCount"] >= 2 and alignment <= MAX_ALIGNMENT_MS, "实测动作峰值与台词语义锚点不同步")
        check("multiple_faces", gate_input["multipleFaceRate"] <= MAX_MULTIPLE_FACE_RATE, "多脸帧比例超过门槛")
        check("missing_faces", gate_input["missingPresenterFaceRate"] <= MAX_MISSING_FACE_RATE, "人物应出现区间的人脸跟踪不稳定")
        if gate_input.get("identityProxyStatus") == "unavailable":
            review_reasons.append("身份稳定代理不可用，需人工复核")
        else:
            check("identity_proxy", gate_input.get("identityProxyStatus") == "passed" and gate_input["identityGeometryOutlierRate"] <= MAX_IDENTITY_OUTLIER_RATE, "人脸几何身份稳定代理未通过")
        check("freeze", gate_input["freezeSegments"] == 0, "检测到卡帧区间")
        check("hand_structure", gate_input.get("handStructuralAnomalyDetected") is False, "检测到手部数量或时序结构异常")
        check("green_edge", gate_input.get("greenEdgeStatus") in {"passed", "not_applicable"}, "绿边检测失败或在适用场景不可用")
        check("ratio", gate_input.get("ratio") == "9:16", "输出构图不是9:16")
    malformed: list[str] = []
    if not isinstance(gate_input.get("ratio"), str):
        malformed.append("ratio")
    if gate_input.get("identityProxyStatus") not in {"passed", "failed", "unavailable"}:
        malformed.append("identityProxyStatus")
    if gate_input.get("greenEdgeStatus") not in {"passed", "failed", "not_applicable", "unavailable"}:
        malformed.append("greenEdgeStatus")
    if not isinstance(gate_input.get("handStructuralAnomalyDetected"), bool):
        malformed.append("handStructuralAnomalyDetected")
    for field in ("doubleMouthReview", "complexHandReview", "voiceMatchReview"):
        if gate_input.get(field) not in {"approved", "rejected", "pending"}:
            malformed.append(field)
    if not isinstance(gate_input.get("humanReviewRecordValid"), bool):
        malformed.append("humanReviewRecordValid")
    if malformed:
        failures.append("表现力报告缺少必填状态字段: " + ", ".join(malformed))
    if gate_input.get("semanticBeatCountSource") != "manifest_time_anchor":
        failures.append("语义段落来源字段缺失或不受支持")
    for key, label in (("doubleMouthReview", "双嘴"), ("complexHandReview", "复杂手部"), ("voiceMatchReview", "声音与人物匹配")):
        decision = gate_input.get(key)
        if decision == "rejected":
            failures.append(f"人工复核确认{label}不合格")
        elif decision != "approved":
            review_reasons.append(f"{label}无法由当前自动模型可靠排除，需人工复核")
    if any(gate_input.get(key) == "approved" for key in ("doubleMouthReview", "complexHandReview", "voiceMatchReview")) and gate_input.get("humanReviewRecordValid") is not True:
        failures.append("人工复核结论缺少 reviewer 或 reviewedAt，记录不可审计")
    automated_passed = not failures
    status = "failed" if failures else "requires_human_review" if review_reasons else "passed"
    return {
        "passed": automated_passed and not review_reasons,
        "automated_passed": automated_passed,
        "validation_status": status,
        "requires_human_review": bool(review_reasons),
        "failures": failures,
        "human_review_reasons": review_reasons,
        "warnings": ["语义段落数与关键词时间仅来自编排清单；动作和画面指标来自成片实测"],
        "checks": checks,
    }


def analyze(video_path: str, manifest_path: str, chroma_override: str = "auto", human_review_path: str | None = None) -> dict[str, Any]:
    with open(manifest_path, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a JSON object")
    beats = manifest.get("beats") if isinstance(manifest.get("beats"), list) else []
    review: dict[str, Any] = {}
    if human_review_path:
        with open(human_review_path, "r", encoding="utf-8") as handle:
            review = json.load(handle)
        if not isinstance(review, dict):
            raise ValueError("human-review payload must be a JSON object")
    chroma_applicable, chroma_source = infer_chroma_applicable(manifest, chroma_override)

    # Lazy import keeps pure deterministic helper tests independent of the GPU/model environment.
    import mediapipe as mp  # pylint: disable=import-outside-toplevel

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"cannot open video: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    declared_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if fps <= 0 or width <= 0 or height <= 0:
        cap.release()
        raise ValueError("video metadata is invalid")
    sample_step = max(1, int(round(fps / SAMPLE_FPS)))
    face_mesh = mp.solutions.face_mesh.FaceMesh(static_image_mode=False, max_num_faces=3, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    hands = mp.solutions.hands.Hands(static_image_mode=False, max_num_hands=4, min_detection_confidence=0.45, min_tracking_confidence=0.45)
    pose = mp.solutions.pose.Pose(static_image_mode=False, model_complexity=1, smooth_landmarks=True, min_detection_confidence=0.45, min_tracking_confidence=0.45)

    records: list[dict[str, Any]] = []
    signatures: list[SceneSignature] = []
    scene_times: list[float] = []
    frame_differences: list[float] = []
    identities: list[np.ndarray] = []
    expressions: list[np.ndarray] = []
    hand_jumps: list[float] = []
    green_rates: list[float] = []
    previous_gray: np.ndarray | None = None
    previous_mask: np.ndarray | None = None
    previous_action: np.ndarray | None = None
    previous_hands: list[tuple[float, float]] | None = None
    previous_scene: SceneSignature | None = None
    decoded_frames = frame_index = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            decoded_frames += 1
            if frame_index % sample_step:
                frame_index += 1
                continue
            timestamp = frame_index / fps
            current_beat = beat_index(beats, timestamp)
            expected = presenter_expected(beats, current_beat)
            process_width = min(540, width)
            process_height = max(1, int(round(height * process_width / width)))
            processed = cv2.resize(frame, (process_width, process_height), interpolation=cv2.INTER_AREA)
            rgb = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)
            face_result, hand_result, pose_result = face_mesh.process(rgb), hands.process(rgb), pose.process(rgb)
            faces = face_result.multi_face_landmarks or []
            primary_face = max(faces, key=lambda face: (max(p.x for p in face.landmark) - min(p.x for p in face.landmark)) * (max(p.y for p in face.landmark) - min(p.y for p in face.landmark)), default=None)
            face_box = None
            if primary_face is not None:
                face_x = [point.x for point in primary_face.landmark]
                face_y = [point.y for point in primary_face.landmark]
                face_box = ((min(face_x) + max(face_x)) / 2, (min(face_y) + max(face_y)) / 2, math.sqrt(max(1e-8, (max(face_x) - min(face_x)) * (max(face_y) - min(face_y)))))
            action, hand_count = action_signature(pose_result, hand_result)

            scene = frame_scene_signature(processed)
            scene_changed, scene_score = is_scene_change(previous_scene, scene)
            previous_scene = scene
            signatures.append(scene)
            scene_times.append(timestamp)

            gray = cv2.resize(cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY), (270, 480), interpolation=cv2.INTER_AREA)
            mask = presenter_mask(270, 480, primary_face, pose_result)
            non_mouth_score = 0.0
            if previous_gray is not None:
                difference = cv2.absdiff(gray, previous_gray)
                frame_differences.append(float(np.mean(difference)))
                usable = (mask > 0) & ((previous_mask > 0) if previous_mask is not None else True)
                if np.count_nonzero(usable) >= 500:
                    non_mouth_score = float(np.mean(difference[usable]))
            previous_gray, previous_mask = gray, mask

            action_delta = nan_rms_distance(previous_action, action)
            if action is not None:
                previous_action = action
            if scene_changed:
                action_delta = None
            action_strength = max(action_delta or 0, min(0.5, non_mouth_score / 35))

            identity = face_geometry_signature(primary_face.landmark) if primary_face is not None else None
            expression = expression_signature(primary_face.landmark) if primary_face is not None else None
            if identity is not None:
                identities.append(identity)
            if expression is not None:
                expressions.append(expression)
            previous_expression = records[-1].get("expression_signature") if records else None
            expression_delta = nan_rms_distance(previous_expression, expression)

            detected_hands = hand_result.multi_hand_landmarks or []
            centers = sorted([(sum(p.x for p in hand.landmark) / 21, sum(p.y for p in hand.landmark) / 21) for hand in detected_hands])
            if previous_hands and centers and len(previous_hands) == len(centers) and not scene_changed:
                hand_jumps.extend(math.dist(left, right) for left, right in zip(previous_hands, centers))
            previous_hands = centers or previous_hands
            if chroma_applicable and primary_face is not None:
                large_mask = cv2.resize(mask, (process_width, process_height), interpolation=cv2.INTER_NEAREST)
                rate, _, edge_count = green_edge_score(processed, large_mask)
                if edge_count >= 50:
                    green_rates.append(rate)

            moving = not scene_changed and (non_mouth_score >= 1.15 or (action_delta or 0) >= 0.025 or (expression_delta or 0) >= 0.0035)
            records.append({
                "timestamp": timestamp, "beat_index": current_beat, "presenter_expected": expected,
                "face_count": len(faces), "face_detected": primary_face is not None, "face_box": face_box,
                "pose_detected": action is not None and np.count_nonzero(np.isfinite(action[:8])) >= 4,
                "hand_count": hand_count, "action_signature": action, "expression_signature": expression,
                "action_strength": action_strength, "non_mouth_score": non_mouth_score,
                "moving": moving, "scene_changed": scene_changed, "scene_score": scene_score,
            })
            frame_index += 1
    finally:
        cap.release()
        face_mesh.close()
        hands.close()
        pose.close()

    timestamps = [record["timestamp"] for record in records]
    scene_changes, scene_scores = detect_scene_changes(scene_times, signatures)
    tolerance = max(0.15, sample_step / fps * 1.5)
    cut_flags = [any(abs(timestamp - cut) <= tolerance for cut in scene_changes) for timestamp in timestamps]
    eligible = [record["presenter_expected"] and record["face_detected"] for record in records]
    maximum_static = longest_static_span(timestamps, [record["moving"] for record in records], eligible, cut_flags)
    freeze_segments, longest_freeze = count_freeze_segments(timestamps, frame_differences)

    beat_vectors = median_vectors_by_beat(records, len(beats))
    trajectory_vectors = trajectory_vectors_by_beat(records, len(beats))
    distinct_gestures = cluster_observed_states([vector for vector in beat_vectors if vector is not None])
    adjacent_repeats = action_changes = 0
    beat_distances: list[float | None] = []
    for index in range(1, len(beat_vectors)):
        # Adjacent-action repetition is about the performed movement, not only
        # the median/resting pose. B-roll and other non-presenter beats are not
        # comparable and deliberately produce no distance.
        distance = nan_rms_distance(trajectory_vectors[index - 1], trajectory_vectors[index])
        beat_distances.append(distance)
        adjacent_repeats += int(distance is not None and distance < 0.10)
        action_changes += int(distance is not None and distance >= 0.13)

    action_strengths = [0.0 if cut_flags[index] or not record["presenter_expected"] else record["action_strength"] for index, record in enumerate(records)]
    action_peaks, action_threshold = find_action_peaks(timestamps, action_strengths)
    alignment: list[int] = []
    peaks_by_beat: list[dict[str, Any]] = []
    for index, beat in enumerate(beats):
        start_seconds = float(beat.get("startMs", 0)) / 1000
        end_seconds = float(beat.get("endMs", 0)) / 1000
        peak_times = [value for value in action_peaks if start_seconds <= value < end_seconds] if presenter_expected(beats, index) else []
        keyword = beat.get("keywordPeakMs")
        if peak_times and finite(keyword):
            selected_time = min(peak_times, key=lambda value: abs(value * 1000 - float(keyword)))
        else:
            selected_time = peak_times[0] if peak_times else None
        strongest = min(records, key=lambda record: abs(record["timestamp"] - selected_time)) if selected_time is not None else None
        observed_ms = int(round(selected_time * 1000)) if selected_time is not None else None
        delta = abs(observed_ms - int(keyword)) if observed_ms is not None and finite(keyword) else None
        if delta is not None:
            alignment.append(delta)
        peaks_by_beat.append({"beatIndex": index, "observedPeakMs": observed_ms, "keywordPeakMs": int(keyword) if finite(keyword) else None, "absoluteDeltaMs": delta, "strength": rounded(strongest["action_strength"] if strongest else None)})

    expression_range = 0.0
    expression_changes = 0
    if len(expressions) >= 6:
        expression_range = float(np.max(np.ptp(np.stack(expressions), axis=0)))
        expression_changes = int(expression_range >= 0.005)
    identity_distance_p95: float | None = None
    identity_outlier_rate = 1.0
    identity_status = "unavailable"
    if len(identities) >= 8:
        stack = np.stack(identities)
        distances = np.sqrt(np.mean(np.square(stack - np.median(stack, axis=0)), axis=1))
        identity_distance_p95 = float(np.percentile(distances, 95))
        identity_outlier_rate = float(np.mean(distances > MAX_IDENTITY_DISTANCE_P95))
        identity_status = "passed" if identity_distance_p95 <= MAX_IDENTITY_DISTANCE_P95 and identity_outlier_rate <= MAX_IDENTITY_OUTLIER_RATE else "failed"

    expected_records = [record for record in records if record["presenter_expected"]]
    detected_records = [record for record in expected_records if record["face_detected"]]
    multiple_face_rate = sum(record["face_count"] > 1 for record in expected_records) / max(1, len(expected_records))
    missing_face_rate = sum(not record["face_detected"] for record in expected_records) / max(1, len(expected_records))
    pose_samples = sum(record["pose_detected"] for record in expected_records)
    maximum_hands = max([record["hand_count"] for record in records] or [0])
    excessive_hand_rate = sum(record["hand_count"] > 2 for record in expected_records) / max(1, len(expected_records))
    hand_jump_p99 = float(np.percentile(hand_jumps, 99)) if hand_jumps else 0.0
    # More than two hands must persist before becoming a hard structural signal;
    # landmark swaps/jumps are retained as diagnostics but complex fingers always
    # require human review instead of being auto-failed by this weak proxy.
    hand_structural_anomaly = excessive_hand_rate > 0.15

    green_rate_p95 = float(np.percentile(green_rates, 95)) if green_rates else None
    if not chroma_applicable:
        green_status, green_detected = "not_applicable", None
    elif green_rate_p95 is None:
        green_status, green_detected = "unavailable", None
    else:
        green_detected = green_rate_p95 > MAX_GREEN_EDGE_RATE
        green_status = "failed" if green_detected else "passed"
    face_composition_shifts = count_face_composition_shifts(records, scene_changes)
    observed_compositions = (1 + len(scene_changes) + face_composition_shifts) if records else 0
    review_record_valid = bool(str(review.get("reviewer", "")).strip() and str(review.get("reviewedAt", "")).strip())

    gate_input = {
        "schemaVersion": SCHEMA_VERSION, "durationSeconds": round(decoded_frames / fps, 3),
        "ratio": "9:16" if width * 16 == height * 9 else f"{width}:{height}",
        "semanticBeatCount": len(beats), "semanticBeatCountSource": "manifest_time_anchor",
        "sampledFrameCount": len(records), "sceneSampleCount": len(signatures),
        "presenterExpectedSampleCount": len(expected_records), "presenterDetectedSampleCount": len(detected_records),
        "poseSampleCount": pose_samples, "observedDistinctGestureCount": distinct_gestures,
        "observedExpressionChangeCount": expression_changes, "observedAdjacentRepeatedActions": adjacent_repeats,
        "maximumNonMouthStaticSeconds": round(maximum_static, 3), "observedSceneOrCompositionCount": observed_compositions,
        "observedActionChangeCount": action_changes, "observedActionPeakCount": len(action_peaks),
        "actionAlignmentObservationCount": len(alignment), "actionAlignmentMaxMs": max(alignment) if alignment else None,
        "multipleFaceRate": round(multiple_face_rate, 5), "missingPresenterFaceRate": round(missing_face_rate, 5),
        "identityGeometryOutlierRate": round(identity_outlier_rate, 5), "identityProxyStatus": identity_status,
        "freezeSegments": freeze_segments, "handStructuralAnomalyDetected": hand_structural_anomaly,
        "greenEdgeStatus": green_status, "doubleMouthReview": review_decision(review, "doubleMouth"),
        "complexHandReview": review_decision(review, "complexHands"), "voiceMatchReview": review_decision(review, "voiceMatch"),
        "humanReviewRecordValid": review_record_valid,
    }
    evaluation = evaluate_gate_input(gate_input)
    return {
        "schema_version": SCHEMA_VERSION, "gate_version": GATE_VERSION, "validator_version": VALIDATOR_VERSION,
        **evaluation,
        "video": {"path": os.path.abspath(video_path), "width": width, "height": height, "fps": round(fps, 5), "frame_count": decoded_frames, "declared_frame_count": declared_frames, "duration_seconds": gate_input["durationSeconds"], "ratio": gate_input["ratio"]},
        "measurement_coverage": {"sample_rate_fps": round(fps / sample_step, 5), "sampled_frames": len(records), "presenter_expected_samples": len(expected_records), "presenter_detected_samples": len(detected_records), "pose_detected_samples": pose_samples, "identity_geometry_samples": len(identities), "expression_samples": len(expressions), "green_edge_samples": len(green_rates)},
        "observations": {
            "scene_change_count": len(scene_changes), "scene_change_timestamps_ms": [int(round(value * 1000)) for value in scene_changes], "scene_change_score_p95": rounded(float(np.percentile(scene_scores, 95)) if scene_scores else None), "face_composition_shift_count": face_composition_shifts, "observed_scene_or_composition_count": observed_compositions,
            "observed_distinct_gesture_count": distinct_gestures, "beat_state_distances": [rounded(value) for value in beat_distances], "observed_action_change_count": action_changes, "observed_action_peak_count": len(action_peaks), "observed_action_peak_timestamps_ms": [int(round(value * 1000)) for value in action_peaks], "action_peak_threshold": round(action_threshold, 5), "action_alignment_by_beat": peaks_by_beat,
            "observed_expression_change_count": expression_changes, "non_mouth_expression_range": round(expression_range, 5), "maximum_non_mouth_static_seconds": round(maximum_static, 3), "non_mouth_motion_score_p50": rounded(float(np.percentile([r["non_mouth_score"] for r in records], 50)) if records else None), "non_mouth_motion_score_p95": rounded(float(np.percentile([r["non_mouth_score"] for r in records], 95)) if records else None),
            "multiple_face_rate": round(multiple_face_rate, 5), "missing_presenter_face_rate": round(missing_face_rate, 5),
            "identity_proxy": {"method": "aligned_facemesh_geometry_non_expression_landmarks", "status": identity_status, "distance_p95": rounded(identity_distance_p95), "outlier_rate": round(identity_outlier_rate, 5), "limitation": "geometry proxy is not a face-recognition identity embedding"},
            "freeze_segment_count": freeze_segments, "longest_freeze_seconds": round(longest_freeze, 3),
            "hand_structure_proxy": {"detected_anomaly": hand_structural_anomaly, "maximum_detected_hands": maximum_hands, "excessive_hand_rate": round(excessive_hand_rate, 5), "hand_center_jump_p99": round(hand_jump_p99, 5), "complex_finger_geometry_automated": False},
            "green_edge": {"applicable": chroma_applicable, "applicability_source": chroma_source, "status": green_status, "detected": green_detected, "edge_pixel_rate_p95": rounded(green_rate_p95), "threshold": MAX_GREEN_EDGE_RATE if chroma_applicable else None},
            "double_mouth": {"automated_clearance_supported": False, "review_decision": gate_input["doubleMouthReview"], "multiple_face_rate_is_only_a_proxy": True},
            "complex_hands": {"automated_clearance_supported": False, "review_decision": gate_input["complexHandReview"]},
            "voice_match": {"automated_clearance_supported": False, "review_decision": gate_input["voiceMatchReview"]},
        },
        "provenance": {"semantic_beat_count": "manifest_time_anchor", "keyword_peak_timestamps": "manifest_time_anchor", "scene_and_composition": "observed_video_frames", "gesture_and_action": "observed_pose_hand_and_pixel_motion", "expression": "observed_non_mouth_facemesh_landmarks", "identity": "observed_facemesh_geometry_proxy", "green_edge": "observed_video_frames_or_not_applicable", "human_review": os.path.abspath(human_review_path) if human_review_path else None},
        "thresholds": {"duration_seconds": [14.5, 15.5], "maximum_non_mouth_static_seconds": MAX_STATIC_SECONDS, "maximum_action_alignment_ms": MAX_ALIGNMENT_MS, "maximum_multiple_face_rate": MAX_MULTIPLE_FACE_RATE, "maximum_missing_presenter_face_rate": MAX_MISSING_FACE_RATE, "maximum_identity_outlier_rate": MAX_IDENTITY_OUTLIER_RATE, "maximum_identity_distance_p95": MAX_IDENTITY_DISTANCE_P95, "maximum_green_edge_rate": MAX_GREEN_EDGE_RATE},
        "gate_input": gate_input,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--manifest", required=True, help="Semantic anchors only; visual claims are ignored")
    parser.add_argument("--human-review", help="Separate JSON record: doubleMouth, complexHands and voiceMatch")
    parser.add_argument("--chroma-key", choices=["auto", "yes", "no"], default="auto")
    parser.add_argument("--output")
    parser.add_argument("--enforce", action="store_true")
    args = parser.parse_args()
    try:
        report = analyze(args.video, args.manifest, args.chroma_key, args.human_review)
    except Exception as error:  # Keep errors machine-readable and fail closed.
        report = {"schema_version": SCHEMA_VERSION, "gate_version": GATE_VERSION, "validator_version": VALIDATOR_VERSION, "passed": False, "automated_passed": False, "validation_status": "failed", "requires_human_review": False, "failures": [f"validator error: {error}"], "human_review_reasons": [], "warnings": [], "checks": [], "gate_input": None}
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    print(payload)
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(payload + "\n")
    return 0 if report["passed"] or not args.enforce else 2


if __name__ == "__main__":
    sys.exit(main())
