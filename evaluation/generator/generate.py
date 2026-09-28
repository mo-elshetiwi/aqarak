"""Generate deterministic synthetic documents and their frozen evaluation evidence."""

import argparse
import json
import random
import re
import shlex
from pathlib import Path

from docgen import MASTER_SEED, VERSION
from docgen.capture import apply_capture, sample_capture, transform_box
from docgen.catalogue import CATALOGUE, DocumentLabel
from docgen.conditions import draw_conditions, indic_indices
from docgen.identities import document_seed, make_record
from docgen.manifest import condition_counts, make_splits, sha256, write_datasheet, write_json, write_manifest
from docgen.render import Fonts, render_document
from docgen.validate import require_valid_render


def generate_document(kind: str, index: int, seed: int, digits: str, fonts: Fonts) -> tuple[DocumentLabel, bytes]:
    """Render one document from its recorded seed, independently of any other document."""
    rng = random.Random(seed)
    truth = make_record(kind, rng)
    conditions = draw_conditions(kind, rng)
    family = "a" if index % 2 else "b"
    capture = sample_capture(rng, digits)
    clean = render_document(kind, truth, conditions, family, digits, rng, fonts)
    check = require_valid_render(clean)
    encoded, matrix = apply_capture(clean.image, capture)
    boxes = clean.decoration_boxes + [evidence.box for evidence in (*clean.values.values(), *clean.decoys.values())]
    for box in boxes:
        x, y, width, height = transform_box(box, matrix)
        if not (0 <= x < x + width <= clean.image.width and 0 <= y < y + height <= clean.image.height):
            raise ValueError(f"Capture clips required content: {kind}-{index:03d}")
    for name, field in clean.fields.items():
        if field["render_box"] is not None:
            field["image_box"] = transform_box(field["render_box"], matrix)
        if field["decoy"] is not None:
            field["decoy"]["image_box"] = transform_box(clean.decoys[name].box, matrix)
    doc_id = f"{kind}-{index:03d}"
    record: DocumentLabel = {
        "doc_id": doc_id, "kind": kind, "synthetic": True, "generator_version": VERSION,
        "seed": seed, "layout_family": family, "image": f"images/{doc_id}.jpg",
        "image_sha256": sha256(encoded), "width": clean.image.width, "height": clean.image.height,
        "capture": capture, "fields": clean.fields, "render_check": check,
    }
    return record, encoded


def generate(out: Path, per_kind: int = 40, seed: int = MASTER_SEED, only: str | None = None) -> list[DocumentLabel]:
    """Write a full dataset, or a standalone one-record spot regeneration without a split."""
    if not 1 <= per_kind <= 999:
        raise ValueError("--per-kind must be between 1 and 999")
    selected: tuple[str, int] | None = None
    if only:
        match = re.fullmatch(r"(emirates_id|tawtheeq_contract|title_deed)-(\d{3})", only)
        if match is None or not 1 <= int(match[2]) <= per_kind:
            raise ValueError("--only must name a document within --per-kind")
        selected = match[1], int(match[2])
        if (out / "manifest.json").exists():
            raise ValueError("Spot regeneration requires a separate output folder to preserve a frozen manifest")
    fonts = Fonts()
    out.mkdir(parents=True, exist_ok=True)
    (out / "images").mkdir(exist_ok=True)
    records: list[DocumentLabel] = []
    for kind in CATALOGUE:
        indic = indic_indices(seed, kind, per_kind)
        for index in range(1, per_kind + 1):
            if selected is not None and selected != (kind, index):
                continue
            digits = "arabic_indic" if index in indic else "western"
            record, encoded = generate_document(kind, index, document_seed(seed, kind, index), digits, fonts)
            (out / record["image"]).write_bytes(encoded)
            records.append(record)
    records.sort(key=lambda record: record["doc_id"])
    if not only:
        for kind, counts in condition_counts(records).items():
            total = sum(counts.values())
            if (total - counts["readable"]) * 5 < total:
                raise ValueError(f"{kind} has fewer than 20 percent non-readable fields; choose another version seed")
    (out / "labels.jsonl").write_text("".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
                                             for record in records), encoding="utf-8")
    if not only:
        write_json(out / "splits.json", make_splits(records, seed, out.name))
        command = f"python evaluation/generator/generate.py --out {shlex.quote(out.as_posix())}"
        if per_kind != 40:
            command += f" --per-kind {per_kind}"
        if seed != MASTER_SEED:
            command += f" --seed {seed}"
        manifest = write_manifest(out, records, seed, command)
        write_datasheet(out, manifest)
    return records


def main() -> None:
    """Parse the portable command line and report generation failures clearly."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--per-kind", type=int, default=40)
    parser.add_argument("--seed", type=int, default=MASTER_SEED)
    parser.add_argument("--only", help="Regenerate one id into a separate folder using the same master seed and size")
    args = parser.parse_args()
    try:
        records = generate(args.out, args.per_kind, args.seed, args.only)
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"Generation failed: {error}\n")
    print(f"Generated {len(records)} documents in {args.out.as_posix()}")
    print(f"Generator {VERSION}; master seed {args.seed}")
    print(f"Render checks passed: {sum(record['render_check']['passed'] for record in records)}/{len(records)}")
    if not args.only:
        print("Frozen screening and held-out splits written")
    print("SHA-256 image and label evidence written")


if __name__ == "__main__":
    main()
