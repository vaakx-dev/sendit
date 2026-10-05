from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = sorted((ROOT / "work" / "demo" / "frames").glob("frame-*.jpg"))
OUTPUT = ROOT / "demo.gif"

FRAME_MS = 650
HOLD_LAST_MS = 2400
WIDTH = 880

images = []
for frame_path in FRAMES:
    image = Image.open(frame_path).convert("RGB")
    ratio = WIDTH / image.width
    image = image.resize((WIDTH, round(image.height * ratio)), Image.LANCZOS)
    images.append(image)

durations = [FRAME_MS] * len(images)
durations[-1] = HOLD_LAST_MS

images[0].save(
    OUTPUT,
    save_all=True,
    append_images=images[1:],
    duration=durations,
    loop=0,
    optimize=True,
)

size_kb = OUTPUT.stat().st_size / 1024
print(f"{OUTPUT.name}: {len(images)} frames, {size_kb:.0f} KB")
