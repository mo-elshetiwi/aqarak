"""AC-1: validate synthetic identifier patterns and their independent checksums."""

import random
import unittest
from datetime import date, timedelta
from decimal import Decimal

from docgen.identities import (DISTRICTS, FAMILY_NAMES, FIRST_NAMES, NATIONALITIES,
                               document_seed, emirates_id, make_record)


def valid_luhn(value: str) -> bool:
    """Check a completed identifier independently of the generation algorithm."""
    digits = [int(character) for character in value if character != "-"]
    for index in range(len(digits) - 2, -1, -2):
        digits[index] *= 2
        if digits[index] > 9:
            digits[index] -= 9
    return sum(digits) % 10 == 0


class IdentityTests(unittest.TestCase):
    """Check identifiers, vocabulary and plausible canonical records."""

    def test_emirates_id_pattern_and_luhn(self) -> None:
        """AC-1: exercise boundary years and the complete four-digit synthetic serial range."""
        for year in (1955, 1980, 2005):
            for serial in range(10000):
                value = emirates_id(year, serial)
                self.assertRegex(value, r"^784-\d{4}-000\d{4}-\d$")
                self.assertEqual(value.split("-")[1], str(year))
                self.assertTrue(valid_luhn(value))
        with self.assertRaises(ValueError):
            emirates_id(2006, 1)
        with self.assertRaises(ValueError):
            emirates_id(1980, 10000)

    def test_document_seeds_are_distinct_and_portable(self) -> None:
        """Keep frozen seeds distinct and exactly representable by common JSON consumers."""
        seeds = [document_seed(20260928, kind, index) for kind in
                 ("emirates_id", "tawtheeq_contract", "title_deed") for index in range(1, 41)]
        self.assertEqual(len(set(seeds)), 120)
        self.assertTrue(all(0 <= seed < 2 ** 32 for seed in seeds))

    def test_number_patterns(self) -> None:
        """AC-1: check every remaining identifier family over independently sampled records."""
        rng = random.Random(713)
        for _ in range(200):
            card = make_record("emirates_id", rng)
            contract = make_record("tawtheeq_contract", rng)
            deed = make_record("title_deed", rng)
            self.assertRegex(card["card_number"], r"^000\d{6}$")
            self.assertRegex(contract["contract_number"], r"^SPC-\d{4}-\d{6}$")
            self.assertRegex(deed["deed_number"], r"^SPC-D-\d{7}$")
            for record in (contract, deed):
                self.assertRegex(record["plot_number"], r"^P\d{2}-\d{3}$")
                self.assertRegex(record["unit_number"], r"^(?:\d{3,4}|B-\d{3}|V-\d{1,2})$")

    def test_paired_components(self) -> None:
        """Require broad paired name components and the specified ten-item vocabularies."""
        for pairs in (FIRST_NAMES, FAMILY_NAMES):
            self.assertGreaterEqual(len(pairs), 30)
            self.assertEqual(len(pairs), len(set(pairs)))
            for english, arabic in pairs:
                self.assertTrue(english.isascii())
                self.assertRegex(arabic, "[\u0600-\u06ff]")
        self.assertEqual(len(NATIONALITIES), 10)
        self.assertEqual(len(DISTRICTS), 10)

    def test_plausibility(self) -> None:
        """Check calendar relationships, money rounding and decimal precision independently."""
        rng = random.Random(201)
        for _ in range(500):
            card = make_record("emirates_id", rng)
            birth, issue, expiry = [date.fromisoformat(card[name]) for name in ("date_of_birth", "issue_date", "expiry_date")]
            self.assertTrue(1955 <= birth.year <= 2005)
            self.assertEqual(int(card["id_number"].split("-")[1]), birth.year)
            self.assertTrue(2 <= expiry.year - issue.year <= 10)
            self.assertGreater(issue, birth)
            self.assertEqual((issue.month, issue.day), (expiry.month, expiry.day))
            contract = make_record("tawtheeq_contract", rng)
            start, end, registration = [date.fromisoformat(contract[name]) for name in ("start_date", "end_date", "registration_date")]
            self.assertEqual(end, start.replace(year=start.year + 1) - timedelta(days=1))
            self.assertTrue(0 <= (start - registration).days <= 20)
            rent, deposit = Decimal(contract["annual_rent"]), Decimal(contract["security_deposit"])
            self.assertTrue(35000 <= rent <= 400000)
            self.assertEqual(rent % 500, 0)
            self.assertEqual(deposit % 100, 0)
            self.assertTrue(rent * Decimal("0.05") - 50 <= deposit <= rent * Decimal("0.10") + 50)
            self.assertIn(contract["number_of_cheques"], ("1", "2", "4", "6", "12"))
            deed = make_record("title_deed", rng)
            self.assertRegex(deed["area_sq_m"], r"^\d+\.\d$")
            self.assertTrue(45 <= Decimal(deed["area_sq_m"]) <= 650)
