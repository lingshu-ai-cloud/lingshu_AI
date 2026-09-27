#!/usr/bin/env python3
import argparse, json, math, sys
from pathlib import Path
import cv2
import mediapipe as mp
import numpy as np
from skimage import __version__ as skimage_version
from skimage.metrics import structural_similarity

def points(landmarks):
    if not landmarks: return None
    return np.array([[p.x, p.y, p.visibility if hasattr(p, 'visibility') else 1.0] for p in landmarks.landmark], dtype=np.float32)

def face_histogram(frame, detection):
    if not detection: return None
    box = detection.location_data.relative_bounding_box
    h, w = frame.shape[:2]
    x1, y1 = max(0, int(box.xmin*w)), max(0, int(box.ymin*h))
    x2, y2 = min(w, int((box.xmin+box.width)*w)), min(h, int((box.ymin+box.height)*h))
    if x2 <= x1 or y2 <= y1: return None
    hsv = cv2.cvtColor(frame[y1:y2, x1:x2], cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [24, 24], [0, 180, 0, 256])
    return cv2.normalize(hist, hist).flatten()

def hand_map(result):
    output = {}
    if not result.multi_hand_landmarks: return output
    for i, hand in enumerate(result.multi_hand_landmarks):
        label = result.multi_handedness[i].classification[0].label if result.multi_handedness else str(i)
        output[label] = points(hand)
    return output

def mean_or_none(values): return float(np.mean(values)) if values else None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', nargs='?')
    parser.add_argument('candidate', nargs='?')
    parser.add_argument('--output')
    parser.add_argument('--sample-fps', type=float, default=5.0)
    parser.add_argument('--self-check', action='store_true')
    args = parser.parse_args()
    if args.self_check:
        print(json.dumps({
            'ready': True,
            'scriptVersion': 1,
            'python': sys.version.split()[0],
            'dependencies': {
                'opencv': cv2.__version__,
                'mediapipe': mp.__version__,
                'numpy': np.__version__,
                'scikit-image': skimage_version,
            },
            'scope': ['pose', 'hands', 'background', 'landmark_artifacts', 'face_appearance_proxy'],
            'limitations': ['identity', 'product_brand_text', 'lip_sync', 'action_semantics']
        }, ensure_ascii=False))
        return
    if not args.source or not args.candidate:
        parser.error('source and candidate are required unless --self-check is used')
    source, candidate = cv2.VideoCapture(args.source), cv2.VideoCapture(args.candidate)
    if not source.isOpened() or not candidate.isOpened(): raise SystemExit('video_open_failed')
    duration = min(source.get(cv2.CAP_PROP_FRAME_COUNT)/max(1, source.get(cv2.CAP_PROP_FPS)), candidate.get(cv2.CAP_PROP_FRAME_COUNT)/max(1, candidate.get(cv2.CAP_PROP_FPS)))
    times = np.arange(0, duration, 1/max(.5, args.sample_fps))
    pose_errors, hand_scores, background_scores, face_scores = [], [], [], []
    source_wrist_separation, candidate_wrist_separation = [], []
    source_pose_prev = candidate_pose_prev = None
    artifact_count = pose_pairs = hand_pairs = face_pairs = 0
    mp_pose, mp_hands, mp_seg, mp_face = mp.solutions.pose, mp.solutions.hands, mp.solutions.selfie_segmentation, mp.solutions.face_detection
    with mp_pose.Pose(static_image_mode=True, model_complexity=1) as pose, mp_hands.Hands(static_image_mode=True, max_num_hands=2) as hands, mp_seg.SelfieSegmentation(model_selection=1) as segmenter, mp_face.FaceDetection(model_selection=0, min_detection_confidence=.5) as face_detector:
        for timestamp in times:
            frames = []
            for cap in (source, candidate):
                cap.set(cv2.CAP_PROP_POS_MSEC, float(timestamp*1000))
                ok, frame = cap.read()
                frames.append(frame if ok else None)
            if any(frame is None for frame in frames): continue
            a, b = frames
            b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
            max_width = 640
            if a.shape[1] > max_width:
                size = (max_width, round(a.shape[0]*max_width/a.shape[1]))
                a, b = cv2.resize(a, size), cv2.resize(b, size)
            rgb_a, rgb_b = cv2.cvtColor(a, cv2.COLOR_BGR2RGB), cv2.cvtColor(b, cv2.COLOR_BGR2RGB)
            pa, pb = points(pose.process(rgb_a).pose_landmarks), points(pose.process(rgb_b).pose_landmarks)
            if pa is not None and pb is not None:
                visible = (pa[:,2] > .5) & (pb[:,2] > .5)
                if visible.any():
                    pose_errors.append(float(np.linalg.norm(pa[visible,:2]-pb[visible,:2], axis=1).mean()))
                    pose_pairs += 1
                if source_pose_prev is not None and candidate_pose_prev is not None:
                    source_jump = np.linalg.norm(pa[:,:2]-source_pose_prev[:,:2], axis=1).mean()
                    candidate_jump = np.linalg.norm(pb[:,:2]-candidate_pose_prev[:,:2], axis=1).mean()
                    if candidate_jump > source_jump + .12: artifact_count += 1
                source_pose_prev, candidate_pose_prev = pa, pb
                # Pose wrists are more consistently detected than full hand landmarks.
                # Normalize wrist separation by shoulder width so identity/body-size
                # changes do not dominate the gesture-timing comparison.
                required = (11, 12, 15, 16)
                if all(pa[i,2] > .5 and pb[i,2] > .5 for i in required):
                    source_shoulders = max(.05, float(np.linalg.norm(pa[11,:2] - pa[12,:2])))
                    candidate_shoulders = max(.05, float(np.linalg.norm(pb[11,:2] - pb[12,:2])))
                    source_wrist_separation.append(float(np.linalg.norm(pa[15,:2] - pa[16,:2]) / source_shoulders))
                    candidate_wrist_separation.append(float(np.linalg.norm(pb[15,:2] - pb[16,:2]) / candidate_shoulders))
            ha, hb = hand_map(hands.process(rgb_a)), hand_map(hands.process(rgb_b))
            for label in set(ha).intersection(hb):
                distances = np.linalg.norm(ha[label][:,:2]-hb[label][:,:2], axis=1)
                hand_scores.append(float((distances <= .08).mean())); hand_pairs += 1
            ma = segmenter.process(rgb_a).segmentation_mask > .35
            mb = segmenter.process(rgb_b).segmentation_mask > .35
            background = ~(ma | mb)
            if background.mean() > .1:
                gray_a, gray_b = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
                _, score_map = structural_similarity(gray_a, gray_b, data_range=255, full=True)
                background_scores.append(float(score_map[background].mean()))
            da, db = face_detector.process(rgb_a).detections, face_detector.process(rgb_b).detections
            hist_a = face_histogram(a, da[0] if da else None); hist_b = face_histogram(b, db[0] if db else None)
            if hist_a is not None and hist_b is not None:
                face_scores.append(float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL))); face_pairs += 1
    wrist_mae = None
    wrist_motion_correlation = None
    if source_wrist_separation:
        source_wrist = np.asarray(source_wrist_separation, dtype=np.float32)
        candidate_wrist = np.asarray(candidate_wrist_separation, dtype=np.float32)
        wrist_mae = float(np.abs(source_wrist - candidate_wrist).mean())
        if len(source_wrist) >= 3:
            source_motion, candidate_motion = np.diff(source_wrist), np.diff(candidate_wrist)
            if source_motion.std() > 1e-6 and candidate_motion.std() > 1e-6:
                wrist_motion_correlation = float(np.corrcoef(source_motion, candidate_motion)[0,1])
    report = {
        'version': 1, 'sampleFps': args.sample_fps, 'sampleCount': int(len(times)),
        'normalizedPoseError': mean_or_none(pose_errors), 'posePairCount': pose_pairs,
        'handPckAt008': mean_or_none(hand_scores), 'handPairCount': hand_pairs,
        'wristSeparationMae': wrist_mae,
        'wristMotionCorrelation': wrist_motion_correlation,
        'wristPosePairCount': len(source_wrist_separation),
        'wristSeparationTimeline': {
            'source': [round(float(v), 4) for v in source_wrist_separation],
            'candidate': [round(float(v), 4) for v in candidate_wrist_separation]
        },
        'backgroundSsim': mean_or_none(background_scores),
        'faceAppearanceCorrelationProxy': mean_or_none(face_scores), 'facePairCount': face_pairs,
        'landmarkArtifactCount': artifact_count,
        'limitations': [
            'faceAppearanceCorrelationProxy 是颜色纹理代理，不是人物身份模型，不能单独确认身份',
            'MediaPipe 未检出手部或姿态时指标为 null，质量门禁必须按缺失指标处理',
            'wristSeparationMae 与 wristMotionCorrelation 基于肩宽归一化的双腕间距，用于比较合手/分手动作时间轴',
            '背景 SSIM 使用源片与候选片人物分割蒙版的并集之外区域'
        ]
    }
    text = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output: Path(args.output).write_text(text, encoding='utf-8')
    print(text, end='')

if __name__ == '__main__': main()
