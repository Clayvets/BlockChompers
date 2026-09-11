"""
Process the 2D art of the Fish of Fortune styled look. Run it through npm:

    npm run process:ui                     everything below, with the previews
    npm run process:ui -- --only hud       one group: start (start screen), gameplay (background) or hud
    npm run process:ui -- --font-preview   the font comparison sheet (needs the candidate fonts, see README)

Every setting is in tools/ui/ui_assets.json. The sources in assets/ui/source/ are only read, never written.

Backgrounds (start screen, gameplay): converted to WebP, scaled down to maxWidth when wider (never up). The gameplay
background's preview outlines its painted frame (`frame`, measured by eye, fractions of the image).

HUD sheet (already transparent, but with hard, jagged alpha edges): each element gets a smooth anti-aliased matte
drawn at `supersample` times the resolution, and the pixels of that matte not fully opaque in the sheet take the colour
of the nearest opaque ones (the art's own outline), so there is no dark or light fringe.
  - settings button and slot tile: the convex hull of their pixels (a circle and a rounded square);
  - coin icon: a circle fitted to its unobstructed left half, because its right side is drawn over the bar;
  - bars: the sheet has one bar, its left end hidden under the coin. The right end cap is mirrored to make the left
    one and the straight middle is stretched to length (it only changes vertically). The coin bar's left cap is kept
    far enough left to stay hidden under the coin, so bar + coin recompose the sheet; the level bar (missing from the
    sheet) is the same pill at levelAspect.

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
import math
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


def preview_frame(cfg):
    """The gameplay background with its painted frame outlined, to check the measured `frame` rect."""
    image = Image.open(ROOT / cfg["output"]).convert("RGB")
    width = cfg["previewWidth"]
    image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    x, y, w, h = cfg["frame"]
    box = (x * image.width, y * image.height, (x + w) * image.width, (y + h) * image.height)
    draw = ImageDraw.Draw(image)
    draw.rectangle(box, outline=(255, 230, 0), width=2)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    draw.line([(cx - 8, cy), (cx + 8, cy)], fill=(255, 230, 0), width=2)
    draw.line([(cx, cy - 8), (cx, cy + 8)], fill=(255, 230, 0), width=2)
    out = ROOT / cfg["preview"]
    image.save(out, "PNG", optimize=True)
    log(f"frame {x:.3f}, {y:.3f}, {w:.3f} x {h:.3f} of the image (centre {x + w / 2:.4f}, {y + h / 2:.4f}); wrote {cfg['preview']}")


def row_span(mask, y, x0, x1):
    """First and last+1 set pixel of row y within [x0, x1), or None."""
    box = mask.crop((x0, y, x1, y + 1)).getbbox()
    return (x0 + box[0], x0 + box[2]) if box else None


def col_span(mask, x, y0, y1):
    box = mask.crop((x, y0, x + 1, y1)).getbbox()
    return (y0 + box[1], y0 + box[3]) if box else None


def fit_circle(points):
    """Least-squares (Kasa) circle through points -> (cx, cy, r)."""
    n = len(points)
    sums = [0.0] * 9  # x, y, xx, yy, xy, xz, yz, z
    for x, y in points:
        z = x * x + y * y
        for i, v in enumerate((x, y, x * x, y * y, x * y, x * z, y * z, z)):
            sums[i] += v
    sx, sy, sxx, syy, sxy, sxz, syz, sz = sums[:8]
    m = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]]
    for i in range(3):  # Gauss-Jordan
        pivot = m[i][i]
        m[i] = [v / pivot for v in m[i]]
        for k in range(3):
            if k != i:
                m[k] = [vk - m[k][i] * vi for vk, vi in zip(m[k], m[i])]
    cx, cy = m[0][3] / 2, m[1][3] / 2
    return cx, cy, math.sqrt(m[2][3] + cx * cx + cy * cy)


def disc_coverage(size, cx, cy, r, supersample):
    """Anti-aliased coverage of a disc (pixel-edge coordinates)."""
    s = supersample
    big = Image.new("L", (size[0] * s, size[1] * s), 0)
    ImageDraw.Draw(big).ellipse([(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s], fill=255)
    return big.reduce(s)


def matte(rgba, alpha, rings):
    """rgba with `alpha` as its coverage. Pixels opaque in both keep their colour; the others take the colour of the
    nearest such pixels, so the new anti-aliased edge carries the art's outline colour."""
    known = ImageChops.darker(alpha.point(lambda v: 255 if v == 255 else 0),
                              rgba.getchannel("A").point(lambda v: 255 if v == 255 else 0))
    out = extrapolate(rgba.convert("RGB"), known, rings).convert("RGBA")
    out.putalpha(alpha)
    return out


def save_element(image, cfg, name, pad):
    """Crop to the visible pixels plus `pad`, save into the HUD folder, return the saved image."""
    box = image.getchannel("A").getbbox()
    image = image.crop((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad))
    out = ROOT / cfg["outDir"] / name
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, "PNG", optimize=True)
    log(f"wrote {cfg['outDir']}/{name}: {image.width} x {image.height}, {kib(out)}")
    return image


def padded(image, pad):
    canvas = Image.new("RGBA", (image.width + 2 * pad, image.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(image, (pad, pad))
    return canvas


def cut_hud(cfg):
    sheet = Image.open(ROOT / cfg["source"]).convert("RGBA")
    log(f"hud sheet {Path(cfg['source']).name}: {sheet.width} x {sheet.height}")
    mask = sheet.getchannel("A").point(lambda v: 255 if v >= cfg["alphaThreshold"] else 0)
    ss, rings, pad = cfg["supersample"], cfg["edgeRings"], cfg["padding"]
    margin = pad + 2
    out = {}

    # Settings button and slot tile: convex hull of their pixels.
    for key in ("settings", "tile"):
        x0, y0, x1, y1 = cfg[key]["box"]
        part = padded(sheet.crop((x0, y0, x1, y1)), margin)
        alpha = hull_coverage(padded(mask.crop((x0, y0, x1, y1)), margin).convert("L"), ss)
        out[key] = save_element(matte(part, alpha, rings), cfg, cfg[key]["output"], pad)

    # Coin: circle fitted to its left half (left edge of every row, top and bottom edges of the left columns).
    x0, y0, x1, y1 = cfg["coin"]["box"]
    points = [(span[0], y + 0.5) for y in range(y0, y1) if (span := row_span(mask, y, x0, x1))]
    first = fit_circle(points)
    for x in range(x0, math.floor(first[0])):
        span = col_span(mask, x, y0, y1)
        if span:
            points += [(x + 0.5, span[0]), (x + 0.5, span[1])]
    cx, cy, r = fit_circle(points)
    log(f"coin circle: centre ({cx:.2f}, {cy:.2f}), radius {r:.2f} (sheet px)")
    cbox = (math.floor(cx - r) - margin, math.floor(cy - r) - margin, math.ceil(cx + r) + margin, math.ceil(cy + r) + margin)
    part = sheet.crop(cbox)
    alpha = disc_coverage(part.size, cx - cbox[0], cy - cbox[1], r, ss)
    out["coin"] = save_element(matte(part, alpha, rings), cfg, cfg["coin"]["output"], pad)

    # Bars: the straight middle (clear of the coin) and the right end cap from the sheet; the left cap mirrors it.
    bx0, by0, bx1, by1 = cfg["bar"]["box"]
    clean = math.ceil(cx + r) + cfg["bar"]["clearance"]
    top, bottom = col_span(mask, clean, by0, by1)
    right = max(span[1] for y in range(top, bottom) if (span := row_span(mask, y, clean, bx1)))
    cap_start = right
    while col_span(mask, cap_start - 1, by0, by1) != (top, bottom):
        cap_start -= 1
    height, cap_len = bottom - top, right - cap_start
    straight = sheet.crop((clean, top, cap_start, bottom))
    cap = sheet.crop((cap_start, top, right, bottom))
    insets = [right - row_span(mask, y, clean, right)[1] for y in range(top, bottom)]
    # Left end of the coin bar: its mirrored cap must stay inside the coin's silhouette on every row.
    coin_right = [cx + math.sqrt(max(r * r - (y + 0.5 - cy) ** 2, 0)) for y in range(top, bottom)]
    left = math.floor(min(cr - inset for cr, inset in zip(coin_right, insets))) - 1
    log(f"bar: {height} px tall, straight {cap_start - clean} px (x {clean}-{cap_start}), end cap {cap_len} px, "
        f"coin bar from x {left} to {right}")

    def pill(width):
        body = straight.convert("RGBa").resize((width - 2 * cap_len, height), Image.LANCZOS).convert("RGBA")
        image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        image.paste(cap.transpose(Image.FLIP_LEFT_RIGHT), (0, 0))
        image.paste(body, (cap_len, 0))
        image.paste(cap, (width - cap_len, 0))
        image = padded(image, margin)
        shape = image.getchannel("A").point(lambda v: 255 if v >= cfg["alphaThreshold"] else 0)
        return matte(image, hull_coverage(shape, ss), rings)

    out["coinBar"] = save_element(pill(right - left), cfg, cfg["bar"]["coinOutput"], pad)
    out["levelBar"] = save_element(pill(round(height * cfg["bar"]["levelAspect"])), cfg, cfg["bar"]["levelOutput"], pad)

    # Where the coin sits on the coin bar, as fractions of the two images (for ui config): the sheet's composition.
    bar_w, bar_h = out["coinBar"].size
    ox, oy = left - pad, top - pad  # sheet position of the coin bar image's top-left corner
    coin_w = out["coin"].width
    placement = {"centerX": (cx - ox) / bar_w, "centerY": (cy - oy) / bar_h, "size": coin_w / bar_h}
    log("coin on the coin bar: centre ({centerX:.4f}, {centerY:.4f}) of the bar image, icon width {size:.4f} x bar "
        "image height".format(**placement))
    out["placement"] = placement
    out["sheet"] = sheet
    out["sheetBox"] = (min(left, math.floor(cx - r)) - pad, math.floor(cy - r) - pad, right + pad, math.ceil(cy + r) + pad)
    return out


def preview_hud(parts, cfg):
    """Every cutout over a dark and a light background, the coin bar recomposed next to the sheet's original, and
    zoomed edges."""
    font = ImageFont.load_default(14)
    gap = 24
    zoom, side = cfg["previewZoom"], cfg["previewZoomBox"]
    bar, coin = parts["coinBar"], parts["coin"]
    p = parts["placement"]
    # Recompose: the coin bar with the coin over its left end, as the HUD will draw it.
    cw = round(p["size"] * bar.height)
    cxp, cyp = p["centerX"] * bar.width, p["centerY"] * bar.height
    lx = max(0, math.ceil(cw / 2 - cxp))
    ty = max(0, math.ceil(cw / 2 - cyp))
    recomposed = Image.new("RGBA", (bar.width + lx, bar.height + 2 * ty), (0, 0, 0, 0))
    recomposed.alpha_composite(bar, (lx, ty))
    recomposed.alpha_composite(coin.resize((cw, cw), Image.LANCZOS), (round(lx + cxp - cw / 2), round(ty + cyp - cw / 2)))
    original = parts["sheet"].crop(parts["sheetBox"])

    def zoomed(image, box):
        return image.crop(box).resize((side * zoom, side * zoom), Image.NEAREST)

    rows = [
        [("settings_button", parts["settings"]), ("level_bar", parts["levelBar"]), ("coin_bar + coin_icon", recomposed)],
        [("slot_tile", parts["tile"]), ("coin_icon", coin), ("coin_bar", bar), ("sheet (original)", original)],
        [("coin edge x4", zoomed(coin, (0, coin.height // 2 - side // 2, side, coin.height // 2 + side // 2))),
         ("tile corner x4", zoomed(parts["tile"], (0, 0, side, side))),
         ("button edge x4", zoomed(parts["settings"], (0, parts["settings"].height // 2 - side // 2, side, parts["settings"].height // 2 + side // 2))),
         ("level bar left cap x4", zoomed(parts["levelBar"], (0, 0, side, side)))],
    ]
    width = max(sum(im.width for _, im in row) + gap * (len(row) + 1) for row in rows)
    height = sum(max(im.height for _, im in row) + gap + 18 for row in rows) + gap
    sheet = Image.new("RGB", (width, height * len(cfg["previewBackgrounds"])))
    for i, colour in enumerate(cfg["previewBackgrounds"]):
        panel = Image.new("RGBA", (width, height), colour)
        draw = ImageDraw.Draw(panel)
        text = "#e8e8e8" if i == 0 else "#303030"
        y = gap
        for row in rows:
            x = gap
            for name, image in row:
                draw.text((x, y), name, font=font, fill=text)
                panel.alpha_composite(image, (x, y + 18))
                x += image.width + gap
            y += max(im.height for _, im in row) + gap + 18
        sheet.paste(panel.convert("RGB"), (0, i * height))
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
    parser.add_argument("--only", choices=("start", "gameplay", "hud"), help="process one group only")
    args = parser.parse_args()
    cfg = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if args.font_preview:
        preview_fonts(cfg["fontPreview"], cfg["button"])
        return
    if args.only in (None, "start"):
        process_background(cfg["background"])
        preview_button(cut_button(cfg["button"]), cfg["button"])
    if args.only in (None, "gameplay"):
        process_background(cfg["gameplayBackground"])
        preview_frame(cfg["gameplayBackground"])
    if args.only in (None, "hud"):
        preview_hud(cut_hud(cfg["hud"]), cfg["hud"])


if __name__ == "__main__":
    main()
