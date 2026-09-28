# Evaluation

I use this workspace to collect reproducible screening receipts for document extraction and speech transcription. I keep candidate configuration in the API model registry and separate raw outputs from receipts containing hashes, counts, costs and statuses.

I place the screening code in `src`, the speech bridge in `python`, and synthetic run artefacts in `results`. Dataset generation and dataset files are maintained separately.

I run `pnpm --filter @aqarak/evaluation typecheck`, `pnpm --filter @aqarak/evaluation lint` and `pnpm --filter @aqarak/evaluation test` for local checks. These checks use hermetic fixtures and do not contact model services.

## Configuration and execution

I load configuration exclusively through `src/config.ts`. I provide variables through the invoking environment and do not load environment files. I select candidate ids from `services/api/src/models/model-registry.json` at run time, so model identifiers, weights references and prices have one source.

| Variable                    | My use                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AQARAK_DATA_DIR`           | Required directory for externally held public datasets.                                                                                    |
| `AQARAK_PRIVATE_RUNS_DIR`   | Speech output and prepared audio storage, defaulting to `runs` under the data directory. I require this to resolve outside the repository. |
| `AQARAK_WHISPER_MODELS_DIR` | Local speech weights, defaulting to `models/faster-whisper` under the data directory.                                                      |
| `AQARAK_EVAL_PYTHON`        | Python interpreter, defaulting to `~/.venvs/aqarak-eval/bin/python`.                                                                       |
| `OPENAI_API_KEY`            | Required only when I select an OpenAI candidate.                                                                                           |
| `OPENAI_BASE_URL`           | API base URL, defaulting to `https://api.openai.com/v1`.                                                                                   |
| `OLLAMA_HOST`               | Local server URL, defaulting to `http://127.0.0.1:11434`.                                                                                  |
| `LIVE_MODELS`               | Explicit live-test opt-in with value `1`; the default is `0`.                                                                              |
| `AWS_PROFILE`               | Profile selected by the SDK's default credential chain when I select the streaming speech candidate.                                       |

I inspect the command with `pnpm --filter @aqarak/evaluation screen -- --help`; help does not require configuration. I provide `--class` as `mc1_document_extraction` or `mc3_speech_to_text`, `--split screening`, comma-separated registry ids in `--candidates`, a filesystem-safe `--run-id`, and `--cap-usd` with up to six decimal places. I can add `--limit`, `--concurrency` and `--resume`. I use four API workers by default and one local worker, regardless of the API concurrency setting.

I treat the cap as a stop on starting further calls once recorded spend reaches the cap. I calculate cost from reported usage after each call; an already running call, its schema retry and other concurrent calls can take spend above the cap. I restore recorded spend for all selected candidates before resuming, and I retain receipts for failures, timeouts and budget stops.

I verify the local vision digest before each candidate run and stream-hash local speech weights before launching the bridge. I keep one bridge process per speech candidate, send JSON lines over its standard input, and close the process at the end. I require installed local weights and do not download weights. I prepare each speech source with `ffmpeg` as mono 16 kHz signed 16-bit PCM, cache by source hash and pass the same prepared bytes to every speech candidate.

## Data and receipts

I read synthetic documents from `evaluation/datasets/synthetic-docs-v1`. I check each image hash, the field catalogue and both ordered split hashes before starting calls. I read speech metadata from `mixat/labels.jsonl`, `mixat/screening_ids.txt` and `mixat/manifest.json` below `AQARAK_DATA_DIR`.

I write synthetic raw output to `evaluation/results/<run-id>/mc1_document_extraction/<candidate-id>/raw/`. I write speech raw output to `<AQARAK_PRIVATE_RUNS_DIR>/<run-id>/mc3_speech_to_text/<candidate-id>/raw/`. I keep all speech audio, reference transcripts and hypothesis text outside the repository because that dataset permits non-commercial evaluation only. I reject private output locations inside the repository, including paths that resolve there through symbolic links.

I keep the JSON-lines receipts for both classes under `evaluation/results/<run-id>/<class>/<candidate-id>/receipts.jsonl`. I start each file with a run header containing the Git revision, dataset manifest, split and registry hashes, command, price date and start time. I append complete model call records containing hashes, usage, cost, status and raw-output references. I keep keys, prompt content, images, audio and output text out of receipts and progress messages.

I resume only receipts whose status is `ok`, verify the previous header's provenance, and retain unsuccessful attempts when I retry them. I write raw files through an atomic rename before appending their receipts. I reject malformed receipt files rather than silently discarding incomplete evidence. I use a new run id after changing the Git revision, dataset or registry. I leave `scorerVersion` null during collection and record the scoring library's version separately when I score the receipts.

## Scoring completed runs / تقييم الفحوص المكتملة

I score a completed run locally without contacting a model or provider:

```sh
pnpm --filter @aqarak/evaluation score -- --run-id <id> --class mc1_document_extraction
pnpm --filter @aqarak/evaluation score -- --run-id <id> --class mc3_speech_to_text --candidates <id-a>,<id-b> --limitations <file>
pnpm --filter @aqarak/evaluation score -- --help
```

I load configuration through `src/config.ts`, including `AQARAK_DATA_DIR` for either class and `AQARAK_PRIVATE_RUNS_DIR` for speech. Help needs no configuration. I select every candidate subdirectory containing `receipts.jsonl` unless I provide comma-separated ids. I process candidate ids in sorted order and items in frozen split order. I inject paths, filesystem operations and the existing dataset and receipt readers into `scoreRun` so my tests use isolated fixtures.

I validate every receipt line, its run ownership, every raw-output SHA-256 and the dataset and split provenance before writing output. I reject receipts for items outside the split and candidate headers with differing Git revisions, registry hashes, price dates or split hashes. I require raw files to remain in their candidate's `raw` directory, including after symbolic-link resolution. I interpret the last receipt for an item as its final attempt and charge every attempt to total cost. I verify older attempts too: if a resumed run overwrote an earlier raw file with different bytes, I cannot score that evidence until the original bytes are available under the receipt's recorded path.

I retain the entire screening split in every item denominator, including after collection with `--limit`. I assign `not_run` to an item without a receipt, count it in status totals and treat it as failed extraction or a fully deleted speech hypothesis. My report states the missing-item count for each candidate, and both `per-kind.csv` and the report's per-kind table show `documents`, `not_run` and `readable_fields` for each kind. For extraction I verify labels, images and ordered split hashes with the existing synthetic loaders. I apply the existing screening rules with an absolute 0.02 margin, pooled field accuracy as the primary metric and only money or date fabrications as critical failures; I retain every fabrication in the fabrication outputs and distinguish `fabrications` from `critical_failures` in `summary.csv` and `scores.json`. The library rejects candidates below 0.95 schema validity, with critical failures, or outside three margins of the best primary metric.

I take speech membership and language groups from `datasets/speech-splits-v1.json` and recompute the ordered id/audio-hash-pair digest. I require matching MIXAT membership and source-manifest hashes. Collection receipts currently hash `mixat/screening_ids.txt`; I verify that digest independently, check it against the receipt header and retain the frozen pair digest in `scores.json`. I also accept headers using the verified frozen pair digest. I read references from the MIXAT `transcript` field and hypotheses only from private raw files. I compare every candidate, including the best itself, with the candidate having the lowest pooled WER, resolving ties by candidate id. I apply the existing relative 0.10 screening margin, successful-item proportion for schema validity and zero critical failures. I use paired bootstrap intervals for the WER difference, candidate minus best.

I write these artefacts under `results/<run-id>/<class>/` and print one path per file:

| Class | My output files                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| MC1   | `summary.csv`, `per-field.csv`, `per-kind.csv`, `fabrications.csv`, `document-outcomes.csv`, `scores.json`, `report.md` |
| MC3   | `summary.csv`, `per-language.csv`, `clip-scores.csv`, `scores.json`, `report.md`                                        |

I preserve full-precision numeric estimates and intervals in CSV and JSON. I group the extraction per-field table by candidate, document kind, field, type and script, counting readable and correct fields. I include per-kind pooled accuracy intervals and each labelled field's outcome. I keep speech outputs text-free: clip ids, languages, edit counts, reference lengths and statuses are sufficient to reproduce aggregation. I keep references and hypotheses outside the repository because MIXAT permits non-commercial evaluation only.

I calculate cost in USD from integer micro-USD receipts, including failed and superseded attempts. I divide extraction cost by the full document count and scale it to 1,000 items. I sum source durations over the full speech split, divide total cost by those seconds and scale it to 1,000 audio minutes. I calculate latency p50 and p95 from successful receipts using linear interpolation, and speech real-time-factor p50 from successful latency divided by the corresponding source duration. Empty successful-call populations produce empty latency cells in CSV and null in JSON; the existing report renderer displays zero, which I explain in its limitations.

I pass one nonempty trimmed limitation per line from `--limitations` to the report. Otherwise I list screening-only evidence, small n, synthetic documents for MC1 and laptop CPU or GPU execution for local candidates. I also state the denominator, retry and timing conventions. I render the report with `renderScreeningReport`, preserve receipt timestamps only, and use the library's fixed bootstrap seed so identical inputs produce byte-identical output. I validate and render all files before the first write; a filesystem failure during writing can leave a partial set, which I regenerate by rerunning the same command.

أقيّم الفحص المكتمل محلياً من الإيصالات والمخرجات المحفوظة، وأتحقق من البصمات قبل كتابة النتائج. أحتسب عناصر مجموعة الفحص كاملة، وأصنّف العنصر الذي لا يملك إيصالاً بالحالة `not_run`. أحفظ جداول الكلام دون النص المرجعي أو النص الناتج، وأبقي هذه النصوص خارج المستودع. أعيد تشغيل الأمر بالمدخلات نفسها لإنتاج الملفات نفسها حرفياً، وأتعامل مع النتائج بوصفها نتائج فحص أولي فقط.

## Validation

I run these checks separately to limit memory use:

```sh
pnpm --filter @aqarak/evaluation typecheck
pnpm --filter @aqarak/evaluation lint
pnpm --filter @aqarak/evaluation test
~/.venvs/aqarak-eval/bin/python -m unittest discover -s evaluation/python/tests -t evaluation/python -v
pnpm --filter @aqarak/evaluation screen -- --help
```

I test the Python line protocol with an injected fake model using the standard library. I keep temporary TypeScript fixtures in the ignored `.validation` directory. I gate the two live smoke tests through `liveModelsEnabled()` so `src/config.ts` remains the sole environment reader. I run live tests only after explicitly setting `LIVE_MODELS=1`; ordinary tests and CI use fake transports and processes.

I follow the [streaming best-practice documentation](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html#best-practices) by sending 100 ms PCM chunks at real-time pace, with `realtimeFactor` set to 1. I retain the registry's language-identification settings and record the one-time fixed-language fallback in effective parameters. I use the [transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) to validate the optional `languages[]` multipart field; the current registry supplies no language hints, so I send none.

## Results

I record the speech screening completed in the [screening decision record](decisions/mc3-speech-to-text.md), with receipts and scores in the [generated report](results/screening-2026-09-28/mc3_speech_to_text/report.md). These are screening results; I record the subsequent held-out evaluation below.

I record document extraction screening in the [extraction screening decision record](decisions/mc1-document-extraction.md), with receipts and scores in the [generated extraction report](results/screening-2026-09-28/mc1_document_extraction/report.md). Four candidates have screening decisions and one pre-registered candidate remains deferred. I record the subsequent held-out evaluation below.

## Held-out results / نتائج الاختبار المحجوبة

I completed [the frozen held-out evaluation](results/held-out-2026-09-28/README.md): `gpt-6-sol` on all 90 documents and `gpt-transcribe` on all 400 speech clips. My primary figures are 93.45% pooled field accuracy [95% CI 90.60%, 95.92%] and 17.30% pooled WER [14.92%, 19.94%]. I report source-specific speech results and product limitations in the [document decision](results/held-out-2026-09-28/mc1_document_extraction/decision.md) and [speech decision](results/held-out-2026-09-28/mc3_speech_to_text/decision.md). I adopt no validated model fallback for either class and leave the registry unchanged.

I collect with `screen -- --split held_out`; `score` selects the frozen split from each run header. I verify both speech sources and keep all speech hypotheses outside the repository. I retain scorer 1.2.0 and the frozen prompts, model schemas and registry settings. I provide exact scoring commands and provenance in the run folder.

أكملت تقييم المستندات التسعين والمقاطع الصوتية الأربعمائة في مجموعة الاختبار المحجوبة. أعرض نتائجها بوصفها النتائج الأساسية، وأحتفظ بنتائج الفحص الأولي للمقارنة فقط. أوثق حدود البيانات والقرارات لكل فئة، ولا أعتمد نموذجاً احتياطياً موثقاً لأي منهما.
