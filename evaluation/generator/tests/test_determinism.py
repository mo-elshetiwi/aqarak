"""AC-5: reproduce the first two documents of every kind from frozen seeds."""

import json
import random
import tempfile
import unittest
from pathlib import Path

from generate import generate, generate_document
from docgen.render import Fonts
from tests.test_dataset import DATASET, EXPECTED_FIELDS


class DeterminismTests(unittest.TestCase):
    """Compare actual JPEG bytes and full label records across fresh render passes."""

    def test_first_two_per_kind_from_recorded_seed(self) -> None:
        """AC-5: regenerate six complete files into a temporary folder using recorded seeds."""
        records = {record["doc_id"]: record for record in map(json.loads, (DATASET / "labels.jsonl").read_text(encoding="utf-8").splitlines())}
        fonts = Fonts()
        with tempfile.TemporaryDirectory(prefix=".determinism-", dir=Path(__file__).parent) as folder:
            out = Path(folder)
            for kind in EXPECTED_FIELDS:
                for index in (1, 2):
                    with self.subTest(kind=kind, index=index):
                        expected = records[f"{kind}-{index:03d}"]
                        record, image = generate_document(kind, index, expected["seed"], expected["capture"]["digits"], fonts)
                        image_path = out / expected["image"]
                        image_path.parent.mkdir(exist_ok=True)
                        image_path.write_bytes(image)
                        label_path = out / f"{expected['doc_id']}.jsonl"
                        label_path.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
                        self.assertEqual(image_path.read_bytes(), (DATASET / expected["image"]).read_bytes())
                        self.assertEqual(json.loads(label_path.read_text(encoding="utf-8")), expected)
                        self.assertEqual(label_path.read_bytes(), (json.dumps(expected, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))

    def test_only_mode_and_global_random_state(self) -> None:
        """Exercise spot regeneration without a partial split or mutation of global randomness."""
        before = random.getstate()
        with tempfile.TemporaryDirectory(prefix=".spot-", dir=Path(__file__).parent) as folder:
            out = Path(folder)
            records = generate(out, only="emirates_id-001")
            self.assertEqual(len(records), 1)
            expected = json.loads((DATASET / "labels.jsonl").read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(records[0], expected)
            self.assertEqual((out / expected["image"]).read_bytes(), (DATASET / expected["image"]).read_bytes())
            self.assertFalse((out / "manifest.json").exists())
            self.assertFalse((out / "splits.json").exists())
            (out / "manifest.json").write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "separate output folder"):
                generate(out, only="emirates_id-001")
        self.assertEqual(random.getstate(), before)
