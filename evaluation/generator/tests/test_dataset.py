"""AC-2 through AC-4: independently inspect the committed dataset and frozen split."""

import hashlib
import json
import random
import unittest
from collections import Counter
from pathlib import Path

from PIL import Image

DATASET = Path(__file__).resolve().parents[2] / "datasets" / "synthetic-docs-v1"
EXPECTED_FIELDS = {
    "emirates_id": "id_number name_en name_ar nationality_en nationality_ar date_of_birth sex issue_date expiry_date card_number".split(),
    "tawtheeq_contract": "contract_number registration_date landlord_name_en landlord_name_ar tenant_name_en tenant_name_ar tenant_id_number unit_number plot_number district_en district_ar property_usage start_date end_date annual_rent security_deposit number_of_cheques".split(),
    "title_deed": "deed_number issue_date owner_name_en owner_name_ar owner_id_number plot_number unit_number district_en district_ar property_type area_sq_m".split(),
}


class DatasetTests(unittest.TestCase):
    """Test the files on disk rather than trusting a generator completion message."""

    @classmethod
    def setUpClass(cls) -> None:
        """Read the frozen labels, manifest and split once for independent assertions."""
        cls.records = [json.loads(line) for line in (DATASET / "labels.jsonl").read_text(encoding="utf-8").splitlines()]
        cls.manifest = json.loads((DATASET / "manifest.json").read_text(encoding="utf-8"))
        cls.splits = json.loads((DATASET / "splits.json").read_text(encoding="utf-8"))

    def test_counts_conditions_and_catalogue(self) -> None:
        """AC-2: assert exact enumerated catalogues, synthetic flags and readability quotas."""
        self.assertEqual(len(self.records), 120)
        ids = [record["doc_id"] for record in self.records]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(len(set(ids)), 120)
        for kind, names in EXPECTED_FIELDS.items():
            documents = [record for record in self.records if record["kind"] == kind]
            self.assertEqual(len(documents), 40)
            self.assertEqual([r["doc_id"] for r in documents], [f"{kind}-{index:03d}" for index in range(1, 41)])
            counts = Counter(field["condition"] for record in documents for field in record["fields"].values())
            self.assertGreaterEqual(sum(counts.values()) - counts["readable"], len(names) * 40 * 0.2)
            self.assertEqual(dict(counts), self.manifest["conditions"][kind])
            self.assertEqual(Counter(r["layout_family"] for r in documents), {"a": 20, "b": 20})
            self.assertEqual(sum(r["capture"]["digits"] == "arabic_indic" for r in documents), 12)
            for record in documents:
                self.assertIs(record["synthetic"], True)
                self.assertEqual(record["generator_version"], "1.0.0")
                self.assertEqual(list(record["fields"]), names)
                self.assertGreaterEqual(sum(f["condition"] == "readable" for f in record["fields"].values()), (len(names) + 1) // 2)
                self.assertTrue(record["render_check"]["passed"])

    def test_exact_label_contract(self) -> None:
        """Check supported/null values, recorded draw events and capture bounds for every field."""
        outer = "doc_id kind synthetic generator_version seed layout_family image image_sha256 width height capture fields render_check".split()
        keys = "type script condition value true_value printed render_box image_box decoy".split()
        for record in self.records:
            self.assertEqual(list(record), outer)
            capture = record["capture"]
            self.assertIn(capture["blur_sigma"], (0, 0.6, 1.0))
            self.assertTrue(0 <= capture["glare"]["opacity"] <= 0.2)
            self.assertLessEqual(abs(capture["rotation_deg"]), 2)
            self.assertTrue(60 <= capture["jpeg_quality"] <= 92)
            self.assertEqual(len(capture["perspective_jitter"]), 4)
            self.assertTrue(all(abs(value) <= 0.025 for pair in capture["perspective_jitter"] for value in pair))
            counts = Counter(f["condition"] for f in record["fields"].values())
            self.assertEqual(record["render_check"], {
                "readable_drawn": counts["readable"], "occluded_covered": counts["occluded"],
                "absent_not_drawn": counts["absent"], "decoys_drawn": counts["distractor"], "passed": True,
            })
            for name, field in record["fields"].items():
                self.assertEqual(list(field), keys)
                self.assertIn(field["type"], ("id_number", "name", "text", "date", "money", "integer", "decimal", "code"))
                self.assertEqual(field["script"], "arabic" if name.endswith("_ar") else "latin" if name.endswith("_en") else "neutral")
                self.assertIsInstance(field["true_value"], str)
                self.assertEqual(field["value"], field["true_value"] if field["condition"] == "readable" else None)
                if field["condition"] in ("readable", "occluded"):
                    self.assertIsInstance(field["printed"], str)
                    self.assertEqual(len(field["render_box"]), 4)
                    self.assertEqual(len(field["image_box"]), 4)
                    x, y, width, height = field["image_box"]
                    self.assertTrue(0 <= x < x + width <= record["width"])
                    self.assertTrue(0 <= y < y + height <= record["height"])
                else:
                    self.assertIsNone(field["printed"])
                    self.assertIsNone(field["render_box"])
                    self.assertIsNone(field["image_box"])
                if field["condition"] == "distractor":
                    decoy = field["decoy"]
                    self.assertEqual(list(decoy), "label_en label_ar printed value image_box".split())
                    self.assertNotEqual(decoy["value"], field["true_value"])
                    self.assertTrue(decoy["label_en"] and decoy["label_ar"] and decoy["printed"])
                    self.assertEqual(len(decoy["image_box"]), 4)
                else:
                    self.assertIsNone(field["decoy"])
                if field["type"] == "date":
                    self.assertRegex(field["true_value"], r"^\d{4}-\d{2}-\d{2}$")
                elif field["type"] == "money":
                    self.assertRegex(field["true_value"], r"^\d+\.\d{2}$")
                elif field["type"] == "decimal":
                    self.assertRegex(field["true_value"], r"^\d+\.\d$")

    def test_manifest_and_image_integrity(self) -> None:
        """AC-3: recompute every manifest byte count and hash, including each image label hash."""
        expected = {record["image"] for record in self.records} | {"labels.jsonl", "splits.json"}
        entries = self.manifest["files"]
        self.assertEqual(len(entries), 122)
        self.assertEqual({entry["path"] for entry in entries}, expected)
        self.assertEqual(self.manifest["counts"], {"emirates_id": 40, "tawtheeq_contract": 40, "title_deed": 40, "total": 120})
        for entry in entries:
            data = (DATASET / entry["path"]).read_bytes()
            self.assertEqual(len(data), entry["bytes"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
        self.assertEqual({path.relative_to(DATASET).as_posix() for path in (DATASET / "images").iterdir()}, expected - {"labels.jsonl", "splits.json"})
        for record in self.records:
            path = DATASET / record["image"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), record["image_sha256"])
            with Image.open(path) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertEqual(image.size, (record["width"], record["height"]))
                self.assertFalse(image.getexif())
                image.verify()
        self.assertLess(sum(path.stat().st_size for path in DATASET.rglob("*") if path.is_file()), 25_000_000)

    def test_frozen_splits_and_hashes(self) -> None:
        """AC-4: prove partition membership, exact shuffle replay and canonical hash identity."""
        screening, held = self.splits["screening"], self.splits["held_out"]
        self.assertEqual(self.splits["dataset"], "synthetic-docs-v1")
        self.assertEqual(self.splits["seed"], 20260928)
        self.assertEqual(len(screening), 30)
        self.assertEqual(len(held), 90)
        self.assertFalse(set(screening) & set(held))
        self.assertEqual(set(screening) | set(held), {record["doc_id"] for record in self.records})
        images = {record["doc_id"]: record["image_sha256"] for record in self.records}
        for kind in EXPECTED_FIELDS:
            self.assertEqual(sum(doc_id.startswith(kind + "-") for doc_id in screening), 10)
            self.assertEqual(sum(doc_id.startswith(kind + "-") for doc_id in held), 30)
            ids = sorted(doc_id for doc_id in images if doc_id.startswith(kind + "-"))
            random.Random(20260928).shuffle(ids)
            self.assertEqual(set(ids[:10]), {doc_id for doc_id in screening if doc_id.startswith(kind + "-")})
        for key in ("screening", "held_out"):
            pairs = [[doc_id, images[doc_id]] for doc_id in sorted(self.splits[key])]
            encoded = json.dumps(pairs, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            self.assertEqual(hashlib.sha256(encoded).hexdigest(), self.splits[f"{key}_sha256"])
