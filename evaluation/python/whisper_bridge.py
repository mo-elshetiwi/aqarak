"""I isolate local speech inference behind a persistent JSON-lines protocol."""
import argparse
import json
import sys


def serve(model, source, destination, beam_size=5):
    """Return one result for each request while keeping model weights loaded."""
    for line in source:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if not isinstance(request_id, str) or not isinstance(request.get("path"), str):
                raise ValueError("invalid_request")
            segments, info = model.transcribe(
                request["path"], beam_size=beam_size, temperature=0.0,
                condition_on_previous_text=False, language=None, vad_filter=False,
            )
            result = {
                "id": request_id,
                "text": " ".join(segment.text.strip() for segment in segments).strip(),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration_s": info.duration,
                "error": None,
            }
        except Exception:
            result = {"id": request_id, "text": None, "language": None,
                      "language_probability": None, "duration_s": None,
                      "error": "transcription_error"}
        destination.write(json.dumps(result, ensure_ascii=False) + "\n")
        destination.flush()


def main():
    """Load verified local weights and consume requests until stdin closes."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    arguments = parser.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(arguments.model_dir, device="cpu", compute_type=arguments.compute_type, local_files_only=True)
    serve(model, sys.stdin, sys.stdout, arguments.beam_size)


if __name__ == "__main__":
    main()
