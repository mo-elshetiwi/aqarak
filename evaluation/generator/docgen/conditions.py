"""Seeded field conditions and exact digit-script allocation."""

import random

from .catalogue import CATALOGUE, Condition
from .identities import document_seed

CONDITIONS: tuple[Condition, ...] = ("readable", "absent", "occluded", "distractor")
PROBABILITIES = (0.72, 0.10, 0.10, 0.08)


def draw_conditions(kind: str, rng: random.Random) -> dict[str, Condition]:
    """Sample independently, then promote fields only to satisfy the readability floor."""
    result = {field.name: rng.choices(CONDITIONS, PROBABILITIES, k=1)[0] for field in CATALOGUE[kind]}
    required = (len(result) + 1) // 2
    readable = sum(value == "readable" for value in result.values())
    if readable < required:
        candidates = [name for name, condition in result.items() if condition != "readable"]
        for name in rng.sample(candidates, required - readable):
            result[name] = "readable"
    return result


def indic_indices(master_seed: int, kind: str, per_kind: int) -> set[int]:
    """Select exactly 30 percent per kind at the frozen size, independently of render order."""
    rng = random.Random(document_seed(master_seed, kind, 0))
    return set(rng.sample(range(1, per_kind + 1), (per_kind * 3 + 5) // 10))
