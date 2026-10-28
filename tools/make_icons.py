"""アイコン PNG を作る（紺の地に、ペン先から伸びる虹色の筆跡）。iOS は角を自分で丸めるので地は四角のまま。
  python tools/make_icons.py"""

from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "icons"
COLORS = ["#ff5a5f", "#ffb347", "#ffe066", "#7bd389", "#4cc9f0", "#7b6cf6"]


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def render(size, ss=4):
    n = size * ss
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n          # 0..1
    img = np.empty((n, n, 3))
    img[:] = hexrgb("#1c2230")
    # 筆跡: 下の S 字カーブ（太さが変わる）
    t = x
    cy = 0.70 - 0.08 * np.sin((t - 0.12) / 0.62 * np.pi) - 0.10 * np.clip((t - 0.5) / 0.24, 0, 1)
    w = 0.012 + 0.07 * np.sin(np.clip((t - 0.12) / 0.62, 0, 1) * np.pi)
    stroke = (np.abs(y - cy) < w) & (t > 0.12) & (t < 0.74)
    stops = np.linspace(0.12, 0.74, len(COLORS))
    cols = np.stack([hexrgb(h) for h in COLORS])
    rgb = np.stack([np.interp(t, stops, cols[:, k]) for k in range(3)], axis=-1)
    img[stroke] = rgb[stroke]
    # ペン先（Gペン風のひし形）: 右上から筆跡の終わりへ
    cx, cy0, L = 0.86, 0.47, 0.2
    u = -(x - cx) * 0.7071 + (y - cy0) * 0.7071      # 軸方向（+ がペン先）
    v = (x - cx) * 0.7071 + (y - cy0) * 0.7071
    nib = (np.abs(v) < 0.085 * (1 - np.abs(u) / L)) & (np.abs(u) < L)
    img[nib] = hexrgb("#e9ecf2")
    slit = nib & (np.abs(v) < 0.008) & (u > 0.0)
    img[slit] = hexrgb("#1c2230")
    hole = (u - 0.0) ** 2 + v ** 2 < 0.02 ** 2
    img[hole] = hexrgb("#1c2230")
    small = img.reshape(size, ss, size, ss, 3).mean(axis=(1, 3))
    return Image.fromarray(small.round().astype(np.uint8), "RGB")


OUT.mkdir(exist_ok=True)
for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
    render(size).save(OUT / name, optimize=True)
    print(OUT / name)
