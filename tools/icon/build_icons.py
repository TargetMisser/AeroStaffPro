"""Render the AeroStaff Pro baggage-tag icon into every app asset.

Usage: python tools/icon/build_icons.py   (needs Google Chrome and Pillow)

SVG masters are rasterised with headless Chrome (no SVG library needed),
then resized and encoded with Pillow. Writes assets/ (Expo config sources)
and the committed native resources under android/app/src/main/res.
"""
import os
import shutil
import subprocess
import sys
from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Intermediate SVG/PNG renders and the contact sheet go to tmp/ (git-ignored).
HERE = os.path.join(REPO, "tmp", "icon-build")
RES = os.path.join(REPO, "android", "app", "src", "main", "res")
ASSETS = os.path.join(REPO, "assets")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

ORANGE = "#F47B16"
NAVY = "#13212E"
WHITE = "#FFFFFF"

# Top-view airliner, nose up, centred on (54, 57) in the 108-unit adaptive grid.
PLANE = ("M54 49C55.1 49 55.4 50.2 55.4 51.2L55.4 54.4L62.6 58.6L62.6 60.2L55.4 58.4"
         "L55.3 62L58 63.8L58 65L54.6 64.4L54 65.2L53.4 64.4L50 65L50 63.8L52.7 62"
         "L52.6 58.4L45.4 60.2L45.4 58.6L52.6 54.4L52.6 51.2C52.6 50.2 52.9 49 54 49Z")
BARS = [(42, 2), (45.5, 1), (48, 2.5), (52, 1), (54.5, 2), (58, 1), (60.5, 2.5), (64.5, 1.5)]
BOLD_BARS = [(42, 3), (47, 2), (51, 3.5), (56.5, 2), (60.5, 3.5)]  # reads at 24 px


def tag(mono: bool, bold: bool = False) -> str:
    """The tag glyph. Colour: white tag, navy plane/barcode, see-through hole.
    Mono: one opaque colour, with hole, plane and barcode cut out."""
    bars = BOLD_BARS if bold else BARS
    plane_scale = 1.0 if bold else 0.8
    plane = f'<path d="{PLANE}" transform="translate(54 48) scale({plane_scale}) translate(-54 -57)"/>'
    bar_rects = "".join(f'<rect x="{x}" y="60" width="{w}" height="15"/>' for x, w in bars)
    if mono:
        return f"""
<mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="108">
  <rect width="108" height="108" fill="#fff"/>
  <g fill="#000"><circle cx="54" cy="36" r="3.4"/>{plane}{bar_rects}</g>
</mask>
<g transform="rotate(-10 54 54)" mask="url(#cut)">
  <rect x="38" y="28" width="32" height="54" rx="6" fill="#fff"/>
</g>"""
    return f"""
<mask id="hole" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="108">
  <rect width="108" height="108" fill="#fff"/><circle cx="54" cy="36" r="3.2" fill="#000"/>
</mask>
<g transform="rotate(-10 54 54)">
  <rect x="38" y="28" width="32" height="54" rx="6" fill="{WHITE}" mask="url(#hole)"/>
  <g fill="{NAVY}">{plane}{bar_rects}</g>
</g>"""


def svg(view_box: str, body: str, size: int = 1024) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
            f'viewBox="{view_box}">{body}</svg>')


MASTERS = {
    # Adaptive foreground: glyph only, transparent, full 108 grid (safe zone respected).
    "foreground": svg("0 0 108 108", tag(mono=False)),
    # Themed-icon layer: single colour alpha mask, same geometry.
    "monochrome": svg("0 0 108 108", tag(mono=True)),
    # Legacy/iOS/web icon: full-bleed orange square, glyph a bit larger.
    "legacy": svg("12 12 84 84", f'<rect width="108" height="108" fill="{ORANGE}"/>' + tag(mono=False)),
    # Round legacy icon: what a circular launcher mask shows (72-unit visible area).
    "round": svg("18 18 72 72", f'<clipPath id="c"><circle cx="54" cy="54" r="36"/></clipPath>'
                 f'<g clip-path="url(#c)"><rect width="108" height="108" fill="{ORANGE}"/>{tag(mono=False)}</g>'),
    # Android 12+ splash icon: content inside the inner 2/3 circle of the canvas.
    "splash": svg("0 0 108 108", f'<circle cx="54" cy="54" r="33.5" fill="{ORANGE}"/>'
                  f'<g transform="translate(54 54) scale(0.86) translate(-54 -54)">{tag(mono=False)}</g>'),
    # Status-bar notification icon: white silhouette, simplified for 24 px.
    "notification": svg("22 23 64 64", tag(mono=True, bold=True)),
}


def render(name: str, markup: str) -> str:
    src = os.path.join(HERE, f"{name}.svg")
    out = os.path.join(HERE, f"{name}.png")
    with open(src, "w", encoding="utf-8") as fh:
        fh.write(markup)
    if os.path.exists(out):
        os.remove(out)
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--default-background-color=00000000",
        "--window-size=1024,1024", f"--screenshot={out}", "file:///" + src.replace("\\", "/"),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    img = Image.open(out).convert("RGBA")
    if img.size != (1024, 1024):
        sys.exit(f"{name}: unexpected render size {img.size}")
    return out


def sized(img: Image.Image, px: int) -> Image.Image:
    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    os.makedirs(HERE, exist_ok=True)
    renders = {name: Image.open(render(name, markup)).convert("RGBA") for name, markup in MASTERS.items()}
    fg, mono, legacy, rnd, splash, notif = (renders[k] for k in
                                             ("foreground", "monochrome", "legacy", "round", "splash", "notification"))
    background = Image.new("RGB", (1024, 1024), ORANGE)

    # Expo config sources (app.json)
    legacy.convert("RGB").save(os.path.join(ASSETS, "icon.png"))
    fg.save(os.path.join(ASSETS, "android-icon-foreground.png"))
    background.save(os.path.join(ASSETS, "android-icon-background.png"))
    mono.save(os.path.join(ASSETS, "android-icon-monochrome.png"))
    splash.save(os.path.join(ASSETS, "splash-icon.png"))
    sized(notif, 96).save(os.path.join(ASSETS, "notification-icon.png"))
    sized(legacy, 64).convert("RGB").save(os.path.join(ASSETS, "favicon.png"))

    # Committed native resources (android/ is not regenerated by prebuild)
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, scale in densities.items():
        mip = os.path.join(RES, f"mipmap-{name}")
        drw = os.path.join(RES, f"drawable-{name}")
        layer, launcher = round(108 * scale), round(48 * scale)
        sized(fg, layer).save(os.path.join(mip, "ic_launcher_foreground.webp"), lossless=True)
        sized(background.convert("RGBA"), layer).convert("RGB").save(
            os.path.join(mip, "ic_launcher_background.webp"), lossless=True)
        sized(mono, layer).save(os.path.join(mip, "ic_launcher_monochrome.webp"), lossless=True)
        sized(legacy, launcher).convert("RGB").save(os.path.join(mip, "ic_launcher.webp"), lossless=True)
        sized(rnd, launcher).save(os.path.join(mip, "ic_launcher_round.webp"), lossless=True)
        sized(splash, round(288 * scale)).save(os.path.join(drw, "splashscreen_logo.png"))
        sized(notif, round(24 * scale)).save(os.path.join(drw, "notification_icon.png"))
    shutil.copyfile(os.path.join(ASSETS, "icon.png"), os.path.join(RES, "drawable-mdpi", "assets_icon.png"))

    # Contact sheet for a visual check: launcher look, small size, themed, notification.
    sheet = Image.new("RGB", (1000, 300), "#E9E9EE")
    full = Image.alpha_composite(Image.new("RGBA", (1024, 1024), ORANGE), fg)
    mask = Image.new("L", (1024, 1024), 0)
    ImageDraw.Draw(mask).ellipse((171, 171, 853, 853), fill=255)
    circle = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    circle.paste(full, (0, 0), mask)
    sheet.paste(sized(circle.crop((171, 171, 853, 853)), 200), (20, 50), sized(circle.crop((171, 171, 853, 853)), 200))
    sheet.paste(sized(circle.crop((171, 171, 853, 853)), 48), (250, 126), sized(circle.crop((171, 171, 853, 853)), 48))
    themed = Image.new("RGBA", (1024, 1024), (58, 50, 54, 255))
    tint = Image.new("RGBA", (1024, 1024), (255, 220, 194, 255))
    themed.paste(tint, (0, 0), mono)
    themed_c = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    themed_c.paste(themed, (0, 0), mask)
    t = sized(themed_c.crop((171, 171, 853, 853)), 200)
    sheet.paste(t, (330, 50), t)
    sp = Image.new("RGBA", (300, 300), "#0B1114")
    s = sized(splash, 300)
    sp.alpha_composite(s)
    sheet.paste(sp.resize((200, 200)), (560, 50))
    bar = Image.new("RGBA", (200, 60), "#1F1F1F")
    n = sized(notif, 48)
    bar.alpha_composite(n, (14, 6))
    sheet.paste(bar, (780, 120))
    sheet.save(os.path.join(HERE, "contact_sheet.png"))
    print("done")


if __name__ == "__main__":
    main()
