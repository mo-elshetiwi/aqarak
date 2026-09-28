"""Check clean pixels against measured glyph and cover evidence before capture."""

import numpy as np

from .catalogue import RenderCheck
from .render import CleanRender, Evidence, box_edges


def _inside(box: tuple[int, int, int, int], page: tuple[int, int, int, int]) -> bool:
    return page[0] <= box[0] < box[2] <= page[2] and page[1] <= box[1] < box[3] <= page[3]


def _visible(render: CleanRender, evidence: Evidence) -> bool:
    return (_inside(box_edges(evidence.box), render.page_box) and evidence.ink_pixels > 0
            and render.image.crop(box_edges(evidence.box)).tobytes() == evidence.pixels)


def check_render(render: CleanRender) -> RenderCheck:
    """Prove drawn values and decoys retain ink, and covers include every margin pixel."""
    result: RenderCheck = {
        "readable_drawn": 0, "occluded_covered": 0,
        "absent_not_drawn": 0, "decoys_drawn": 0, "passed": True,
    }
    for name, field in render.fields.items():
        condition = field["condition"]
        own, decoy = render.values.get(name), render.decoys.get(name)
        valid = False
        if condition == "readable":
            valid = (own is not None and decoy is None and _visible(render, own)
                     and field["printed"] == own.printed and field["render_box"] == own.box
                     and field["value"] == field["true_value"])
            result["readable_drawn"] += int(valid)
        elif condition == "occluded":
            if own is not None and own.cover_box is not None and own.cover_colour is not None:
                pixels = np.asarray(render.image.crop(own.cover_box))
                valid = (_inside(own.cover_box, render.page_box) and own.ink_pixels > 0
                         and bool(np.all(pixels == own.cover_colour))
                         and field["printed"] == own.printed and field["render_box"] == own.box
                         and field["value"] is None and decoy is None)
            result["occluded_covered"] += int(valid)
        elif condition in ("absent", "distractor"):
            valid = (own is None and field["printed"] is None and field["render_box"] is None
                     and field["image_box"] is None and field["value"] is None)
            if condition == "absent":
                valid = valid and decoy is None and field["decoy"] is None
                result["absent_not_drawn"] += int(valid)
            else:
                valid = (valid and decoy is not None and _visible(render, decoy)
                         and field["decoy"] is not None
                         and field["decoy"]["printed"] == decoy.printed)
                result["decoys_drawn"] += int(valid)
        result["passed"] = result["passed"] and bool(valid)
    return result


def require_valid_render(render: CleanRender) -> RenderCheck:
    """Stop generation instead of exporting a document with incorrect render evidence."""
    result = check_render(render)
    if not result["passed"]:
        raise ValueError(f"Clean render validation failed: {result}")
    return result
