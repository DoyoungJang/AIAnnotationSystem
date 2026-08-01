"""Generate non-clinical ultrasound-like PNG fixtures."""
import argparse
from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter


def generate(path: Path, count: int) -> None:
    path.mkdir(parents=True, exist_ok=True)
    rng = random.Random(2026)
    for index in range(count):
        image = Image.effect_noise((640, 480), 48).convert("L").filter(ImageFilter.GaussianBlur(1.2))
        draw = ImageDraw.Draw(image, "L")
        draw.ellipse((150 + index * 3, 90, 500, 410), outline=190, width=7)
        draw.ellipse((230, 170, 420, 330), outline=120, width=4)
        for _ in range(40):
            x, y = rng.randrange(120, 520), rng.randrange(70, 430); draw.point((x, y), fill=rng.randrange(90, 220))
        image.save(path / f"synthetic_ultrasound_{index + 1:03d}.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("output", type=Path); parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args(); generate(args.output, args.count)
