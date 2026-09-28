"""Two bilingual layouts per document kind with measured clean-render evidence."""

import hashlib
import random
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import matplotlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, features

from .catalogue import CATALOGUE, CODE_TEXT, TITLES, Condition, Field, FieldLabel
from .identities import make_record

FONT_HASHES = {
    "DejaVuSans.ttf": "3fdf69cabf06049ea70a00b5919340e2ce1e6d02b0cc3c4b44fb6801bd1e0d22",
    "DejaVuSans-Bold.ttf": "b184b89e3c1075f22f6b71575b6fc20d4972b3cfd3b23322ca6fd596dcaef167",
}
INK = (28, 42, 53)
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
INDIC = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


@dataclass
class Evidence:
    """Retain actual glyph evidence independently of the serialised label record."""

    printed: str
    box: list[int]
    pixels: bytes
    ink_pixels: int
    cover_box: tuple[int, int, int, int] | None = None
    cover_colour: tuple[int, int, int] | None = None


@dataclass
class CleanRender:
    """Keep clean pixels and independently measured own-value and decoy registries."""

    image: Image.Image
    page_box: tuple[int, int, int, int]
    fields: dict[str, FieldLabel]
    values: dict[str, Evidence]
    decoys: dict[str, Evidence]
    decoration_boxes: list[list[int]]


class Fonts:
    """Load only verified matplotlib DejaVu fonts through the raqm engine."""

    def __init__(self) -> None:
        """Fail before rendering if shaping or either frozen font is unavailable."""
        if not features.check_feature("raqm"):
            raise RuntimeError("The generator requires Pillow with raqm; no fallback is permitted")
        self.directory = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
        self.cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}
        for name, expected in FONT_HASHES.items():
            path = self.directory / name
            if not path.is_file():
                raise RuntimeError(f"Required bundled font is missing: {name}")
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"Bundled font hash mismatch: {name}; freeze a new generator version")

    def get(self, size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
        """Return a cached, hash-verified raqm font at the requested pixel size."""
        key = size, bold
        if key not in self.cache:
            filename = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
            self.cache[key] = ImageFont.truetype(self.directory / filename, size, layout_engine=ImageFont.Layout.RAQM)
        return self.cache[key]


def is_arabic(text: str) -> bool:
    """Identify Arabic letters separately from Arabic-Indic numeric glyphs."""
    return any("\u0600" <= character <= "\u06ff" and unicodedata.category(character).startswith("L")
               for character in text)


def draw_text(image: Image.Image, fonts: Fonts, text: str, x: int, y: int,
              width: int, size: int, *, bold: bool = False,
              colour: tuple[int, ...] | int = INK, align: str | None = None,
              identifier: bool = False) -> list[int]:
    """Draw a fitted raqm run and return its exact textbbox in page coordinates."""
    rtl = is_arabic(text)
    if identifier and not rtl:
        # Paragraph direction alone does not fix neutral hyphens between Arabic numbers.
        # Override only identifier runs; Arabic words retain their normal joining and order.
        text = "\u202d" + text + "\u202c"
    direction, language = ("rtl", "ar") if rtl else ("ltr", "en")
    align = align or ("right" if rtl else "left")
    draw = ImageDraw.Draw(image)
    while size >= 10:
        font = fonts.get(size, bold)
        bounds = draw.textbbox((0, 0), text, font=font, direction=direction, language=language, anchor="lt")
        if bounds[2] - bounds[0] <= width:
            break
        size -= 1
    else:
        raise ValueError(f"Text cannot fit its designated column: {text}")
    anchor = "rt" if rtl or align == "right" else "lt"
    if align == "right":
        x += width
    elif align == "center":
        x += (width - (bounds[2] - bounds[0])) // 2
        if anchor == "rt":
            x += bounds[2] - bounds[0]
    elif anchor == "rt":
        x += bounds[2] - bounds[0]
    position = (x, y)
    bounds = draw.textbbox(position, text, font=font, anchor=anchor, direction=direction, language=language)
    draw.text(position, text, font=font, anchor=anchor, direction=direction, language=language, fill=colour)
    return [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]]


def box_edges(box: list[int]) -> tuple[int, int, int, int]:
    """Convert an exact x/y/width/height text box to Pillow crop edges."""
    x, y, width, height = box
    return x, y, x + width, y + height


def formatted_value(field: Field, value: str, family: str, digits: str, rng: random.Random) -> str:
    """Format canonical values explicitly without locale or operating-system dependence."""
    if field.type == "date":
        day = date.fromisoformat(value)
        style = 0 if family == "a" else rng.choice((1, 2))
        value = (f"{day.day:02d}/{day.month:02d}/{day.year}", value,
                 f"{day.day:02d} {MONTHS[day.month - 1]} {day.year}")[style]
    elif field.type == "money":
        amount = int(value.split(".")[0])
        if digits == "arabic_indic":
            value = f"{amount:,}".replace(",", "٬") + " درهم"
        else:
            value = f"AED {amount:,.2f}" if family == "a" else f"{amount:,}"
    elif value in CODE_TEXT:
        value = CODE_TEXT[value]
        if field.name == "sex" and family == "a":
            english, arabic = value.split(" / ")
            value = f"{arabic} / {english}"
    if digits == "arabic_indic" and field.script == "neutral":
        value = value.translate(INDIC)
    return value


def _watermark(image: Image.Image, page: tuple[int, int, int, int], fonts: Fonts) -> None:
    left, top, right, bottom = page
    width, height = right - left, bottom - top
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    size = 108 if width > 1200 else 88
    draw_text(layer, fonts, "SPECIMEN", 0, height // 2 - 95, width, size, bold=True,
              colour=(138, 55, 55, 58), align="center")
    draw_text(layer, fonts, "عينة", 0, height // 2 + 15, width, size + 8, bold=True,
              colour=(138, 55, 55, 58), align="center")
    layer = layer.rotate(27, resample=Image.Resampling.BICUBIC)
    image.paste(layer, (left, top), layer)


def _evidence(image: Image.Image, before: Image.Image, printed: str, box: list[int]) -> Evidence:
    crop = image.crop(box_edges(box))
    background = before.crop(box_edges(box))
    changed = int(np.any(np.asarray(crop) != np.asarray(background), axis=2).sum())
    return Evidence(printed, box, crop.tobytes(), changed)


def render_document(kind: str, truth: dict[str, str], conditions: dict[str, Condition],
                    family: str, digits: str, rng: random.Random, fonts: Fonts) -> CleanRender:
    """Render one fictional document with exact boxes and observable condition evidence."""
    if family not in ("a", "b"):
        raise ValueError("Layout family must be a or b")
    is_card = kind == "emirates_id"
    if is_card:
        image = Image.new("RGB", (1200, 800), (216, 211, 201))
        page = (94, 81, 1106, 719)
        row_x, row_width = (252, 826) if family == "a" else (120, 826)
        row_y, row_step = (230, 41) if family == "a" else (237, 40)
        label_width, value_size = (174, 21) if family == "a" else (182, 20)
        title_size = 27
    elif kind == "tawtheeq_contract":
        image = Image.new("RGB", (1240, 1754), "white")
        page = (0, 0, 1240, 1754)
        row_x, row_width = (54, 1132) if family == "a" else (66, 1108)
        row_y, row_step = (260, 77) if family == "a" else (276, 76)
        label_width, value_size = (278, 26) if family == "a" else (284, 25)
        title_size = 32
    elif kind == "title_deed":
        image = Image.new("RGB", (1754, 1240), "white")
        page = (0, 0, 1754, 1240)
        row_x, row_width = (64, 1626) if family == "a" else (82, 1590)
        row_y, row_step = (252, 73) if family == "a" else (267, 72)
        label_width, value_size = (360, 29) if family == "a" else (370, 27)
        title_size = 39
    else:
        raise ValueError(f"Unknown document kind: {kind}")
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = page
    draw.rectangle((left, top, right - 1, bottom - 1), fill=(252, 251, 246), outline=(98, 112, 119), width=2)
    draw.rectangle((left + 2, top + 2, right - 3, top + 9), fill=(83, 108, 119))
    decoration_boxes: list[list[int]] = []
    inset = 26 if is_card else 90
    marker_y = top + (23 if is_card else 70)
    title_y = top + (61 if is_card else 115)
    arabic_title_y = top + (111 if is_card else 169)
    decoration_boxes.append(draw_text(image, fonts, "SYNTHETIC SPECIMEN", left + inset, marker_y,
                                      right - left - 2 * inset, 16, bold=True))
    title_en, title_ar = TITLES[kind]
    decoration_boxes.append(draw_text(image, fonts, title_en, left + inset, title_y,
                                      right - left - 2 * inset, title_size, bold=True, align="center"))
    decoration_boxes.append(draw_text(image, fonts, title_ar, left + inset, arabic_title_y,
                                      right - left - 2 * inset, title_size + 2, bold=True, align="right"))
    if is_card:
        photo_x = left + 26 if family == "a" else right - 136
        draw.rectangle((photo_x, top + 225, photo_x + 108, top + 364), fill=(179, 179, 179))
        draw_text(image, fonts, "PHOTO", photo_x + 4, top + 278, 100, 15, align="center")
        draw_text(image, fonts, "صورة", photo_x + 4, top + 305, 100, 16, align="right")
    omit = {field.name: conditions[field.name] == "absent" and rng.choice((False, True)) for field in CATALOGUE[kind]}
    for index, field in enumerate(CATALOGUE[kind]):
        if not omit[field.name]:
            y = row_y + index * row_step
            fill = (241, 244, 244) if index % 2 == 0 else (250, 250, 247)
            draw.rectangle((row_x, y - 8, row_x + row_width, y + row_step - 10), fill=fill)
            draw.line((row_x, y + row_step - 10, row_x + row_width, y + row_step - 10), fill=(207, 215, 215))
    _watermark(image, page, fonts)
    fields: dict[str, FieldLabel] = {}
    values: dict[str, Evidence] = {}
    decoys: dict[str, Evidence] = {}
    variant = 0 if family == "a" else 1
    for index, field in enumerate(CATALOGUE[kind]):
        condition, value = conditions[field.name], truth[field.name]
        label: FieldLabel = {
            "type": field.type, "script": field.script, "condition": condition,
            "value": value if condition == "readable" else None, "true_value": value,
            "printed": None, "render_box": None, "image_box": None, "decoy": None,
        }
        fields[field.name] = label
        if omit[field.name]:
            continue
        y = row_y + index * row_step
        en, ar = field.en[variant], field.ar[variant]
        if condition == "distractor":
            en, ar = field.decoy_en, field.decoy_ar
        english_x = row_x + 8 if family == "a" else row_x + row_width - label_width + 8
        arabic_x = row_x + row_width - label_width + 8 if family == "a" else row_x + 8
        label_size = 15 if is_card else 20 if kind == "tawtheeq_contract" else 23
        decoration_boxes.append(draw_text(image, fonts, en, english_x, y + 3,
                                          label_width - 16, label_size, align="left"))
        decoration_boxes.append(draw_text(image, fonts, ar, arabic_x, y + 2,
                                          label_width - 16, label_size + 1, align="right"))
        if condition == "absent":
            continue
        if condition == "distractor":
            decoy = value
            while decoy == value:
                decoy = make_record(kind, rng)[field.name]
            printed = formatted_value(field, decoy, family, digits, rng)
        else:
            printed = formatted_value(field, value, family, digits, rng)
        before = image.copy()
        value_x, value_width = row_x + label_width + 10, row_width - 2 * label_width - 20
        box = draw_text(image, fonts, printed, value_x, y, value_width, value_size,
                        align="right" if is_arabic(printed) else "center",
                        identifier=field.type in ("id_number", "code"))
        evidence = _evidence(image, before, printed, box)
        if condition == "distractor":
            decoys[field.name] = evidence
            label["decoy"] = {"label_en": en, "label_ar": ar, "printed": printed, "value": decoy, "image_box": []}
            continue
        values[field.name] = evidence
        label["printed"], label["render_box"] = printed, box
        if condition == "occluded":
            x0, y0, x1, y1 = box_edges(box)
            evidence.cover_box = (x0 - 4, y0 - 4, x1 + 4, y1 + 4)
            evidence.cover_colour = rng.choice(((0, 0, 0), (43, 43, 43)))
            a, b, c, d = evidence.cover_box
            ImageDraw.Draw(image).rectangle((a, b, c - 1, d - 1), fill=evidence.cover_colour)
    if not is_card:
        decoration_boxes.append(draw_text(image, fonts, "Synthetic specimen generated for evaluation. Not a valid document.",
                                           90, bottom - 135, right - 180, 20, align="center"))
        decoration_boxes.append(draw_text(image, fonts, "عينة اصطناعية لأغراض التقييم وليست مستندا صالحا.",
                                           90, bottom - 97, right - 180, 22, align="right"))
    return CleanRender(image, page, fields, values, decoys, decoration_boxes)
