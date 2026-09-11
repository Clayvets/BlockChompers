"""
Process the start screen's 2D art (Fish of Fortune styled look, 2D step 1). Run it through npm:

    npm run process:ui                     background + button (+ the button preview)
    npm run process:ui -- --font-preview   the font comparison sheet (needs the candidate fonts, see README)

Every setting is in tools/ui/ui_assets.json. The sources in assets/ui/source/ are only read, never written.

Background: converted to WebP, scaled down to maxWidth when wider (never up).

Button: the pill is cut out of its grey studio background.
  1. Key: only the pill's outline is needed to find its shape. A pixel counts when it is green and not light
     (G - max(R, B) > keyThreshold and luma < edgeLumaMax), or very dark (luma < darkThreshold: the thin outline turns
     almost neutral black in places). JPEG colour bleed tints 1-2 px of background outside the outline green, but
     those pixels are light, so they stay out. The grey-blue background and its baked shadow are neither green nor
     dark, so the shadow drops out with the background.
  2. Shape: the pill is convex, so its matte is the convex hull of the keyed pixels, drawn at `supersample` times
     the resolution and averaged down. That gives exact anti-aliased coverage along a smooth outline, and every
     pixel inside is opaque, so the low-green glossy highlights (some reach the edge) stay intact.
  3. Decontamination: covered pixels keep their colour, except the outermost covered ring. There the outline pixels
     are partly mixed with the light background, so each takes the per-channel minimum of itself and its inner
     neighbours; the outline is darker than both sides, so this only removes the grey. The semi-transparent pixels
     beyond take the colour of the nearest covered pixels (grown outward one 3 x 3 ring at a time, edgeRings times),
     which is the art's own dark outline, so no grey or pale fringe remains.
  4. The result is cropped to the pill plus padding and scaled down (premultiplied alpha) to maxWidth; alpha below
     alphaFloor (Lanczos ringing just outside the edge) is cleared.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageMath

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("ui_assets.json")


def log(*parts):
    print("UI|", *parts, flush=True)


def kib(path):
    return f"{path.stat().st_size / 1024:.1f} KB"


def hull_coverage(mask, supersample):
    """Anti-aliased coverage of the convex hull of the set pixels (each pixel counted as its full unit square)."""
    w, h = mask.size
    points = []
    for y in range(h):
        box = mask.crop((0, y, w, y + 1)).getbbox()
        if box:
            points += [(box[0], y), (box[0], y + 1), (box[2], y), (box[2], y + 1)]
    points = sorted(set(points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in points:  # Andrew's monotone chain
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    big = Image.new("L", (w * supersample, h * supersample), 0)
    ImageDraw.Draw(big).polygon([(x * supersample, y * supersample) for x, y in hull], fill=255)
    return big.reduce(supersample)


def extrapolate(rgb, known, rings):
    """rgb inside `known`; outside it, each 3 x 3 ring takes the mean of its known neighbours, `rings` rings deep."""
    box = ImageFilter.BoxBlur(1)
    colour = rgb
    for _ in range(rings):
        weight = known.filter(box)
        bands = []
        for band in ImageChops.multiply(colour, Image.merge("RGB", (known, known, known))).split():
            bands.append(ImageMath.lambda_eval(
                lambda a: a["convert"](a["min"](a["float"](a["c"]) * 255.0 / a["max"](a["float"](a["w"]), 1.0), 255.0), "L"),
                c=band.filter(box), w=weight))
        grown = known.filter(ImageFilter.MaxFilter(3))
        colour = Image.composite(Image.merge("RGB", bands), colour, ImageChops.subtract(grown, known))
        known = grown
    return colour


def resize_premultiplied(image, width, alpha_floor=0):
    height = round(image.height * width / image.width)
    out = image.convert("RGBa").resize((width, height), Image.LANCZOS).convert("RGBA")
    if alpha_floor:
        out.putalpha(out.getchannel("A").point(lambda v: 0 if v < alpha_floor else v))
    return out


def process_background(cfg):
    src = ROOT / cfg["source"]
    out = ROOT / cfg["output"]
    image = Image.open(src)
    log(f"background source {src.name}: {image.width} x {image.height}, {image.mode}, icc {'yes' if image.info.get('icc_profile') else 'no'}")
    image = image.convert("RGB")
    if image.width > cfg["maxWidth"]:
        image = image.resize((cfg["maxWidth"], round(image.height * cfg["maxWidth"] / image.width)), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, "WEBP", quality=cfg["quality"], method=6)
    log(f"wrote {cfg['output']}: {image.width} x {image.height} (aspect {image.width / image.height:.4f}), {kib(out)}")


def cut_button(cfg):
    src = ROOT / cfg["source"]
    rgb = Image.open(src).convert("RGB")
    r, g, b = rgb.split()
    green = ImageChops.subtract(g, ImageChops.lighter(r, b))  # G - max(R, B), negative values clamp to 0
    luma = rgb.convert("L")
    green_edge = ImageChops.darker(green.point(lambda v: 255 if v > cfg["keyThreshold"] else 0),
                                   luma.point(lambda v: 255 if v < cfg["edgeLumaMax"] else 0))
    mask = ImageChops.lighter(green_edge, luma.point(lambda v: 255 if v < cfg["darkThreshold"] else 0))
    box = mask.getbbox()
    if not box:
        sys.exit(f"UI| no green pill found in {src.name} (keyThreshold {cfg['keyThreshold']})")
    margin = cfg["padding"] + 16
    crop = (max(0, box[0] - margin), max(0, box[1] - margin), min(rgb.width, box[2] + margin), min(rgb.height, box[3] + margin))
    rgb, mask = rgb.crop(crop), mask.crop(crop)

    alpha = hull_coverage(mask, cfg["supersample"])
    covered = alpha.point(lambda v: 255 if v == 255 else 0)
    inner = covered.filter(ImageFilter.MinFilter(3))
    ring = ImageChops.subtract(covered, inner)
    rgb = Image.composite(ImageChops.darker(rgb, extrapolate(rgb, inner, 1)), rgb, ring)
    button = extrapolate(rgb, covered, cfg["edgeRings"]).convert("RGBA")
    button.putalpha(alpha)

    tight = alpha.getbbox()
    pad = cfg["padding"]
    button = button.crop((tight[0] - pad, tight[1] - pad, tight[2] + pad, tight[3] + pad))
    log(f"button source {src.name}: pill {tight[2] - tight[0]} x {tight[3] - tight[1]} px, cut out at {button.width} x {button.height}")
    if button.width > cfg["maxWidth"]:
        button = resize_premultiplied(button, cfg["maxWidth"], cfg["alphaFloor"])
    out = ROOT / cfg["output"]
    out.parent.mkdir(parents=True, exist_ok=True)
    button.save(out, "PNG", optimize=True)
    log(f"wrote {cfg['output']}: {button.width} x {button.height} (aspect {button.width / button.height:.4f}), {kib(out)}")
    return button


def preview_button(button, cfg):
    """The cutout over a dark and a light background, each with zoomed crops of two opposite corners."""
    width = cfg["previewWidth"]
    shown = resize_premultiplied(button, width)
    zoom = cfg["previewZoom"]
    side = round(button.height * cfg["previewZoomBox"])
    corners = [button.crop(box).resize((side * zoom, side * zoom), Image.NEAREST) for box in (
        (0, 0, side, side),                                                        # top-left: thin outline, highlight
        (button.width - side, button.height - side, button.width, button.height),  # bottom-right: dark rim
    )]
    gap = 40
    zoom_w = 2 * side * zoom + gap
    panel_w = max(width, zoom_w) + 2 * gap
    panel_h = gap + shown.height + gap + side * zoom + gap
    sheet = Image.new("RGB", (panel_w * len(cfg["previewBackgrounds"]), panel_h))
    for i, colour in enumerate(cfg["previewBackgrounds"]):
        panel = Image.new("RGBA", (panel_w, panel_h), colour)
        panel.alpha_composite(shown, ((panel_w - shown.width) // 2, gap))
        left = (panel_w - zoom_w) // 2
        top = gap + shown.height + gap
        for j, corner in enumerate(corners):
            x = left + j * (side * zoom + gap)
            panel.alpha_composite(corner, (x, top))
            ImageDraw.Draw(panel).rectangle((x - 1, top - 1, x + corner.width, top + corner.height), outline="#808080")
        sheet.paste(panel.convert("RGB"), (i * panel_w, 0))
    out = ROOT / cfg["preview"]
    sheet.save(out, "PNG", optimize=True)
    log(f"wrote {cfg['preview']}: {sheet.width} x {sheet.height}, {kib(out)}")


def cap_height(font, text):
    """Height of the first letter above the baseline (a capital for "Play")."""
    return -font.getbbox(text[0], anchor="ls")[1]


def fit_font(path, text, height):
    """Font size whose first letter (a capital for "Play") is `height` px tall, so every candidate gets the same caps."""
    size = height * 2
    while size > 8 and cap_height(ImageFont.truetype(str(path), size), text) > height:
        size -= 1
    return ImageFont.truetype(str(path), size)


def label(canvas, centre, text, font, cfg, stroke):
    """White label with an outline and a soft drop shadow; its capitals are centred on `centre` (descenders hang)."""
    x, y = centre
    y += cap_height(font, text) / 2  # baseline
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + stroke), text, font=font, anchor="ms", fill=(0, 0, 0, 110),
                                stroke_width=stroke, stroke_fill=(0, 0, 0, 110))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(stroke * 0.8)))
    ImageDraw.Draw(canvas).text((x, y), text, font=font, anchor="ms", fill=cfg["labelColor"],
                                stroke_width=stroke, stroke_fill=cfg["outlineColor"])


def preview_fonts(cfg, button_cfg):
    button = Image.open(ROOT / button_cfg["output"]).convert("RGBA")
    title = Image.open(ROOT / cfg["titleSource"]).convert("RGB").crop(tuple(cfg["titleBox"]))
    missing = [c["file"] for c in cfg["candidates"] if not (ROOT / c["file"]).exists()]
    if missing:
        sys.exit("UI| missing candidate fonts (see README, Styled – Fish of Fortune): " + ", ".join(missing))
    cell_w = 520
    shown = resize_premultiplied(button, cell_w - 40)
    gap = 30
    caption_font = ImageFont.load_default(22)
    title_h = round(title.height * (cell_w * len(cfg["candidates"]) - 2 * gap) / title.width / 2)
    title = title.resize((round(title.width * title_h / title.height), title_h), Image.LANCZOS)
    sheet_w = cell_w * len(cfg["candidates"])
    sheet_h = gap + title.height + gap + shown.height + 60 + gap
    sheet = Image.new("RGBA", (sheet_w, sheet_h), cfg["background"])
    sheet.alpha_composite(title.convert("RGBA"), ((sheet_w - title.width) // 2, gap))
    top = gap + title.height + gap
    for i, candidate in enumerate(cfg["candidates"]):
        left = i * cell_w + 20
        sheet.alpha_composite(shown, (left, top))
        height = round(shown.height * cfg["labelCapHeight"])
        font = fit_font(ROOT / candidate["file"], cfg["label"], height)
        stroke = max(2, round(height * cfg["outlineWidth"]))
        label(sheet, (left + shown.width // 2, top + round(shown.height * cfg["labelCenterY"])), cfg["label"], font, cfg, stroke)
        ImageDraw.Draw(sheet).text((left + shown.width // 2, top + shown.height + 30),
                                   f"{candidate['name']} ({candidate['license']})", font=caption_font, anchor="mm", fill="#e8e8e8")
    out = ROOT / cfg["output"]
    sheet.convert("RGB").save(out, "PNG", optimize=True)
    log(f"wrote {cfg['output']}: {sheet.width} x {sheet.height}, {kib(out)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--font-preview", action="store_true", help="render the font comparison sheet instead")
    args = parser.parse_args()
    cfg = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if args.font_preview:
        preview_fonts(cfg["fontPreview"], cfg["button"])
        return
    process_background(cfg["background"])
    preview_button(cut_button(cfg["button"]), cfg["button"])


if __name__ == "__main__":
    main()
