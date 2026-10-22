"""Generate Jarvis icon assets with zero dependencies (pure zlib PNG writer).

Creates:
  apps/desktop/assets/jarvis-tray.png  (16x16)
  apps/desktop/assets/icon.png         (256x256)
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "apps" / "desktop" / "assets"


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(width: int, height: int, pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    raw = b"\x00" + b"".join(
        b"".join(struct.pack("4B", *px) for px in row) for row in pixels
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def jarvis_pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    """Rounded-square gradient badge with a centered 'spark'."""
    fx, fy = x / (size - 1), y / (size - 1)
    # Badge mask (rounded corners 22%).
    r = 0.22 * size
    cx_lo, cx_hi = r, size - r
    inside = True
    for corner in ((cx_lo, cx_lo), (cx_hi, cx_lo), (cx_lo, cx_hi), (cx_hi, cx_hi)):
        dx = max(corner[0] - x, x - corner[0], 0)
        dy = max(corner[1] - y, y - corner[1], 0)
        if dx > 0 and dy > 0 and math.hypot(dx, dy) > r:
            inside = False
    if not (0 <= x <= size - 1 and 0 <= y <= size - 1) or not inside:
        return (0, 0, 0, 0)
    # Diagonal gradient: accent blue -> mint.
    t = (fx * 0.62 + fy * 0.38)
    base = (
        int(24 + 110 * (1 - t) + 52 * (1 - fx)),
        int(150 * (1 - t) + 227 * t),
        int(255 * (1 - t) + 176 * t),
    )
    # Center 'spark' — small 4-ray star.
    u, v = fx - 0.5, fy - 0.5
    dist = math.hypot(u, v)
    ray = min(abs(u), abs(v)) / max(dist, 0.02)
    spark = (dist < 0.34) and (ray < 0.22)
    glow = (dist < 0.16)
    if glow:
        return (252, 255, 250, 255)
    if spark:
        return (16, 34, 52, 255)
    return (*base, 255)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, size in (("jarvis-tray.png", 16), ("icon.png", 256)):
        grid = [[jarvis_pixel(x, y, size) for x in range(size)] for y in range(size)]
        data = png(size, size, grid)
        out = ASSETS / name
        out.write_bytes(data)
        print(f"wrote {out} ({len(data)} bytes, {size}x{size})")


if __name__ == "__main__":
    main()
