"""
Process the 2D art of the Fish of Fortune styled look. Run it through npm:

    npm run process:ui                     everything below, with the previews
    npm run process:ui -- --only hud       one group: start (start screen), gameplay (background), hud or overlays
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

Overlays (pause, defeat, victory): the sources are three 800 x 1280 Photoshop artboard mockups. Only the two
illustrations are cut out of them; the glass panel, the backdrop, every title and label are rebuilt in CSS, and the
buttons, HUD pieces and coin icon reuse the cutouts above. Each illustration sits on the panel (the sad block on its
bubble), so it is lifted off that surface:
  1. Background: a linear colour gradient fitted to the pixels around the element (robust: shadows, highlights and
     other art are dropped as outliers), first on the crop's border, then on a ring just outside the keyed element.
  2. Key: pixels farther than keyThreshold from that background, largest region, holes filled.
  3. Shape: the coin is an ellipse fitted to the keyed outline (its soft shadow below stays out); the block keeps its
     keyed outline, grown by one pixel for its soft edge.
  4. Soft colour key: inside the shape, pixels one pixel in from the edge are opaque with their own colour. At the
     edge, alpha is the unmix of each pixel against the sampled background along the line to the element's own edge
     colour (its dark outline, grown outward from the inside), capped by the shape; the colour there is that grown
     outline colour unless the pixel is fully the element, so no blue-grey fringe remains. Then a light feather
     (Gaussian) and the stray pixels below alphaFloor are cleared.
  5. Trimmed to content plus padding, then scaled up with Lanczos (premultiplied, never above 2x) and a light unsharp
     mask on the colour only.
The bubble around the block is only an experiment (tools/ui/bubble_unmixed.png): alpha by unmixing each pixel between
the panel colour and the bubble's light tint, the block's area first filled from around it. The preview sheet shows
it next to the CSS rebuild, and every rebuilt overlay (a Pillow approximation of the planned CSS, over the gameplay
background) next to its mockup.

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


def hull_coverage(mask, supersample, inset=0):
    """Anti-aliased coverage of the convex hull of the set pixels (each pixel counted as its full unit square), shrunk
    by `inset` px."""
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
    if inset:
        big = big.filter(ImageFilter.MinFilter(2 * round(inset * supersample) + 1))
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


def disc_coverage(size, cx, cy, r, supersample, ry=None):
    """Anti-aliased coverage of a disc, or of an axis-aligned ellipse when ry is given (pixel-edge coordinates)."""
    s = supersample
    ry = r if ry is None else ry
    big = Image.new("L", (size[0] * s, size[1] * s), 0)
    ImageDraw.Draw(big).ellipse([(cx - r) * s, (cy - ry) * s, (cx + r) * s, (cy + ry) * s], fill=255)
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


def flat(image):
    """An image's pixel values as a flat sequence (get_flattened_data from Pillow 12.1, getdata before it)."""
    return image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()


def solve(matrix):
    """Gauss-Jordan with partial pivoting on an augmented matrix (n rows of n + k); returns the k solution columns."""
    m = [list(row) for row in matrix]
    n = len(m)
    for i in range(n):
        p = max(range(i, n), key=lambda k: abs(m[k][i]))
        m[i], m[p] = m[p], m[i]
        m[i] = [v / m[i][i] for v in m[i]]
        for k in range(n):
            if k != i and m[k][i]:
                f = m[k][i]
                m[k] = [vk - f * vi for vk, vi in zip(m[k], m[i])]
    return [[m[i][n + j] for i in range(n)] for j in range(len(m[0]) - n)]


def least_squares(basis, targets):
    """Coefficients minimising sum (basis . c - target)^2 for each target column, by the normal equations."""
    n, k = len(basis[0]), len(targets[0])
    m = [[0.0] * (n + k) for _ in range(n)]
    for b, t in zip(basis, targets):
        for i in range(n):
            row, bi = m[i], b[i]
            for j in range(n):
                row[j] += bi * b[j]
            for j in range(k):
                row[n + j] += bi * t[j]
    return solve(m)


def fit_plane(samples, rounds=3, keep=2.5):
    """The surface under an element as a linear colour gradient through samples [(x, y, rgb)]. Robust: samples farther
    from the fit than `keep` x the median residual (shadows, highlights, other art) are dropped and it refits.
    Returns (colour_at(x, y), median residual)."""
    for _ in range(rounds):
        coef = least_squares([(1.0, x, y) for x, y, _ in samples], [c for _, _, c in samples])
        residuals = [math.dist(c, [a + bx * x + by * y for a, bx, by in coef]) for x, y, c in samples]
        median = sorted(residuals)[len(residuals) // 2]
        samples = [s for s, r in zip(samples, residuals) if r <= max(median * keep, 2.0)]
    return (lambda x, y: tuple(a + bx * x + by * y for a, bx, by in coef)), median


def key_mask(pixels, size, background, threshold):
    """Pixels farther than `threshold` (RGB distance) from the background estimate."""
    w = size[0]
    mask = Image.new("L", size)
    mask.putdata([255 if math.dist(c, background(i % w, i // w)) > threshold else 0 for i, c in enumerate(pixels)])
    return mask


def largest_component(mask):
    """The largest 8-connected region of a binary mask, with its holes filled."""
    w, h = mask.size
    data = flat(mask)
    seen = bytearray(w * h)
    best = []
    for start in range(w * h):
        if not data[start] or seen[start]:
            continue
        seen[start] = 1
        stack, region = [start], []
        while stack:
            i = stack.pop()
            region.append(i)
            x, y = i % w, i // w
            for yy in range(max(0, y - 1), min(h, y + 2)):
                for xx in range(max(0, x - 1), min(w, x + 2)):
                    j = yy * w + xx
                    if data[j] and not seen[j]:
                        seen[j] = 1
                        stack.append(j)
        if len(region) > len(best):
            best = region
    kept = bytearray(w * h)
    for i in best:
        kept[i] = 255
    filled = Image.new("L", (w + 2, h + 2), 0)
    filled.paste(Image.frombytes("L", (w, h), bytes(kept)), (1, 1))
    ImageDraw.floodfill(filled, (0, 0), 128)  # the outside; what it cannot reach is the region and its holes
    return filled.point(lambda v: 0 if v == 128 else 255).crop((1, 1, w + 1, h + 1))


def fit_ellipse(points):
    """Least-squares axis-aligned ellipse through points -> (cx, cy, rx, ry): A x^2 + C y^2 + D x + E y = 1, solved on
    points centred on their mean for conditioning."""
    mx = sum(p[0] for p in points) / len(points)
    my = sum(p[1] for p in points) / len(points)
    (a, c, d, e), = least_squares([((x - mx) ** 2, (y - my) ** 2, x - mx, y - my) for x, y in points],
                                  [(1.0,)] * len(points))
    cx, cy = -d / (2 * a), -e / (2 * c)
    f = 1 + a * cx * cx + c * cy * cy
    return mx + cx, my + cy, math.sqrt(f / a), math.sqrt(f / c)


def upscale(image, scale, unsharp, alpha_floor):
    """Lanczos in premultiplied alpha (only up, never above 2x), then a light unsharp mask on the colour only. The
    colour under the transparent pixels is first grown from the visible ones, so the sharpening pulls in no black."""
    if not 1 < scale <= 2:
        sys.exit(f"UI| upscale factor {scale} is outside (1, 2]")
    size = (round(image.width * scale), round(image.height * scale))
    out = image.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
    alpha = out.getchannel("A").point(lambda v: 0 if v < alpha_floor else v)
    colour = extrapolate(out.convert("RGB"), alpha.point(lambda v: 255 if v >= 64 else 0), 4)
    radius, percent, threshold = unsharp
    out = colour.filter(ImageFilter.UnsharpMask(radius, percent, threshold)).convert("RGBA")
    out.putalpha(alpha)
    return out


def cut_from_panel(mockup, cfg, common, name):
    """One illustration lifted off a mockup's glass panel (see the module docstring, Overlays)."""
    box = tuple(cfg["box"])
    rgb = mockup.crop(box)
    w, h = rgb.size
    pixels = list(flat(rgb))
    band = common["borderBand"]
    border = [(i % w, i // w, c) for i, c in enumerate(pixels)
              if min(i % w, i // w, w - 1 - i % w, h - 1 - i // w) < band]
    background, _ = fit_plane(border)
    mask = largest_component(key_mask(pixels, rgb.size, background, cfg["keyThreshold"]))
    # The crop's border can be another surface (the bubble's rim around the block): refit on a ring around the element.
    near, far = common["ring"]
    ring = ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(2 * far + 1)),
                               mask.filter(ImageFilter.MaxFilter(2 * near + 1)))
    background, residual = fit_plane([(i % w, i // w, pixels[i]) for i, v in enumerate(flat(ring)) if v])
    mask = largest_component(key_mask(pixels, rgb.size, background, cfg["keyThreshold"]))

    if cfg["shape"] == "ellipse":
        x0, y0, x1, y1 = mask.getbbox()
        points = [p for y in range(y0, y1) if (s := row_span(mask, y, 0, w)) for p in ((s[0], y + 0.5), (s[1], y + 0.5))]
        points += [p for x in range(x0, x1) if (s := col_span(mask, x, 0, h)) for p in ((x + 0.5, s[0]), (x + 0.5, s[1]))]
        cx, cy, rx, ry = fit_ellipse(points)
        limit = disc_coverage(rgb.size, cx, cy, rx - common["inset"], common["supersample"], ry - common["inset"])
        solid = limit.point(lambda v: 255 if v == 255 else 0).filter(ImageFilter.MinFilter(3))
        shape = f"ellipse centre ({box[0] + cx:.1f}, {box[1] + cy:.1f}), radii {rx:.1f} x {ry:.1f}"
    else:  # convex hull of the keyed pixels: the droplets and glossy highlights on the edge stay whole and opaque
        hull = hull_coverage(mask, common["supersample"], common["inset"])
        solid = hull.point(lambda v: 255 if v == 255 else 0).filter(ImageFilter.MinFilter(3))
        limit = hull.filter(ImageFilter.MaxFilter(3))  # one more pixel of soft edge, left to the unmix
        shape = "convex hull of the keyed pixels"
    edge = extrapolate(rgb, solid, 4)  # the element's own edge colour, grown outward

    out = []
    for i, (c, inside, cap, f) in enumerate(zip(pixels, flat(solid), flat(limit), flat(edge))):
        if inside:
            out.append((*c, 255))
            continue
        if not cap:
            out.append((*f, 0))
            continue
        b = background(i % w, i // w)
        d = [fv - bv for fv, bv in zip(f, b)]
        n2 = sum(v * v for v in d)
        a = min(1.0, max(0.0, sum((cv - bv) * dv for cv, bv, dv in zip(c, b, d)) / n2)) if n2 > 1 else 1.0
        out.append((*(c if a >= 0.95 else f), round(min(cap, 255 * a))))
    image = Image.new("RGBA", rgb.size)
    image.putdata(out)
    alpha = ImageChops.lighter(image.getchannel("A").filter(ImageFilter.GaussianBlur(common["feather"])), solid)
    image.putalpha(alpha.point(lambda v: 0 if v < common["alphaFloor"] else v))

    tight = image.getchannel("A").getbbox()
    pad = common["padding"]
    image = image.crop((tight[0] - pad, tight[1] - pad, tight[2] + pad, tight[3] + pad))
    source = image.size
    if cfg["scale"] != 1:
        image = upscale(image, cfg["scale"], common["unsharp"], common["alphaFloor"])
    target = ROOT / common["outDir"] / cfg["output"]
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "PNG", optimize=True)
    bg = tuple(round(v) for v in background(w / 2, h / 2))
    log(f"{name}: {Path(common['mockups'][cfg['mockup']]).name} box {box}, element {tight[2] - tight[0]} x "
        f"{tight[3] - tight[1]} px, surface ~{bg} (residual {residual:.1f}), {shape}")
    log(f"wrote {common['outDir']}/{cfg['output']}: {source[0]} x {source[1]} source px, x{cfg['scale']} -> "
        f"{image.width} x {image.height}, {kib(target)}")
    return {"image": image, "shape": limit.point(lambda v: 255 if v else 0), "box": box}


def unmix_bubble(mockup, cfg, common, block):
    """Experiment: lift the glass bubble around the sad block off the panel. The block's area (its shape, grown) is
    first filled from around it; the bubble's circle is fitted to its bright rim (the brightest point along rays from
    a measured centre, outliers dropped); then each pixel's alpha is its projection on the line from the panel colour
    (fitted on a ring outside the circle) to the bubble's light tint, and its colour the unmixed one. Saved under
    tools/ui for the preview only."""
    box = tuple(cfg["box"])
    rgb = mockup.crop(box)
    w, h = rgb.size
    hole = Image.new("L", rgb.size)
    hole.paste(block["shape"], (block["box"][0] - box[0], block["box"][1] - box[1]))
    hole = hole.filter(ImageFilter.MaxFilter(2 * cfg["holeGrow"] + 1))
    rgb = extrapolate(rgb, ImageChops.invert(hole), cfg["fillRings"])
    pixels = list(flat(rgb))
    gx, gy = cfg["centre"][0] - box[0], cfg["centre"][1] - box[1]
    r0, r1 = cfg["rimRange"]
    rim = []
    for step in range(360):
        angle = math.radians(step)
        ray = [(r0 + k * 0.5) for k in range(int((r1 - r0) * 2) + 1)]
        points = [(gx + rr * math.cos(angle), gy + rr * math.sin(angle)) for rr in ray]
        best = max(points, key=lambda p: sum(rgb.getpixel((int(p[0]), int(p[1])))[1:]))
        rim.append(best)
    for _ in range(3):
        cx, cy, r = fit_circle(rim)
        rim = [p for p in rim if abs(math.dist(p, (cx, cy)) - r) < cfg["rimTolerance"]]
    cx, cy, r = fit_circle(rim)
    near, far = cfg["ring"]
    panel, residual = fit_plane([(i % w, i // w, c) for i, c in enumerate(pixels)
                                 if r + near <= math.dist((i % w + 0.5, i // w + 0.5), (cx, cy)) <= r + far])
    disc = flat(disc_coverage(rgb.size, cx, cy, r + cfg["edge"], common["supersample"]))
    tint = cfg["tint"]
    out, alphas = [], []
    for i, c in enumerate(pixels):
        p = panel(i % w, i // w)
        d = [tv - pv for tv, pv in zip(tint, p)]
        a = min(1.0, max(0.0, sum((cv - pv) * dv for cv, pv, dv in zip(c, p, d)) / sum(v * v for v in d)))
        a *= disc[i] / 255
        colour = tuple(min(255, max(0, round(pv + (cv - pv) / a))) for cv, pv in zip(c, p)) if a >= 0.25 else tuple(tint)
        out.append((*colour, round(255 * a)))
        if disc[i] == 255:
            alphas.append(a)
    image = Image.new("RGBA", rgb.size)
    image.putdata(out)
    image = image.crop(image.getchannel("A").getbbox())
    target = ROOT / cfg["output"]
    image.save(target, "PNG", optimize=True)
    alphas.sort()
    log(f"bubble: circle centre ({box[0] + cx:.1f}, {box[1] + cy:.1f}), radius {r:.1f} ({len(rim)} rim points); panel ~"
        f"{tuple(round(v) for v in panel(cx, cy))} (residual {residual:.1f}); alpha inside median "
        f"{alphas[len(alphas) // 2]:.2f}, 95th percentile {alphas[int(len(alphas) * 0.95)]:.2f}")
    log(f"wrote {cfg['output']} (preview only): {image.width} x {image.height}, {kib(target)}")
    return image, r


def radial_rgba(size, radius, stops):
    """A disc of `radius` px centred in `size`, coloured by distance/radius through RGBA stops [(t, (r, g, b, a))]
    (linear between stops, clear beyond the last one): a stand-in for a CSS radial-gradient."""
    w, h = size
    cx, cy = w / 2, h / 2
    out = []
    for y in range(h):
        for x in range(w):
            t = math.dist((x + 0.5, y + 0.5), (cx, cy)) / radius
            colour = (0, 0, 0, 0)
            for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                if t0 <= t <= t1:
                    k = (t - t0) / (t1 - t0) if t1 > t0 else 0
                    colour = tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
                    break
            out.append(colour)
    image = Image.new("RGBA", size)
    image.putdata(out)
    return image


def css_bubble(design):
    """The bubble as the planned CSS draws it: a radial-gradient disc (faint body, glow behind the block, light rim),
    two highlight arcs and small floating bubbles, each a smaller disc of the same kind."""
    r = design["radius"]
    extent = design["extent"]  # the image spans the floating bubbles too, in bubble radii from the centre
    size = (round(2 * r * extent), round(2 * r * extent))
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    centre = (size[0] / 2, size[1] / 2)

    def disc(radius, stops, at):
        part = radial_rgba((math.ceil(2 * radius) + 2,) * 2, radius, stops)
        image.alpha_composite(part, (round(at[0] - part.width / 2), round(at[1] - part.height / 2)))

    disc(r, [(t, tuple(c)) for t, c in design["body"]], centre)
    arcs = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(arcs)
    for start, end, inset, width, colour in design["arcs"]:
        rr = r * (1 - inset)
        draw.arc([centre[0] - rr, centre[1] - rr, centre[0] + rr, centre[1] + rr], start, end, fill=tuple(colour),
                 width=round(width))
    image.alpha_composite(arcs.filter(ImageFilter.GaussianBlur(design["arcBlur"])))
    for dx, dy, rr, kind in design["floating"]:
        disc(r * rr, [(t, tuple(c)) for t, c in design["small"][kind]], (centre[0] + dx * r, centre[1] + dy * r))
    return image


def checker(size, cell, colours):
    image = Image.new("RGB", size, tuple(colours[0]))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range((y // cell) % 2 * cell, size[0], 2 * cell):
            draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=tuple(colours[1]))
    return image


def layer(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def gradient(size, top, bottom, y0, y1):
    """Vertical RGBA gradient from `top` at y0 to `bottom` at y1 (clamped beyond)."""
    column = Image.new("RGBA", (1, size[1]))
    column.putdata([tuple(round(a + (b - a) * min(1, max(0, (y - y0) / max(1, y1 - y0)))) for a, b in zip(top, bottom))
                    for y in range(size[1])])
    return column.resize(size, Image.NEAREST)


def styled_text(canvas, centre, text, font, style, cap):
    """Text whose capitals are centred on `centre`: a soft shadow, the outline (stroke behind the letters, like CSS
    paint-order: stroke fill) and a flat or vertical-gradient fill."""
    x, y = centre
    baseline = y + cap / 2
    stroke = round(style["outline"] * font.size)
    shadow = layer(canvas.size)
    ox, oy, blur, colour = style["shadow"]
    ImageDraw.Draw(shadow).text((x + ox * font.size, baseline + oy * font.size), text, font=font, anchor="ms",
                                fill=tuple(colour), stroke_width=stroke, stroke_fill=tuple(colour))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur * font.size)))
    outline = layer(canvas.size)
    ImageDraw.Draw(outline).text((x, baseline), text, font=font, anchor="ms", fill=tuple(style["outlineColor"]),
                                 stroke_width=stroke, stroke_fill=tuple(style["outlineColor"]))
    canvas.alpha_composite(outline)
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).text((x, baseline), text, font=font, anchor="ms", fill=255)
    fill = style["fill"]
    if len(fill) == 2:  # top and bottom colours across the capitals
        paint = gradient(canvas.size, (*fill[0], 255), (*fill[1], 255), baseline - cap, baseline)
    else:
        paint = Image.new("RGBA", canvas.size, (*fill, 255))
    glyphs = layer(canvas.size)
    glyphs.paste(paint, (0, 0), mask)
    canvas.alpha_composite(glyphs)


def font_for(path, cap, text=None, max_width=None, stroke=0.0):
    """Titan One at the size whose capitals are `cap` px tall, shrunk (never grown) until `text` with its outline fits
    `max_width`: the CSS labels shrink to fit their button the same way."""
    font = fit_font(path, "H", cap)
    while text and max_width and font.size > 8:
        left, _, right, _ = font.getbbox(text, stroke_width=round(stroke * font.size))
        if right - left <= max_width:
            break
        font = ImageFont.truetype(str(path), font.size - 1)
    return font


def rounded(size, box, radius, fill):
    image = layer(size)
    ImageDraw.Draw(image).rounded_rectangle(box, radius, fill=tuple(fill))
    return image


def glass_panel(size, p):
    """The planned CSS panel: an outer light line (border), a dark band and a soft inner light band (static inset
    box-shadows), a translucent vertical-gradient fill with a light top edge, and one corner glint. No backdrop-filter."""
    x0, y0, x1, y1 = p["box"]
    R = p["radius"]
    panel = layer(size)
    panel.alpha_composite(rounded(size, (x0, y0, x1, y1), R, (*p["rimLight"], 255)))
    b = p["rimLine"]
    panel.alpha_composite(rounded(size, (x0 + b, y0 + b, x1 - b, y1 - b), R - b, (*p["rimDark"], 255)))
    i = 2 * b
    inner = (x0 + i, y0 + i, x1 - i, y1 - i)
    hole = Image.new("L", size, 0)
    ImageDraw.Draw(hole).rounded_rectangle(inner, R - i, fill=255)
    panel.putalpha(ImageChops.subtract(panel.getchannel("A"), hole))
    fill = gradient(size, tuple(p["fillTop"]), tuple(p["fillBottom"]), inner[1], inner[1] + p["fillFade"])
    glow = Image.new("L", size, 0)  # inner light band: the inner outline drawn wide and blurred, clipped to the fill
    ImageDraw.Draw(glow).rounded_rectangle(inner, R - i, outline=255, width=p["glowWidth"])
    glow = ImageChops.multiply(glow.filter(ImageFilter.GaussianBlur(p["glowBlur"])), hole)
    glow_layer = Image.new("RGBA", size, (*p["glow"][:3], 0))
    glow_layer.putalpha(glow.point(lambda v: round(v * p["glow"][3] / 255)))
    body = layer(size)
    body.paste(fill, (0, 0), hole)
    body.alpha_composite(glow_layer)
    gx, gy, gw, gh = p["glint"]
    ImageDraw.Draw(body).rounded_rectangle((x0 + gx, y0 + gy, x0 + gx + gw, y0 + gy + gh), gh / 2,
                                           fill=(255, 255, 255, 200))
    body.alpha_composite(panel)
    return body


def render_overlay(kind, cfg, assets):
    """One rebuilt overlay at the mockups' 800 x 1280: the gameplay background (cover) with the HUD pieces, the backdrop
    dim, the CSS glass panel, Titan One title / subtitle / labels, the illustration and the green buttons."""
    d = cfg["design"]
    size = tuple(d["size"])
    k = d[kind]
    bg = Image.open(ROOT / d["background"]).convert("RGBA")
    scale = max(size[0] / bg.width, size[1] / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS)
    canvas = bg.crop(((bg.width - size[0]) // 2, (bg.height - size[1]) // 2,
                      (bg.width - size[0]) // 2 + size[0], (bg.height - size[1]) // 2 + size[1]))
    hud = {name: Image.open(ROOT / path).convert("RGBA") for name, path in d["hud"]["files"].items()}

    def place(name, box):
        x0, y0, x1, y1 = box
        piece = hud[name].resize((x1 - x0, y1 - y0), Image.LANCZOS)
        canvas.alpha_composite(piece, (x0, y0))

    raised = k["raised"]
    for name in ("level", "coinBar", "coin", "settings"):
        if name not in raised:
            place(name, d["hud"][name])
    canvas.alpha_composite(Image.new("RGBA", size, tuple(d["backdrop"])))
    for name in raised:
        if name == "settings":
            x0, y0, x1, y1 = d["hud"]["settings"]
            ring = layer(size)
            ImageDraw.Draw(ring).ellipse((x0 - 4, y0 - 4, x1 + 4, y1 + 4), outline=tuple(d["highlightRing"]), width=4)
            canvas.alpha_composite(ring.filter(ImageFilter.GaussianBlur(1.5)))
        place(name, d["hud"][name])
    canvas.alpha_composite(glass_panel(size, d["panel"]))

    font_path = ROOT / d["font"]
    t = d["typography"]
    cx = (d["panel"]["box"][0] + d["panel"]["box"][2]) / 2
    styled_text(canvas, (cx, k["titleY"]), k["title"], font_for(font_path, t["title"]["cap"]), t["title"], t["title"]["cap"])
    if "subtitle" in k:
        styled_text(canvas, (cx, k["subtitleY"]), k["subtitle"], font_for(font_path, t["subtitle"]["cap"]), t["subtitle"],
                    t["subtitle"]["cap"])
    if "art" in k:
        ax, ay, aw = k["art"]
        if kind == "defeat":
            bubble = assets["cssBubble"]
            bw = round(aw * d["bubble"]["extent"])
            canvas.alpha_composite(bubble.resize((bw, bw), Image.LANCZOS), (round(ax - bw / 2), round(ay - bw / 2)))
            art = assets["block"]
            aw = round(aw * d["blockScale"])
        else:
            art = assets["coin"]
        ah = round(art.height * aw / art.width)
        canvas.alpha_composite(art.resize((aw, ah), Image.LANCZOS), (round(ax - aw / 2), round(ay - ah / 2)))
    if "reward" in k:
        rx, ry, text = k["reward"]
        styled_text(canvas, (rx, ry), text, font_for(font_path, t["reward"]["cap"]), t["reward"], t["reward"]["cap"])
    button = Image.open(ROOT / d["button"]).convert("RGBA")
    bw = d["buttonWidth"]
    button = resize_premultiplied(button, bw)
    lt = t["label"]
    cap_ratio = cap_height(ImageFont.truetype(str(font_path), 100), "H") / 100
    for y, text in k["buttons"]:
        canvas.alpha_composite(button, (round(cx - bw / 2), round(y - button.height / 2)))
        cap_px = button.height * lt["size"] * cap_ratio
        font = font_for(font_path, cap_px, text, bw * lt["maxWidth"], lt["outline"])
        cap = cap_height(font, "H")
        styled_text(canvas, (cx, y + lt["offsetY"] * button.height), text, font, lt, cap)
    return canvas.convert("RGB")


def process_overlays(cfg):
    mockups = {name: Image.open(ROOT / path).convert("RGB") for name, path in cfg["mockups"].items()}
    for name, image in mockups.items():
        log(f"mockup {name}: {image.width} x {image.height}")
    coin = cut_from_panel(mockups[cfg["coin"]["mockup"]], cfg["coin"], cfg, "coin")
    block = cut_from_panel(mockups[cfg["block"]["mockup"]], cfg["block"], cfg, "sad block")
    bubble, radius = unmix_bubble(mockups[cfg["bubble"]["mockup"]], cfg["bubble"], cfg, block)
    css = css_bubble({**cfg["design"]["bubble"], "radius": radius})
    return {"coin": coin["image"], "block": block["image"], "bubble": bubble, "cssBubble": css, "mockups": mockups}


def preview_overlays(assets, cfg):
    """Row 1: every asset over dark, light and a checkerboard, and a x4 edge crop. Row 2: each mockup (left) next to its
    rebuilt overlay (right)."""
    font = ImageFont.load_default(18)
    gap, cell = 24, cfg["previewCell"]
    zoom, side = cfg["previewZoom"], cfg["previewZoomBox"]
    items = [("coin_big.png", assets["coin"]), ("sad_block.png", assets["block"]),
             ("bubble (unmix attempt)", assets["bubble"]), ("bubble (CSS rebuild)", assets["cssBubble"])]
    backgrounds = []
    for colour in cfg["previewBackgrounds"]:
        if colour == "checker":
            backgrounds.append(checker((cell, cell), 12, cfg["checkerColours"]).convert("RGBA"))
        else:
            backgrounds.append(Image.new("RGBA", (cell, cell), colour))
    row1_h = len(items) * (cell + gap + 22)
    pair_w = cfg["previewOverlayWidth"]
    pair_h = round(pair_w * cfg["design"]["size"][1] / cfg["design"]["size"][0])
    width = max((len(backgrounds) + 1) * (cell + gap) + gap, 3 * (2 * pair_w + gap) + 4 * gap)
    height = gap + row1_h + gap + 22 + pair_h + gap
    sheet = Image.new("RGBA", (width, height), "#11161e")
    draw = ImageDraw.Draw(sheet)
    y = gap
    for name, image in items:
        draw.text((gap, y), f"{name}  ({image.width} x {image.height})", font=font, fill="#e8e8e8")
        y += 22
        shown = image.copy()
        shown.thumbnail((cell - 16, cell - 16), Image.LANCZOS)
        for i, background in enumerate(backgrounds):
            tile = background.copy()
            tile.alpha_composite(shown, ((cell - shown.width) // 2, (cell - shown.height) // 2))
            sheet.alpha_composite(tile, (gap + i * (cell + gap), y))
        # x4 crop of the left edge, middle height, over the checkerboard
        ex, ey = 0, image.height // 2 - side // 2
        for x in range(image.width):
            if image.getpixel((x, image.height // 2))[3] > 0:
                ex = max(0, x - side // 3)
                break
        crop = image.crop((ex, ey, ex + side, ey + side)).resize((side * zoom, side * zoom), Image.NEAREST)
        tile = checker(crop.size, 8, cfg["checkerColours"]).convert("RGBA")
        tile.alpha_composite(crop)
        tile = tile.crop((0, 0, min(cell, tile.width), min(cell, tile.height)))
        sheet.alpha_composite(tile, (gap + len(backgrounds) * (cell + gap), y))
        y += cell + gap
    y += gap // 2
    for i, kind in enumerate(("pause", "defeat", "victory")):
        x = gap + i * (2 * pair_w + 2 * gap)
        draw.text((x, y), f"{kind}: mockup | rebuilt", font=font, fill="#e8e8e8")
        mock = assets["mockups"][kind].resize((pair_w, pair_h), Image.LANCZOS)
        rebuilt = render_overlay(kind, cfg, assets).resize((pair_w, pair_h), Image.LANCZOS)
        sheet.paste(mock, (x, y + 22))
        sheet.paste(rebuilt, (x + pair_w + gap // 2, y + 22))
    out = ROOT / cfg["preview"]
    sheet.convert("RGB").save(out, "PNG", optimize=True)
    log(f"wrote {cfg['preview']}: {sheet.width} x {sheet.height}, {kib(out)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--font-preview", action="store_true", help="render the font comparison sheet instead")
    parser.add_argument("--only", choices=("start", "gameplay", "hud", "overlays"), help="process one group only")
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
    if args.only in (None, "overlays"):
        preview_overlays(process_overlays(cfg["overlays"]), cfg["overlays"])


if __name__ == "__main__":
    main()
