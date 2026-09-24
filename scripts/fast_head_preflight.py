#!/usr/bin/env python3
"""Measure whether a clip is suitable for fast face+head+hair replacement.

This worker does not synthesize identity. It produces an auditable JSON gate and
an optional diagnostic video showing the complete head region and hand overlap.
"""

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


def point(landmarks, index, width, height):
    item = landmarks.landmark[index]
    return np.array([item.x * width, item.y * height], dtype=np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('--report', required=True)
    parser.add_argument('--diagnostic-video')
    parser.add_argument('--segmentation-model', default='models/mediapipe/selfie_multiclass_256x256.tflite')
    parser.add_argument('--max-seconds', type=float, default=15.0)
    args = parser.parse_args()

    capture = cv2.VideoCapture(args.input)
    if not capture.isOpened():
        raise SystemExit('video_open_failed')
    fps = capture.get(cv2.CAP_PROP_FPS) or 24.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    output = None
    if args.diagnostic_video:
        Path(args.diagnostic_video).parent.mkdir(parents=True, exist_ok=True)
        output = cv2.VideoWriter(args.diagnostic_video, cv2.VideoWriter_fourcc(*'mp4v'), fps, (width, height))

    face_mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=2, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    hands = mp.solutions.hands.Hands(max_num_hands=2, min_detection_confidence=0.4, min_tracking_confidence=0.4)
    model_path = str(Path(args.segmentation_model).resolve())
    segmenter = mp.tasks.vision.ImageSegmenter.create_from_options(mp.tasks.vision.ImageSegmenterOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
        output_category_mask=False,
        output_confidence_masks=True,
    ))
    detected = frontal = occluded = multi_face = 0
    center_jumps = []
    mask_ious = []
    previous_center = None
    previous_mask = None
    processed = 0

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        processed += 1
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        face_result = face_mesh.process(rgb)
        hand_result = hands.process(rgb)
        segmentation = segmenter.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        hair_probability = cv2.resize(segmentation.confidence_masks[1].numpy_view(), (width, height), interpolation=cv2.INTER_LINEAR)
        face_probability = cv2.resize(segmentation.confidence_masks[3].numpy_view(), (width, height), interpolation=cv2.INTER_LINEAR)
        head_mask = np.logical_or(hair_probability >= 0.42, face_probability >= 0.35).astype(np.uint8) * 255
        head_mask = cv2.morphologyEx(head_mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        faces = face_result.multi_face_landmarks or []
        if len(faces) > 1:
            multi_face += 1
        overlay = frame.copy()
        if faces:
            detected += 1
            face = faces[0]
            coords = np.array([(p.x * width, p.y * height) for p in face.landmark], dtype=np.float32)
            minimum = coords.min(axis=0)
            maximum = coords.max(axis=0)
            face_w, face_h = maximum - minimum
            center = (minimum + maximum) / 2
            # Expand the face region upward and sideways so the gate represents
            # face, complete head and hairstyle as one inseparable scope.
            x1 = int(max(0, center[0] - face_w * 0.72))
            x2 = int(min(width - 1, center[0] + face_w * 0.72))
            y1 = int(max(0, minimum[1] - face_h * 0.62))
            y2 = int(min(height - 1, maximum[1] + face_h * 0.10))
            # Keep only the connected hair/face component around the tracked
            # face. This preserves long hairstyles while excluding exposed skin.
            roi_seed = np.zeros_like(head_mask)
            cv2.ellipse(roi_seed, (int(center[0]), int(center[1] - face_h * 0.08)), (max(2, int(face_w * 0.78)), max(2, int(face_h * 0.95))), 0, 0, 360, 255, -1)
            combined = cv2.bitwise_or(head_mask, roi_seed)
            count, labels, stats, _ = cv2.connectedComponentsWithStats((combined > 0).astype(np.uint8), 8)
            label = int(labels[min(height - 1, max(0, int(center[1]))), min(width - 1, max(0, int(center[0])))])
            if label > 0:
                head_mask = (labels == label).astype(np.uint8) * 255
            head_mask = cv2.morphologyEx(head_mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))

            left_eye = point(face, 33, width, height)
            right_eye = point(face, 263, width, height)
            nose = point(face, 1, width, height)
            eye_span = max(1.0, float(np.linalg.norm(right_eye - left_eye)))
            eye_mid = (left_eye + right_eye) / 2
            yaw_proxy = abs(float(nose[0] - eye_mid[0])) / eye_span
            is_frontal = yaw_proxy <= 0.22
            frontal += int(is_frontal)

            hand_overlap = False
            for hand in hand_result.multi_hand_landmarks or []:
                for mark in hand.landmark:
                    px, py = mark.x * width, mark.y * height
                    ix, iy = min(width - 1, max(0, int(px))), min(height - 1, max(0, int(py)))
                    if head_mask[iy, ix] > 0:
                        hand_overlap = True
                        break
            occluded += int(hand_overlap)
            if previous_center is not None:
                center_jumps.append(float(np.linalg.norm(center - previous_center) / max(1.0, np.hypot(width, height))))
            previous_center = center

            if previous_mask is not None:
                intersection = np.logical_and(head_mask > 0, previous_mask > 0).sum()
                union = np.logical_or(head_mask > 0, previous_mask > 0).sum()
                mask_ious.append(float(intersection / max(1, union)))
            previous_mask = head_mask.copy()

            color = (0, 200, 0) if is_frontal and not hand_overlap else (0, 165, 255)
            tint = np.zeros_like(overlay)
            tint[:, :, 2] = 255
            alpha = (head_mask.astype(np.float32) / 255.0 * 0.38)[..., None]
            overlay = np.clip(overlay * (1 - alpha) + tint * alpha, 0, 255).astype(np.uint8)
            contours, _ = cv2.findContours(head_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, color, 2)
            cv2.putText(overlay, 'FACE+HEAD+HAIR MASK', (x1, max(28, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
            if hand_overlap:
                cv2.putText(overlay, 'HAND OCCLUSION', (24, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        else:
            cv2.putText(overlay, 'FACE NOT DETECTED', (24, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        if output is not None:
            output.write(overlay)

    capture.release()
    face_mesh.close()
    hands.close()
    segmenter.close()
    if output is not None:
        output.release()

    denominator = max(1, processed)
    face_ratio = detected / denominator
    frontal_ratio = frontal / max(1, detected)
    occlusion_ratio = occluded / max(1, detected)
    multi_face_ratio = multi_face / denominator
    tracking_jump_p95 = float(np.percentile(center_jumps, 95)) if center_jumps else 1.0
    mask_iou_p05 = float(np.percentile(mask_ious, 5)) if mask_ious else 0.0
    failures = []
    if duration > args.max_seconds:
        failures.append(f'镜头时长 {duration:.2f}s 超过 {args.max_seconds:.0f}s')
    if face_ratio < 0.95:
        failures.append(f'人脸可跟踪帧比例 {face_ratio:.1%} 低于 95%')
    if frontal_ratio < 0.80:
        failures.append(f'正脸至轻侧脸比例 {frontal_ratio:.1%} 低于 80%')
    if occlusion_ratio > 0.20:
        failures.append(f'手部与头部区域重叠帧比例 {occlusion_ratio:.1%} 超过 20%')
    if multi_face_ratio > 0.01:
        failures.append(f'多人脸帧比例 {multi_face_ratio:.1%} 超过 1%')
    if tracking_jump_p95 > 0.035:
        failures.append(f'头部跟踪跳变 P95 {tracking_jump_p95:.4f} 超过 0.035')
    if mask_iou_p05 < 0.80:
        failures.append(f'头部联合蒙版相邻帧 IoU P05 {mask_iou_p05:.3f} 低于 0.80')

    report = {
        'version': 1,
        'mode': 'fast',
        'scope': 'face_head_hair',
        'status': 'passed' if not failures else 'failed',
        'input': str(Path(args.input).resolve()),
        'durationSeconds': round(duration, 4),
        'fps': round(fps, 4),
        'frameCount': processed,
        'metrics': {
            'faceDetectionRatio': round(face_ratio, 6),
            'frontalOrLightProfileRatio': round(frontal_ratio, 6),
            'headHandOcclusionRatio': round(occlusion_ratio, 6),
            'multipleFaceRatio': round(multi_face_ratio, 6),
            'trackingJumpP95': round(tracking_jump_p95, 6),
            'headMaskTemporalIouP05': round(mask_iou_p05, 6),
        },
        'failures': failures,
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
