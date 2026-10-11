# Draws the pictures of the Windows installer (NSIS): the sidebar of the welcome and finish pages and the header
# of the other pages. Output: src-tauri/installer/*.bmp, used by bundle.windows.nsis in tauri.conf.json.
#
#   python scripts/installer-images.py      (needs Pillow and the Windows fonts Segoe UI and Yu Gothic UI)
#
# Drawn at 4x and scaled down, so edges and text stay smooth at the exact size NSIS shows them.
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent
OUT = APP / 'src-tauri' / 'installer'
ICON = Image.open(APP / 'src-tauri' / 'icons' / 'icon.png').convert('RGBA')
FONTS = Path('C:/Windows/Fonts')
S = 4

# The home page colors (site/public/styles.css).
MIST = (237, 240, 247)
INK = (19, 26, 53)
MUTED = (91, 101, 128)
INDIGO = (43, 84, 201)
WHITE = (255, 255, 255)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size * S)


def centered(draw, baseline, parts, fill, width):
    """Draws (text, font) parts side by side on one baseline, centered: Japanese and Vietnamese need different
    fonts."""
    total = sum(draw.textlength(t, font=f) for t, f in parts)
    x = (width * S - total) / 2
    for t, f in parts:
        draw.text((x, baseline * S), t, font=f, fill=fill, anchor='ls')
        x += draw.textlength(t, font=f)


def save(img, size, name):
    img.resize(size, Image.LANCZOS).convert('RGB').save(OUT / name)


def sidebar():
    w, h = 164, 314
    img = Image.new('RGB', (w * S, h * S), MIST)
    d = ImageDraw.Draw(img)
    icon = ICON.resize((64 * S, 64 * S), Image.LANCZOS)
    img.paste(icon, ((w - 64) // 2 * S, 72 * S), icon)
    centered(d, 166, [('MyTranslate', font('seguisb.ttf', 17))], INK, w)
    centered(d, 186, [('日本語', font('YuGothM.ttc', 10)), ('  ·  Tiếng Việt', font('segoeui.ttf', 10))], MUTED, w)
    d.rectangle((0, (h - 4) * S, w * S, h * S), fill=INDIGO)
    save(img, (w, h), 'sidebar.bmp')


def header():
    w, h = 150, 57
    img = Image.new('RGB', (w * S, h * S), WHITE)
    d = ImageDraw.Draw(img)
    icon = ICON.resize((32 * S, 32 * S), Image.LANCZOS)
    img.paste(icon, (10 * S, (h - 32) // 2 * S), icon)
    d.text((50 * S, 18 * S), 'MyTranslate', font=font('seguisb.ttf', 13), fill=INK)
    save(img, (w, h), 'header.bmp')


OUT.mkdir(exist_ok=True)
sidebar()
header()
print(f'wrote {OUT}')
