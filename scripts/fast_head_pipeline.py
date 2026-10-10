#!/usr/bin/env python3
"""Run the local fast-mode gate, composite and visual QA as one auditable job."""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run(command):
    subprocess.run([str(item) for item in command], check=True)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', help='Original performance video')
    parser.add_argument('candidate', help='Driven target-person video')
    parser.add_argument('output', help='Final composited video')
    parser.add_argument('--work-dir', required=True, help='Directory for JSON evidence and diagnostics')
    parser.add_argument('--ffmpeg', default='node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg')
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--hair-scale-x', type=float, default=1.0)
    parser.add_argument('--hair-scale-y', type=float, default=1.0)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    work = Path(args.work_dir).resolve()
    work.mkdir(parents=True, exist_ok=True)
    preflight = work / 'fast-preflight.json'
    diagnostic = work / 'fast-preflight-mask.mp4'
    compatibility = work / 'fast-compatibility.json'
    visual = work / 'fast-visual.json'
    technical = work / 'fast-technical.json'

    run([args.python, root / 'scripts/fast_head_preflight.py', args.source,
         '--report', preflight, '--diagnostic-video', diagnostic])
    preflight_data = read_json(preflight)
    if preflight_data['status'] != 'passed':
        summary = {'version': 1, 'mode': 'fast', 'status': 'blocked_at_preflight',
                   'preflight': preflight_data, 'output': None}
        (work / 'fast-pipeline-report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(summary, ensure_ascii=False))
        raise SystemExit(3)

    run([args.python, root / 'scripts/fast_head_composite.py', args.source, args.candidate, args.output,
         '--ffmpeg', Path(args.ffmpeg).resolve(), '--report', compatibility,
         '--hair-scale-x', args.hair_scale_x, '--hair-scale-y', args.hair_scale_y])
    run([args.python, root / 'scripts/person_replacement_visual_qa.py', args.source, args.output,
         '--output', visual])
    run([root / 'node_modules/.bin/tsx', root / 'scripts/person-replacement-quality.ts',
         args.source, args.output, technical])
    compatibility_data = read_json(compatibility)
    visual_data = read_json(visual)
    technical_data = read_json(technical)
    failures = list(compatibility_data.get('failures') or [])
    background = visual_data.get('backgroundSsim')
    if background is None or background < 0.98:
        failures.append(f'蒙版外背景 SSIM {background if background is not None else "缺失"}，低于 0.98')
    if visual_data.get('landmarkArtifactCount', 0) > 0:
        failures.append('检测到关键点突变伪影')
    if technical_data.get('durationDeltaFrames', 999) > 1:
        failures.append('输出与原片时长相差超过 1 帧')
    if technical_data.get('audioCorrelation', 0) < 0.995:
        failures.append('原音轨相关系数低于 0.995')
    summary = {
        'version': 1,
        'mode': 'fast',
        'status': 'failed' if failures else 'manual_identity_review',
        'preflight': preflight_data,
        'compatibility': compatibility_data,
        'visualQuality': visual_data,
        'technicalQuality': technical_data,
        'failures': failures,
        'manualReview': ['确认目标人物身份一致', '逐帧检查发际线、发梢和手遮挡边缘'],
        'output': str(Path(args.output).resolve()),
    }
    (work / 'fast-pipeline-report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False))
    raise SystemExit(4 if failures else 0)


if __name__ == '__main__':
    main()
