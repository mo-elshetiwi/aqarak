"""I verify the speech line protocol without loading weights."""
import io
import json
import unittest
from types import SimpleNamespace
from whisper_bridge import serve


class FakeModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, path, **parameters):
        self.calls.append((path, parameters))
        if path == "bad.wav":
            raise RuntimeError("content must not escape")
        return iter([SimpleNamespace(text=" synthetic"), SimpleNamespace(text=" text ")]), SimpleNamespace(language="ar", language_probability=0.9, duration=5)


class BridgeTests(unittest.TestCase):
    def test_three_requests_reuse_one_model(self):
        model = FakeModel()
        output = io.StringIO()
        source = io.StringIO("\n".join(json.dumps({"id": str(i), "path": "fake.wav", "language": None}) for i in range(3)))
        serve(model, source, output)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(model.calls), 3)
        self.assertEqual([line["id"] for line in lines], ["0", "1", "2"])
        self.assertEqual(lines[0]["text"], "synthetic text")
        self.assertEqual(model.calls[0][1], {"beam_size": 5, "temperature": 0.0, "condition_on_previous_text": False, "language": None, "vad_filter": False})

    def test_error_is_sanitized_and_next_line_still_runs(self):
        output = io.StringIO()
        serve(FakeModel(), io.StringIO('{"id":"bad","path":"bad.wav"}\n{"id":"ok","path":"fake.wav"}\n'), output)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(lines[0]["error"], "transcription_error")
        self.assertNotIn("content must not escape", output.getvalue())
        self.assertIsNone(lines[1]["error"])


if __name__ == "__main__":
    unittest.main()
