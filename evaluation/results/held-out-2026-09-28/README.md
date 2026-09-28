# Held-out evaluation, 28 September 2026

I completed both frozen held-out runs and scored every item with committed scorer **1.2.0**, using 2,000 resamples, seed 20260928 and 95% intervals. I present held-out estimates as my primary results; the class decisions contain the separately labelled screening comparisons.

| Class | Candidate | Held-out items | Primary estimate [95% interval] | Recorded cost |
| --- | --- | --- | --- | --- |
| Document extraction | `gpt-6-sol` | 90/90 | Field accuracy 93.45% [90.60%, 95.92%] | USD 0.975570 |
| Speech to text | `gpt-transcribe` | 400/400 | WER 17.30% [14.92%, 19.94%] | USD 0.340275 |

I recorded no failed call, retry, missing item or budget stop. My total recorded spend was **USD 1.315845** against separate USD 3 and USD 1 caps. I adopt the two survivors as product primaries for proposals that a person reviews and confirms; I adopt **no validated model fallback** for either class. I leave the registry unchanged.

I retain the [document decision](mc1_document_extraction/decision.md), [document report](mc1_document_extraction/report.md), [speech decision](mc3_speech_to_text/decision.md) and [speech report](mc3_speech_to_text/report.md). I emphasise two limits: zero unsupported document fills does not statistically establish the 1% ceiling, and held-out MIXAT-only WER is **28.43% [24.51%, 32.93%]**, higher than the mixed primary because the FLEURS regression clips are substantially easier for this candidate. These results do not establish real-document or operational voice-note readiness.

## Provenance and receipts

I verified the committed ordered split hashes before collection and recorded them in [preflight.json](preflight.json), the receipt headers and [run-metadata.json](run-metadata.json). I ran the collection code committed at `b2755c5d19342c3e5d7feb312a99675206ae2b8b`. I repaired screening-only split plumbing before collection, without changing prompts, model schemas, registry settings or scoring calculations. The screening results and ADR remain untouched.

I retain [document receipts](mc1_document_extraction/gpt-6-sol/receipts.jsonl), [speech receipts](mc3_speech_to_text/gpt-transcribe/receipts.jsonl), [document collection output](mc1-collection.txt) and [speech collection output](mc3-collection.txt). I keep synthetic document responses under the document candidate's `raw/` directory. I keep speech audio, references and hypotheses outside the repository; speech raw responses remain under `$AQARAK_DATA_DIR/runs/held-out-2026-09-28/mc3_speech_to_text/gpt-transcribe/raw/`.

## Reproduce scoring

I run these commands from the repository root with `AQARAK_DATA_DIR` pointing to the original private data directory. I use the default private run directory, `$AQARAK_DATA_DIR/runs`. Scoring contacts no model service and needs no provider key.

```sh
pnpm --filter @aqarak/evaluation score -- --run-id held-out-2026-09-28 --class mc1_document_extraction --candidates gpt-6-sol --limitations results/held-out-2026-09-28/mc1_document_extraction/limitations.txt
pnpm --filter @aqarak/evaluation score -- --run-id held-out-2026-09-28 --class mc3_speech_to_text --candidates gpt-transcribe --limitations results/held-out-2026-09-28/mc3_speech_to_text/limitations.txt
```

I preserve the entire selected split denominator and the receipt order. I keep generated CSV, JSON and Markdown bytes as written by the scorer. I document validation, supplementary source-group scoring and the inherited binary-prefix scan matches in [verification.md](verification.md).

أعرض هنا نتائج الاختبار المحجوبة كاملة مع فواصل الثقة والإيصالات وتكلفة التشغيل. أحتفظ بالنصوص الصوتية الخام خارج المستودع، وأوثق القرارات وحدود الأدلة دون تغيير سجل النماذج أو نتائج الفحص الأولي.
