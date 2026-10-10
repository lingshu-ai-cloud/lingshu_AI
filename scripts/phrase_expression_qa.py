#!/usr/bin/env python3
"""Compare sentence-level facial expression curves independently of identity."""

import argparse
import json
from pathlib import Path
import cv2
import mediapipe as mp
import numpy as np


def ratios(face):
    p = np.array([[v.x, v.y] for v in face.landmark], dtype=np.float32)
    eye_span = max(1e-5, np.linalg.norm(p[263] - p[33]))
    return np.array([
        np.linalg.norm(p[13] - p[14]) / eye_span,       # mouth opening
        np.linalg.norm(p[61] - p[291]) / eye_span,      # mouth width/smile
        np.linalg.norm(p[159] - p[145]) / eye_span,     # left eye opening
        np.linalg.norm(p[386] - p[374]) / eye_span,     # right eye opening
        np.linalg.norm(p[105] - p[159]) / eye_span,     # left brow lift
        np.linalg.norm(p[334] - p[386]) / eye_span,     # right brow lift
    ])


def curve(path, sample_fps):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    values = []
    with mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True) as mesh:
        for t in np.arange(0, duration, 1.0 / sample_fps):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t * 1000))
            ok, frame = cap.read()
            if not ok:
                continue
            faces = mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).multi_face_landmarks or []
            values.append(ratios(faces[0]) if faces else None)
    cap.release()
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('candidates', nargs='+')
    parser.add_argument('--output', required=True)
    parser.add_argument('--sample-fps', type=float, default=10.0)
    args = parser.parse_args()
    source = curve(args.source, args.sample_fps)
    rows = {}
    for candidate in args.candidates:
        target = curve(candidate, args.sample_fps)
        pairs = [(a, b) for a, b in zip(source, target) if a is not None and b is not None]
        if not pairs:
            rows[str(Path(candidate).resolve())] = {'status': 'missing_faces'}
            continue
        a, b = np.stack([x for x, _ in pairs]), np.stack([y for _, y in pairs])
        # Remove identity-specific neutral geometry and compare the changing
        # expression curve over the sentence.
        a_motion, b_motion = a - a[0], b - b[0]
        per_feature = np.mean(np.abs(a_motion - b_motion), axis=0)
        rows[str(Path(candidate).resolve())] = {
            'status': 'measured', 'pairedSamples': len(pairs),
            'expressionMotionMae': round(float(per_feature.mean()), 6),
            'mouthMotionMae': round(float(per_feature[:2].mean()), 6),
            'eyeBrowMotionMae': round(float(per_feature[2:].mean()), 6),
        }
    report = {'version': 1, 'sampleFps': args.sample_fps, 'metrics': rows,
              'interpretation': '误差越低，逐句表情变化轨迹越接近源视频；该指标不评价人物身份'}
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
