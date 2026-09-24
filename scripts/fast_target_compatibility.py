#!/usr/bin/env python3
"""Estimate target hairstyle coverage before a paid fast-mode generation."""

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from fast_head_composite import ANCHORS, face_points, head_masks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('target_image')
    parser.add_argument('--report', required=True)
    parser.add_argument('--model', default='models/mediapipe/selfie_multiclass_256x256.tflite')
    parser.add_argument('--sample-fps', type=float, default=3.0)
    args = parser.parse_args()

    target = cv2.imread(args.target_image)
    capture = cv2.VideoCapture(args.source)
    if target is None or not capture.isOpened():
        raise SystemExit('input_open_failed')
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    target = cv2.resize(target, (width, height), interpolation=cv2.INTER_AREA)
    fps = capture.get(cv2.CAP_PROP_FPS) or 24.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(fps / max(0.5, args.sample_fps)))

    segmenter = mp.tasks.vision.ImageSegmenter.create_from_options(mp.tasks.vision.ImageSegmenterOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(Path(args.model).resolve())),
        output_category_mask=False, output_confidence_masks=True,
    ))
    source_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
    target_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True, static_image_mode=True)
    target_rgb = cv2.cvtColor(target, cv2.COLOR_BGR2RGB)
    target_faces = target_mesh.process(target_rgb).multi_face_landmarks or []
    if not target_faces:
        raise SystemExit('target_face_not_detected')
    target_mask, _, _ = head_masks(segmenter, target_rgb, target_faces[0], width, height)

    coverages = []
    sampled = missed = 0
    for index in range(0, frame_count, step):
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
        if not ok:
            continue
        sampled += 1
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        faces = source_mesh.process(rgb).multi_face_landmarks or []
        if not faces:
            missed += 1
            continue
        source_mask, _, _ = head_masks(segmenter, rgb, faces[0], width, height)
        matrix, _ = cv2.estimateAffinePartial2D(
            face_points(target_faces[0], width, height), face_points(faces[0], width, height), method=cv2.LMEDS)
        if matrix is None:
            missed += 1
            continue
        warped = cv2.warpAffine(target_mask, matrix, (width, height), flags=cv2.INTER_LINEAR)
        source_pixels = source_mask > 0
        coverages.append(float(np.logical_and(source_pixels, warped > 127).sum() / max(1, source_pixels.sum())))

    capture.release(); source_mesh.close(); target_mesh.close(); segmenter.close()
    p05 = float(np.percentile(coverages, 5)) if coverages else 0.0
    failures = []
    if missed:
        failures.append(f'{missed}/{sampled} 个抽样帧无法比较')
    if p05 < 0.90:
        failures.append(f'参考图发型预测覆盖率 P05 为 {p05:.1%}，低于 90%')
    report = {
        'version': 1, 'mode': 'fast', 'status': 'passed' if not failures else 'blocked',
        'metrics': {'predictedHeadCoverageP05': round(p05, 6), 'sampledFrames': sampled,
                    'comparedFrames': len(coverages), 'missedFrames': missed},
        'failures': failures,
        'limitation': '参考图预检只能过滤明显不兼容资产；最终仍以驱动视频逐帧覆盖率为准',
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(2 if failures else 0)


if __name__ == '__main__':
    main()
