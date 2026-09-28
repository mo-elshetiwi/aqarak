"""AC-6: establish pixel validation and reject deliberately corrupted evidence."""

import random
import unittest

from PIL import ImageDraw

from docgen.catalogue import CATALOGUE, Condition
from docgen.identities import make_record
from docgen.render import CleanRender, Fonts, box_edges, render_document
from docgen.validate import check_render, require_valid_render


def specimen() -> CleanRender:
    """Build a controlled example containing every field condition."""
    rng = random.Random(7)
    truth = make_record("tawtheeq_contract", rng)
    conditions: dict[str, Condition] = {field.name: "readable" for field in CATALOGUE["tawtheeq_contract"]}
    conditions.update(annual_rent="occluded", security_deposit="absent", number_of_cheques="distractor")
    return render_document("tawtheeq_contract", truth, conditions, "a", "western", rng, Fonts())


class ValidationTests(unittest.TestCase):
    """Check clean render invariants and failure behaviour through actual pixel mutations."""

    def test_render_check_and_erased_value(self) -> None:
        """AC-6: validate all conditions and fail when a readable value is painted over."""
        render = specimen()
        self.assertEqual(check_render(render), {
            "readable_drawn": 14, "occluded_covered": 1, "absent_not_drawn": 1,
            "decoys_drawn": 1, "passed": True,
        })
        box = box_edges(render.values["contract_number"].box)
        ImageDraw.Draw(render.image).rectangle(box, fill="white")
        self.assertFalse(check_render(render)["passed"])
        with self.assertRaisesRegex(ValueError, "Clean render validation failed"):
            require_valid_render(render)

    def test_cover_margin_corruption(self) -> None:
        """Reject even one altered pixel in an occlusion's four-pixel margin."""
        render = specimen()
        evidence = render.values["annual_rent"]
        self.assertIsNotNone(evidence.cover_box)
        assert evidence.cover_box is not None
        x, y, _, _ = evidence.cover_box
        render.image.putpixel((x, y), (255, 255, 255))
        self.assertFalse(check_render(render)["passed"])

    def test_missing_decoy_and_unexpected_own_value(self) -> None:
        """Reject absent decoy glyphs and illegal draw events for missing target fields."""
        render = specimen()
        ImageDraw.Draw(render.image).rectangle(box_edges(render.decoys["number_of_cheques"].box), fill="white")
        self.assertFalse(check_render(render)["passed"])
        render = specimen()
        render.values["security_deposit"] = render.values["contract_number"]
        self.assertFalse(check_render(render)["passed"])

    def test_out_of_page_box(self) -> None:
        """Reject a readable value whose recorded box leaves the page."""
        render = specimen()
        render.values["contract_number"].box[0] = -1
        self.assertFalse(check_render(render)["passed"])
