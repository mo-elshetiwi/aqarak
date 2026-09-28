"""Canonical hashes, frozen partitions and dataset documentation."""

import hashlib
import json
import platform
import random
from collections import Counter
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy
import PIL
from PIL import features

from . import VERSION
from .catalogue import CATALOGUE, DocumentLabel
from .conditions import CONDITIONS
from .render import FONT_HASHES


def canonical_json(value: object) -> str:
    """Serialise the canonical JSON used for split hashes."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(data: bytes) -> str:
    """Hash exact bytes so formatting and image changes are observable."""
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    """Write stable UTF-8 JSON with a single final newline."""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def split_hash(ids: list[str], records: list[DocumentLabel]) -> str:
    """Hash document/image pairs in id order, independently of membership-list order."""
    images = {record["doc_id"]: record["image_sha256"] for record in records}
    pairs = [[doc_id, images[doc_id]] for doc_id in sorted(ids)]
    return sha256(canonical_json(pairs).encode("utf-8"))


def make_splits(records: list[DocumentLabel], seed: int, name: str) -> dict[str, Any]:
    """Freeze a quarter of each kind for screening before any extraction output exists."""
    screening: list[str] = []
    held_out: list[str] = []
    for kind in CATALOGUE:
        ids = sorted(record["doc_id"] for record in records if record["kind"] == kind)
        random.Random(seed).shuffle(ids)
        count = len(ids) // 4
        screening.extend(ids[:count])
        held_out.extend(ids[count:])
    screening.sort()
    held_out.sort()
    return {
        "dataset": name, "seed": seed,
        "rule": f"Per kind, sort the ids, shuffle once with random.Random({seed}), the first {len(screening) // 3} form the screening split and the remaining {len(held_out) // 3} the held-out split; the held-out split excludes every screening document and is frozen before any model output exists.",
        "screening": screening, "held_out": held_out,
        "screening_sha256": split_hash(screening, records), "held_out_sha256": split_hash(held_out, records),
    }


def condition_counts(records: list[DocumentLabel]) -> dict[str, dict[str, int]]:
    """Count each planted condition per kind using the exported field labels."""
    result = {}
    for kind in CATALOGUE:
        counter = Counter(field["condition"] for record in records if record["kind"] == kind
                          for field in record["fields"].values())
        result[kind] = {condition: counter[condition] for condition in CONDITIONS}
    return result


def write_manifest(out: Path, records: list[DocumentLabel], seed: int, command: str) -> dict[str, Any]:
    """Inventory every image and both hashed label/split files with portable provenance."""
    paths = sorted([record["image"] for record in records] + ["labels.jsonl", "splits.json"])
    counts = {kind: sum(record["kind"] == kind for record in records) for kind in CATALOGUE}
    manifest = {
        "name": out.name, "version": VERSION, "generator_version": VERSION, "master_seed": seed,
        "command": command, "counts": {**counts, "total": len(records)},
        "conditions": condition_counts(records),
        "fonts": [{"file": name, "sha256": digest, "source": "matplotlib/mpl-data/fonts/ttf"}
                  for name, digest in FONT_HASHES.items()],
        "runtime": {"python": platform.python_version(), "pillow": PIL.__version__, "numpy": numpy.__version__,
                    "opencv": version("opencv-python-headless"), "raqm": features.version("raqm")},
        "files": [{"path": path, "bytes": (out / path).stat().st_size,
                   "sha256": sha256((out / path).read_bytes())} for path in paths],
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def write_datasheet(out: Path, manifest: dict[str, Any]) -> None:
    """Document the synthetic set using the question groups of Datasheets for Datasets."""
    lines = [
        "# Synthetic document set version 1", "", "Author: Mohamed Elshetiwi", "",
        "## Motivation", "",
        "I generated this set to measure per-field extraction accuracy, missing-field rate and unsupported fill under controlled visibility conditions. I follow the question groups of Datasheets for Datasets (Gebru et al., 2021).", "",
        "## Composition", "",
        f"I generated {manifest['counts']['total']} JPEG documents with paired Arabic and English labels. I report the exact condition counts below, computed from the exported labels.", "",
        "| Kind | Documents | Fields per document | Readable | Absent | Occluded | Distractor |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for kind in CATALOGUE:
        counts = manifest["conditions"][kind]
        lines.append(f"| {kind} | {manifest['counts'][kind]} | {len(CATALOGUE[kind])} | "
                     + " | ".join(str(counts[name]) for name in CONDITIONS) + " |")
    lines += [
        "", "I retain the catalogue's field names and order. The identity card has 10 fields, the contract certificate 17 and the title deed 11.", "",
        "## Generation process and synthetic flags", "",
        f"I use master seed {manifest['master_seed']} and independently derived document seeds. I sample names from fixed bilingual first-name and family-name components, not from a list of people. All records carry synthetic: true. I reserve the 000 identifier serial block, use specimen-prefixed contract and deed references, and print both diagonal SPECIMEN and عينة watermarks plus the SYNTHETIC SPECIMEN header. I include no issuing body, emblem, code image, face or signature. The card photo area is a plain grey box.", "",
        "I sample conditions independently with probabilities 0.72 readable, 0.10 absent, 0.10 occluded and 0.08 distractor, then promote randomly selected fields if necessary to keep at least half readable. I reject a full generation with fewer than 20 percent non-readable field instances in any kind. An absent row is either empty or omitted at its reserved position. A distractor replaces that row's labels with different plausible bilingual labels and shows only its decoy. I retain canonical truth separately from supported values, and I use null for every non-readable target value.", "",
        "I check exact glyph crops, page bounds, every cover pixel including its four-pixel margin, missing own-value draw events, and decoy glyphs before capture. I store measured clean boxes for target values and transformed boxes for target values and decoys. The render check counts absent fields separately from distractor fields. I keep the latter in decoys_drawn.", "",
        "## Preprocessing", "",
        "I render with the two frozen matplotlib DejaVu fonts and explicit raqm shaping. I vary the bilingual columns and typography across two layout families per kind. I select exactly 30 percent of documents per kind for Arabic-Indic neutral values. I apply Gaussian blur with sigma 0, 0.6 or 1.0, radial glare with opacity at most 0.2, corner jitter at most 2.5 percent per axis, rotation at most two degrees and JPEG quality from 60 to 92. I transform all box corners with the same composed homography used for the image. The clean-render proof does not establish readability after capture.", "",
        "## Uses", "",
        "I freeze 10 documents per kind for screening and 30 per kind for held-out extraction evaluation. I initialise a fresh random.Random(master_seed) for each kind's sorted ids, shuffle once, and take the first quarter for screening. I hash id/image pairs in sorted id order. I use this set only for evaluation, never training. I exclude held-out documents from screening and tuning. I do not treat absent, occluded or distractor truth as a supported extraction answer. An occluded synthetic field may be mapped to a redacted null reason in a later evaluator; no extraction-output schema is defined here.", "",
        "## Distribution", "",
        "I distribute synthetic images and labels within this repository. I use no sourced personal data or real document images. Random name combinations can coincide with names held by real people; they do not identify those people. The font binaries remain in the existing runtime, and I record their hashes and bundled source without redistributing them.", "",
        "## Maintenance", "",
        "I preserve this version and its split hashes on record. A dataset defect requires a new dataset and generator version, fresh manifests and a new documented split. I do not silently repair a frozen benchmark or its labels.", "",
        "## Limitations", "",
        "I provide look-alike layouts only, with two layout families and DejaVu typography. I simulate capture effects and include no real capture noise. My labels are exact by construction and do not measure labelling disagreement. I do not represent official security features, real issuer layouts, handwriting or faces. I constrain sampled calendar days to 1 through 28. My synthetic combinations, script allocation and condition floor are controlled design choices, not estimates of any population. Results on this set cannot establish accuracy on real documents.", "",
    ]
    (out / "DATASHEET.md").write_text("\n".join(lines), encoding="utf-8")
