#!/usr/bin/env python3
"""从 AN Logo 原始素材派生应用内品牌素材（2026-09-15 起，可重复执行）。

为什么需要脚本：原始素材是 **3334×3334 方形画布 + 四周大量透明留白**
（内容仅占画布面积 18%~23%），必须**裁到内容边界**再等比缩放；
而应用内两处用法会被 CSS 拉伸（侧栏 `size-8` + `size-full`、横幅 `h-12 w-auto`），
**绝不能直接塞进方形画布就缩放**，否则变形。

命名映射（`浅色` = 用于浅色主题 → **深色字形**；`深色` = 用于深色主题 → **白色字形**）：
  浅色icon透明底0908.png   → astranota-icon-light-256.png       （浅色主题）
  深色icon透明底0908.png   → astranota-icon-dark-256.png        （深色主题）
  浅色横版透明底0908.png   → astranota-horizontal-light-800x200.png
  深色横版透明底0908.png   → astranota-horizontal-dark-800x200.png
  浅色icon透明底0908.png   → <out>/astra-icon-1024.png          （供 `tauri icon` 生成桌面图标集）

用法：
  python3 scripts/make-brand-assets.py [源目录] [--out 桌面图标源目录]
默认源目录：<repo>/../AN Logo
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：pip install Pillow（WSL 侧已装 12.3.0）")

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "frontend/src/assets/astranota"

#: 源文件 → 目标文件名；kind 决定缩放策略
MAPPING = [
    ("浅色icon透明底0908.png", "astranota-icon-light-256.png", "icon"),
    ("深色icon透明底0908.png", "astranota-icon-dark-256.png", "icon"),
    ("浅色横版透明底0908.png", "astranota-horizontal-light-800x200.png", "horizontal"),
    ("深色横版透明底0908.png", "astranota-horizontal-dark-800x200.png", "horizontal"),
]


def load_cropped(path: Path) -> Image.Image:
    """打开并裁到不透明内容边界（素材四周有大量透明留白）。"""
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").getbbox()
    if box is None:
        raise SystemExit(f"{path.name}: 全透明，无内容")
    return im.crop(box)


def fit_into(im: Image.Image, w: int, h: int, margin: float = 0.0) -> Image.Image:
    """等比缩放到 (w,h) 画布内并居中，**不拉伸**；四周留透明。

    侧栏/横幅的 CSS 会把图片拉到容器尺寸，故必须由图片自身保证比例正确。
    """
    avail_w = round(w * (1 - margin))
    avail_h = round(h * (1 - margin))
    scale = min(avail_w / im.width, avail_h / im.height)
    nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(im.resize((nw, nh), Image.LANCZOS), ((w - nw) // 2, (h - nh) // 2))
    return out


def dims_of(path: Path) -> tuple[int, int] | None:
    """读取既有产物的尺寸（必须在覆盖写之前调用）。"""
    if not path.is_file():
        return None
    with Image.open(path) as im:
        return (im.width, im.height)


def report(name: str, im: Image.Image, prev: tuple[int, int] | None) -> None:
    bb = im.getchannel("A").getbbox()
    fill = (bb[2] - bb[0]) * (bb[3] - bb[1]) / (im.width * im.height) * 100
    old = f"  (旧 {prev[0]}x{prev[1]})" if prev else "  (新建)"
    print(f"  ✓ {name:<44} {im.width}x{im.height}  内容占比 {fill:5.1f}%{old}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default=str(REPO.parent / "AN Logo"))
    ap.add_argument("--out", default=str(REPO.parent / "Logo/unified"), help="tauri icon 方形源输出目录")
    args = ap.parse_args()

    src_dir = Path(args.src)
    if not src_dir.is_dir():
        return sys.exit(f"源目录不存在：{src_dir}")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    print(f"源: {src_dir}")
    print(f"派生到: {ASSETS}")

    icon_src: Image.Image | None = None
    for src_name, dst_name, kind in MAPPING:
        sp = src_dir / src_name
        if not sp.is_file():
            return sys.exit(f"缺少源文件：{sp}")
        im = load_cropped(sp)
        dst = ASSETS / dst_name
        prev = dims_of(dst)
        if kind == "icon":
            # 256×256 画布内等比居中（内容宽高比 1.34 ≠ 1，绝不能拉伸）
            out = fit_into(im, 256, 256)
            if dst_name.endswith("light-256.png"):
                icon_src = im
        else:
            # 横幅：等比放入 800×200 画布（**不拉伸**，留透明边）——保证「文件名里的尺寸 = 真实尺寸」
            # 不要改成 resize_width(800)：那样高度随源比例浮动（实测 202），文件名即谎报尺寸。
            out = fit_into(im, 800, 200)
        out.save(dst)
        report(dst_name, out, prev)

    # 桌面图标集源：1024×1024 方形、透明、留 8% 边距（`tauri icon` 要求方形）
    if icon_src is None:
        return sys.exit("未能取得 icon 源")
    sq = fit_into(icon_src, 1024, 1024, margin=0.08)
    sq_path = out_dir / "astra-icon-1024.png"
    prev_sq = dims_of(sq_path)
    sq.save(sq_path)
    report(f"(tauri icon 源) {sq_path.name}", sq, prev_sq)
    print(f"\n下一步（Windows 侧，从 desktop/ 运行）：")
    print(f'  node node_modules\\@tauri-apps\\cli\\tauri.js icon "{sq_path}"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
