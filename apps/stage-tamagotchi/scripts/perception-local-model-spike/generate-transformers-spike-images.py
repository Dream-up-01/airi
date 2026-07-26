from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def code_image() -> Image.Image:
    image = Image.new("RGB", (1280, 720), "#151b2d")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1280, 90), fill="#202942")
    draw.text((54, 22), "CODE EDITOR", fill="#f2f7ff", font=font(48))
    draw.rectangle((28, 118, 260, 690), fill="#111729")
    draw.rectangle((288, 118, 1250, 690), fill="#0c1220")
    colors = ["#74c7ec", "#a6e3a1", "#f9e2af", "#cba6f7"]
    widths = [760, 580, 840, 500, 690, 420, 800, 610]
    for index, width in enumerate(widths):
        y = 150 + index * 60
        draw.rounded_rectangle(
            (330 + (index % 3) * 42, y, 330 + width, y + 20),
            radius=8,
            fill=colors[index % len(colors)],
        )
    return image


def browser_image() -> Image.Image:
    image = Image.new("RGB", (1280, 720), "#eef4fb")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1280, 92), fill="#d8e5f3")
    draw.rounded_rectangle((170, 19, 1218, 70), radius=24, fill="#ffffff")
    draw.text((205, 26), "WEB BROWSER", fill="#24415f", font=font(30))
    draw.rounded_rectangle((62, 132, 1218, 650), radius=26, fill="#ffffff")
    draw.text((112, 180), "BROWSING THE WEB", fill="#0f6e9a", font=font(54))
    draw.rectangle((112, 275, 550, 570), fill="#57b7d9")
    for index, width in enumerate([575, 510, 550, 400]):
        y = 275 + index * 70
        draw.rectangle((590, y, 590 + width, y + 40), fill="#c8d7e6")
    return image


def main() -> None:
    if len(sys.argv) != 3:
        raise RuntimeError("two-output-paths-required")
    paths = [Path(value) for value in sys.argv[1:]]
    images = [code_image(), browser_image()]
    try:
        for image, path in zip(images, paths, strict=True):
            image.save(path, format="JPEG", quality=84, optimize=True)
    finally:
        for image in images:
            image.close()


if __name__ == "__main__":
    main()
