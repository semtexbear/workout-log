"""
make-icons.py – Draws the app icon (a paper-white dumbbell on ink black) as PNG files.

You only need this if you want to change the icon. Run it from the project
folder with:   python3 tools/make-icons.py
It uses plain Python (no extra packages) and writes icons/icon-*.png.
"""

import math
import os
import struct
import zlib

BACKGROUND = (0x11, 0x11, 0x11)  # ink, same as --ink in styles.css
FOREGROUND = (0xF4, 0xF3, 0xEE)  # paper, same as --bg

# The dumbbell as rounded rectangles, in 0..1 coordinates:
# (left, top, right, bottom, corner radius). Kept inside the central area so
# it is never cut off when a system crops the icon into a circle.
SHAPES = [
    (0.20, 0.465, 0.80, 0.535, 0.02),   # bar
    (0.27, 0.29, 0.35, 0.71, 0.035),    # inner plates
    (0.65, 0.29, 0.73, 0.71, 0.035),
    (0.195, 0.35, 0.26, 0.65, 0.03),    # outer plates
    (0.74, 0.35, 0.805, 0.65, 0.03),
]


def rounded_rect_distance(px, py, shape):
    """Signed distance from a point to a rounded rectangle (negative = inside)."""
    left, top, right, bottom, r = shape
    cx, cy = (left + right) / 2, (top + bottom) / 2
    hx, hy = (right - left) / 2 - r, (bottom - top) / 2 - r
    qx, qy = abs(px - cx) - hx, abs(py - cy) - hy
    outside = math.hypot(max(qx, 0), max(qy, 0))
    inside = min(max(qx, qy), 0)
    return outside + inside - r


def draw(size):
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter type "none" for this row
        for x in range(size):
            px, py = (x + 0.5) / size, (y + 0.5) / size
            d = min(rounded_rect_distance(px, py, s) for s in SHAPES) * size
            cover = min(max(0.5 - d, 0.0), 1.0)  # smooth (anti-aliased) edges
            row += bytes(round(b + (f - b) * cover) for b, f in zip(BACKGROUND, FOREGROUND))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", header))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (180, 192, 512):
        path = os.path.join(out_dir, f"icon-{size}.png")
        write_png(path, size, draw(size))
        print("wrote", os.path.normpath(path))
