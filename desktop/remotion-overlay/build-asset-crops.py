#!/usr/bin/env python3
"""Generate union alpha bounds for the original emphasis asset collection."""
import json
from pathlib import Path
from PIL import Image, ImageSequence

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent.parent / "assets" / "reference" / "emphasis" / "v1"
FILES = [
    "burst-rays-yellow-static.png", "burst-rays-yellow.gif",
    "emphasis-rays-yellow.gif", "lightning-orange.gif", "megaphone-blue-yellow.gif",
]

def union_alpha(path: Path):
    image = Image.open(path)
    union = None
    frames = 0
    for frame in ImageSequence.Iterator(image):
        alpha = frame.convert("RGBA").getchannel("A")
        box = alpha.getbbox()
        frames += 1
        if box:
            union = box if union is None else (
                min(union[0], box[0]), min(union[1], box[1]),
                max(union[2], box[2]), max(union[3], box[3]),
            )
    width, height = image.size
    union = union or (0, 0, width, height)
    return {
        "sourceWidth": width, "sourceHeight": height, "frames": frames,
        "left": union[0], "top": union[1], "right": union[2], "bottom": union[3],
        "x": round(union[0] / width, 6), "y": round(union[1] / height, 6),
        "width": round((union[2] - union[0]) / width, 6),
        "height": round((union[3] - union[1]) / height, 6),
    }

output = {"schemaVersion": "emphasis-asset-crops.v1", "assets": {name: union_alpha(ASSETS / name) for name in FILES}}
(HERE / "asset-crops.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
