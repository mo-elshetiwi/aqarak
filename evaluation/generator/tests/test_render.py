"""AC-7: verify Arabic shaping, pinned font failures and shared capture geometry."""

import random
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from docgen.capture import homography, sample_capture, transform_box
from docgen.catalogue import CATALOGUE
from docgen.conditions import draw_conditions
from docgen.identities import make_record
from docgen.render import FONT_HASHES, INDIC, TITLES, Fonts, draw_text, formatted_value, render_document
from docgen.validate import require_valid_render


class RenderTests(unittest.TestCase):
    """Check shaping behaviour, explicit display formats and transform mathematics."""

    def test_raqm_shapes_arabic(self) -> None:
        """AC-7: prove Arabic joining by comparing shaped width with isolated character widths."""
        fonts = Fonts()
        for bold in (False, True):
            font = fonts.get(32, bold)
            self.assertEqual(font.layout_engine, ImageFont.Layout.RAQM)
            text = "العربية المتصلة"
            shaped = font.getlength(text, direction="rtl", language="ar")
            isolated = sum(font.getlength(character, direction="rtl", language="ar") for character in text)
            self.assertGreater(abs(shaped - isolated), 10)

    def test_specimen_markers_in_both_layouts(self) -> None:
        """Check that every layout draws both diagonal watermark scripts and required titles."""
        fonts = Fonts()
        for kind in CATALOGUE:
            for family in ("a", "b"):
                with self.subTest(kind=kind, family=family):
                    rng = random.Random(61)
                    truth = make_record(kind, rng)
                    conditions = draw_conditions(kind, rng)
                    with patch("docgen.render.draw_text", wraps=draw_text) as drawing:
                        render = render_document(kind, truth, conditions, family, "western", rng, fonts)
                    strings = [call.args[2] for call in drawing.call_args_list]
                    for text in ("SYNTHETIC SPECIMEN", "SPECIMEN", "عينة", *TITLES[kind]):
                        self.assertIn(text, strings)
                    if kind != "emirates_id":
                        self.assertIn("Synthetic specimen generated for evaluation. Not a valid document.", strings)
                        self.assertIn("عينة اصطناعية لأغراض التقييم وليست مستندا صالحا.", strings)
                    pixels = np.asarray(render.image, dtype=np.int16)
                    self.assertGreater(np.count_nonzero(pixels[:, :, 0] - pixels[:, :, 1] > 10), 1000)
                    self.assertTrue(require_valid_render(render)["passed"])

    def test_missing_raqm_and_font_mismatch_fail(self) -> None:
        """Fail explicitly instead of substituting another font or layout engine."""
        with patch("docgen.render.features.check_feature", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "requires Pillow with raqm"):
                Fonts()
        with patch.dict(FONT_HASHES, {"DejaVuSans.ttf": "0" * 64}):
            with self.assertRaisesRegex(RuntimeError, "font hash mismatch"):
                Fonts()
        with patch("docgen.render.Path.is_file", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "font is missing"):
                Fonts()

    def test_neutral_formats(self) -> None:
        """Keep canonical truth separate from date, currency, digit and bilingual code displays."""
        rng = random.Random(3)
        fields = {field.name: field for field in CATALOGUE["tawtheeq_contract"]}
        self.assertEqual(formatted_value(fields["annual_rent"], "85000.00", "a", "western", rng), "AED 85,000.00")
        self.assertEqual(formatted_value(fields["annual_rent"], "85000.00", "b", "western", rng), "85,000")
        self.assertEqual(formatted_value(fields["annual_rent"], "85000.00", "a", "arabic_indic", rng), "٨٥٬٠٠٠ درهم")
        self.assertEqual(formatted_value(fields["start_date"], "2026-01-12", "a", "western", rng), "12/01/2026")
        self.assertEqual(formatted_value(fields["property_usage"], "RESIDENTIAL", "a", "western", rng), "Residential / سكني")

    def test_identifier_pixels_keep_group_order(self) -> None:
        """Read separated glyph masks left to right to prove the visible identifier order."""
        fonts = Fonts()
        examples = ("784-1960-0001031-2", "000123456", "SPC-2026-123456",
                    "SPC-D-1234567", "P44-305", "V-44", "B-305", "1204")
        for digits in ("western", "arabic_indic"):
            for example in examples:
                text = example.translate(INDIC) if digits == "arabic_indic" else example
                with self.subTest(digits=digits, identifier=example):
                    image = Image.new("L", (1000, 100), 255)
                    draw_text(image, fonts, text, 10, 10, 980, 32, colour=0, identifier=True)
                    ink = np.asarray(image) < 128
                    columns = np.flatnonzero(ink.any(axis=0))
                    groups = np.split(columns, np.flatnonzero(np.diff(columns) > 1) + 1)
                    self.assertEqual(len(groups), len(text))
                    for character, columns in zip(text, groups, strict=True):
                        actual = ink[:, columns[0]:columns[-1] + 1]
                        actual = actual[actual.any(axis=1)]
                        reference = Image.new("L", (100, 100), 255)
                        ImageDraw.Draw(reference).text((10, 10), character, font=fonts.get(32),
                                                       direction="ltr", language="en", fill=0)
                        expected = np.asarray(reference) < 128
                        expected = expected[expected.any(axis=1)][:, expected.any(axis=0)]
                        np.testing.assert_array_equal(actual, expected, err_msg=f"Visible glyph for {character}")

    def test_arabic_letters_remain_rtl(self) -> None:
        """Keep Arabic letter runs shaped RTL and right anchored."""
        image = Image.new("RGB", (1000, 100), "white")
        fonts = Fonts()
        original = ImageDraw.ImageDraw.text
        with patch.object(ImageDraw.ImageDraw, "text", autospec=True, side_effect=original) as drawing:
            draw_text(image, fonts, "سعيد منصور", 0, 40, 900, 25)
            self.assertEqual(drawing.call_args.kwargs["direction"], "rtl")
            self.assertEqual(drawing.call_args.kwargs["language"], "ar")
            self.assertEqual(drawing.call_args.kwargs["anchor"], "rt")

    def test_box_transform_identity_and_translation(self) -> None:
        """Check known geometric results independently of OpenCV's image rendering."""
        matrix = np.eye(3)
        self.assertEqual(transform_box([10, 20, 30, 40], matrix), [10, 20, 30, 40])
        matrix[0, 2], matrix[1, 2] = 7, -4
        self.assertEqual(transform_box([10, 20, 30, 40], matrix), [17, 16, 30, 40])
        capture = sample_capture(random.Random(6), "western")
        capture["perspective_jitter"] = [[0.0, 0.0]] * 4
        capture["rotation_deg"] = 0.0
        np.testing.assert_allclose(homography(1200, 800, capture), np.eye(3), atol=1e-12)

    def test_box_encloses_all_projected_corners(self) -> None:
        """Check that perspective and rotation do not lose any corner of a target box."""
        capture = sample_capture(random.Random(71), "western")
        matrix = homography(1240, 1754, capture)
        box = [320, 400, 270, 38]
        x, y, width, height = transform_box(box, matrix)
        for px, py in ((320, 400), (590, 400), (590, 438), (320, 438)):
            vector = matrix @ np.array([px, py, 1.0])
            qx, qy = vector[:2] / vector[2]
            self.assertTrue(x - 0.001 <= qx <= x + width + 0.001)
            self.assertTrue(y - 0.001 <= qy <= y + height + 0.001)
