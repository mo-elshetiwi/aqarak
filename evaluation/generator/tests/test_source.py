"""Check the required annotation and documentation contract without added tooling."""

import ast
import unittest
from pathlib import Path


class SourceContractTests(unittest.TestCase):
    """Audit source signatures using the standard library in the pinned environment."""

    def test_function_annotations_and_public_docstrings(self) -> None:
        """Require every function signature to be annotated and every public function documented."""
        root = Path(__file__).resolve().parents[1]
        for path in sorted(root.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    with self.subTest(path=path.relative_to(root).as_posix(), function=node.name):
                        self.assertIsNotNone(node.returns)
                        args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
                        args.extend(arg for arg in (node.args.vararg, node.args.kwarg) if arg is not None)
                        for arg in args:
                            if arg.arg not in ("self", "cls"):
                                self.assertIsNotNone(arg.annotation)
                        if not node.name.startswith("_"):
                            self.assertTrue(ast.get_docstring(node))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print":
                    self.assertEqual(path.name, "generate.py")
