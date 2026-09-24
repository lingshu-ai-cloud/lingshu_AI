#!/usr/bin/env python3
"""Composite a driven target head onto the original performance.

The candidate contributes face, complete head and hairstyle. Source pixels are
authoritative everywhere else, including hands that pass in front of the head.
"""

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


ANCHORS = (33, 263, 1, 61, 291, 152, 10)


def face_points(face, width, height):
    return np.array([(face.landmark[i].x * width, face.landmark[i].y * height) for i in ANCHORS], dtype=np.float32)


def head_masks(segmenter, rgb, face, width, height):
    result = segmenter.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    hair = cv2.resize(result.confidence_masks[1].numpy_view(), (width, height), interpolation=cv2.INTER_LINEAR)
    face_skin = cv2.resize(result.confidence_masks[3].numpy_view(), (width, height), interpolation=cv2.INTER_LINEAR)
    raw_hair = (hair >= 0.42).astype(np.uint8) * 255
    mask = np.logical_or(raw_hair > 0, face_skin >= 0.35).astype(np.uint8) * 255
    coords = np.array([(p.x * width, p.y * height) for p in face.landmark], dtype=np.float32)
    minimum, maximum = coords.min(axis=0), coords.max(axis=0)
    center = (minimum + maximum) / 2
    face_w, face_h = maximum - minimum
    # Fill the tracked face itself, but never include the former oversized
    # ellipse: it copied candidate background above the hair as a grey halo.
    face_fill = np.zeros_like(mask)
    cv2.fillConvexPoly(face_fill, cv2.convexHull(coords.astype(np.int32)), 255)
    semantic = cv2.bitwise_or(mask, face_fill)
    combined = cv2.morphologyEx(semantic, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    _, labels, _, _ = cv2.connectedComponentsWithStats((combined > 0).astype(np.uint8), 8)
    label = int(labels[min(height - 1, max(0, int(center[1]))), min(width - 1, max(0, int(center[0])))])
    selected = (labels == label).astype(np.uint8) * 255 if label else face_fill
    selected = cv2.morphologyEx(selected, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    return selected, cv2.bitwise_and(raw_hair, selected), result


def hand_mask(hands_result, skin_probability, width, height):
    mask = np.zeros((height, width), dtype=np.uint8)
    connections = mp.solutions.hands.HAND_CONNECTIONS
    for hand in hands_result.multi_hand_landmarks or []:
        points = [(int(mark.x * width), int(mark.y * height)) for mark in hand.landmark]
        for a, b in connections:
            cv2.line(mask, points[a], points[b], 255, max(8, int(width * 0.014)), cv2.LINE_AA)
        for item in points:
            cv2.circle(mask, item, max(6, int(width * 0.011)), 255, -1, cv2.LINE_AA)
    # Landmark capsules locate the hand, while the skin class supplies the
    # actual visible silhouette. This avoids copying thin bone-like stripes.
    skin = cv2.resize(skin_probability, (width, height), interpolation=cv2.INTER_LINEAR)
    skin = (skin >= 0.28).astype(np.uint8) * 255
    region = cv2.dilate(mask, np.ones((17, 17), np.uint8))
    result = cv2.bitwise_and(region, skin)
    return cv2.GaussianBlur(cv2.dilate(result, np.ones((5, 5), np.uint8)), (9, 9), 0)


def scale_about_center(image, center, scale_x, scale_y, interpolation):
    matrix = np.array([
        [scale_x, 0.0, center[0] * (1.0 - scale_x)],
        [0.0, scale_y, center[1] * (1.0 - scale_y)],
    ], dtype=np.float32)
    return cv2.warpAffine(image, matrix, (image.shape[1], image.shape[0]), flags=interpolation, borderMode=cv2.BORDER_REFLECT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('candidate')
    parser.add_argument('output')
    parser.add_argument('--model', default='models/mediapipe/selfie_multiclass_256x256.tflite')
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--max-seconds', type=float, default=15.0)
    parser.add_argument('--report')
    parser.add_argument('--hair-scale-x', type=float, default=1.0,
                        help='Experimental hair-only horizontal scale; 1.0 preserves the generated silhouette')
    parser.add_argument('--hair-scale-y', type=float, default=1.0,
                        help='Experimental hair-only vertical scale; 1.0 preserves the generated silhouette')
    args = parser.parse_args()

    source = cv2.VideoCapture(args.source)
    candidate = cv2.VideoCapture(args.candidate)
    if not source.isOpened() or not candidate.isOpened():
        raise SystemExit('video_open_failed')
    fps = source.get(cv2.CAP_PROP_FPS) or 24.0
    width, height = int(source.get(cv2.CAP_PROP_FRAME_WIDTH)), int(source.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames = min(int(source.get(cv2.CAP_PROP_FRAME_COUNT)), int(round(args.max_seconds * fps)))
    duration = frames / fps

    segmenter = mp.tasks.vision.ImageSegmenter.create_from_options(mp.tasks.vision.ImageSegmenterOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(Path(args.model).resolve())),
        output_category_mask=False, output_confidence_masks=True,
    ))
    source_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    candidate_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    hands = mp.solutions.hands.Hands(max_num_hands=2, min_detection_confidence=0.4, min_tracking_confidence=0.4)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='fast-head-') as temp:
        silent = os.path.join(temp, 'silent.mp4')
        writer = cv2.VideoWriter(silent, cv2.VideoWriter_fourcc(*'mp4v'), fps, (width, height))
        rendered = skipped = 0
        silhouette_coverages = []
        smooth_matrix = None
        for index in range(frames):
            timestamp = index * 1000.0 / fps
            source.set(cv2.CAP_PROP_POS_MSEC, timestamp)
            candidate.set(cv2.CAP_PROP_POS_MSEC, timestamp)
            ok_s, source_frame = source.read()
            ok_c, candidate_frame = candidate.read()
            if not ok_s or not ok_c:
                break
            candidate_frame = cv2.resize(candidate_frame, (width, height), interpolation=cv2.INTER_AREA)
            source_rgb = cv2.cvtColor(source_frame, cv2.COLOR_BGR2RGB)
            candidate_rgb = cv2.cvtColor(candidate_frame, cv2.COLOR_BGR2RGB)
            source_faces = source_mesh.process(source_rgb).multi_face_landmarks or []
            candidate_faces = candidate_mesh.process(candidate_rgb).multi_face_landmarks or []
            if not source_faces or not candidate_faces:
                writer.write(source_frame)
                skipped += 1
                continue
            matrix, _ = cv2.estimateAffinePartial2D(face_points(candidate_faces[0], width, height), face_points(source_faces[0], width, height), method=cv2.LMEDS)
            if matrix is None:
                writer.write(source_frame)
                skipped += 1
                continue
            smooth_matrix = matrix if smooth_matrix is None else smooth_matrix * 0.72 + matrix * 0.28
            candidate_mask, candidate_hair, _ = head_masks(segmenter, candidate_rgb, candidate_faces[0], width, height)
            source_mask, _, source_segmentation = head_masks(segmenter, source_rgb, source_faces[0], width, height)
            warped_head = cv2.warpAffine(candidate_frame, smooth_matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
            warped_mask = cv2.warpAffine(candidate_mask, smooth_matrix, (width, height), flags=cv2.INTER_LINEAR)
            warped_hair = cv2.warpAffine(candidate_hair, smooth_matrix, (width, height), flags=cv2.INTER_LINEAR)
            source_center = face_points(source_faces[0], width, height).mean(axis=0)
            expanded_hair_frame = scale_about_center(warped_head, source_center, args.hair_scale_x, args.hair_scale_y, cv2.INTER_CUBIC)
            expanded_hair_mask = scale_about_center(warped_hair, source_center, args.hair_scale_x, args.hair_scale_y, cv2.INTER_LINEAR)
            effective_mask = cv2.max(warped_mask, expanded_hair_mask)
            source_pixels = source_mask > 0
            silhouette_coverages.append(float(np.logical_and(source_pixels, effective_mask > 127).sum() / max(1, source_pixels.sum())))

            hair_alpha = (cv2.GaussianBlur(expanded_hair_mask, (15, 15), 0).astype(np.float32) / 255.0)[..., None]
            head_alpha = (cv2.GaussianBlur(warped_mask, (15, 15), 0).astype(np.float32) / 255.0)[..., None]
            replacement = expanded_hair_frame.astype(np.float32) * hair_alpha + source_frame.astype(np.float32) * (1.0 - hair_alpha)
            replacement = warped_head.astype(np.float32) * head_alpha + replacement * (1.0 - head_alpha)

            # Restore source hands above the replaced head to preserve the
            # original occlusion order and gesture pixels.
            skin_probability = source_segmentation.confidence_masks[2].numpy_view()
            hands_front = hand_mask(hands.process(source_rgb), skin_probability, width, height).astype(np.float32) / 255.0
            hands_front = hands_front[..., None]
            composed = source_frame.astype(np.float32) * hands_front + replacement * (1.0 - hands_front)
            writer.write(np.clip(composed, 0, 255).astype(np.uint8))
            rendered += 1
        writer.release()

        subprocess.run([
            args.ffmpeg, '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
            '-i', silent, '-i', str(Path(args.source).resolve()), '-map', '0:v:0', '-map', '1:a:0?',
            '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-c:a', 'copy', '-t', f'{duration:.6f}', '-movflags', '+faststart', str(output_path),
        ], check=True)

    source.release(); candidate.release(); segmenter.close(); source_mesh.close(); candidate_mesh.close(); hands.close()
    coverage_p05 = float(np.percentile(silhouette_coverages, 5)) if silhouette_coverages else 0.0
    failures = [] if coverage_p05 >= 0.90 else [f'目标头发轮廓仅覆盖原头部区域 {coverage_p05:.1%}，低于 90%；无法在不重建背景和身体的前提下去除原发型']
    report = {
        'version': 2, 'mode': 'fast', 'scope': 'face_head_hair',
        'status': 'passed' if not failures and skipped == 0 else 'failed',
        'metrics': {'sourceHeadCoverageByTargetP05': round(coverage_p05, 6), 'renderedFrames': rendered, 'skippedFrames': skipped,
                    'hairScaleX': args.hair_scale_x, 'hairScaleY': args.hair_scale_y},
        'failures': failures,
    }
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))
    print(f'rendered_frames={rendered}')
    print(f'skipped_frames={skipped}')
    print(f'output={output_path}')


if __name__ == '__main__':
    main()
