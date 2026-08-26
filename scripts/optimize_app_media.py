from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "assets" / "images"
PERSONA = IMAGES / "persona"


def optimize_icon(name: str) -> None:
    source = IMAGES / name
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        rgba.thumbnail((512, 512), Image.Resampling.LANCZOS)
        rgba.save(source, format="PNG", optimize=True, compress_level=9)


def optimize_portrait(source_name: str, target_name: str, max_size: tuple[int, int]) -> None:
    source = PERSONA / source_name
    target = PERSONA / target_name
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        rgb.thumbnail(max_size, Image.Resampling.LANCZOS)
        rgb.save(target, format="WEBP", quality=82, method=6)
    source.unlink()


for icon_name in ("icon.png", "splash-icon.png", "favicon.png", "android-icon-foreground.png"):
    optimize_icon(icon_name)

optimize_portrait("elsa-portrait.png", "elsa-portrait.webp", (480, 720))
optimize_portrait("elsa-soft-portrait.png", "elsa-soft-portrait.webp", (320, 480))

video = ROOT / "assets" / "media" / "elsa-intro.mp4"
if video.exists():
    video.unlink()

print("Optimized App media successfully.")
