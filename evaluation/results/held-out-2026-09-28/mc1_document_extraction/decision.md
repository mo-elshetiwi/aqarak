# MC1 document extraction: held-out decision record

Date: 2026-09-28
Status: held-out evaluation complete; product primary selected; no validated model fallback

I adopt `gpt-6-sol` as my product primary for reviewable document extraction. My primary held-out result is **93.45% [90.60%, 95.92%] pooled field accuracy**, based on **771 correct fields out of 825 readable fields across all 90 frozen documents**. Every document returned a schema-valid response, and I recorded no fabricated money values, dates or identity numbers. I require a named person to confirm proposed fields before saving them, as specified in [ADR 0005](../../../../docs/adr/0005-model-selection-method.md).

I adopt **no model fallback**. The rejected and deferred candidates do not provide a validated fallback, so I retain `manual_form` as the degraded path. I record this selection for subsequent product integration; I leave the runtime registry unchanged in this branch. I do not regard this synthetic evaluation as completed real-document validation or closure of every control and lifecycle gate.

## Held-out evidence

I report 95% intervals from committed scorer **1.2.0**, with 2,000 bootstrap resamples and seed 20260928. I resample whole documents for pooled field accuracy and preserve the committed Wilson intervals for proportion metrics. I retain all 90 documents in every applicable denominator. I cite [summary.csv](summary.csv), [scores.json](scores.json), [the generated report](report.md) and [the receipts](gpt-6-sol/receipts.jsonl).

| Measure | Numerator / denominator | Held-out estimate [95% interval] |
| --- | --- | --- |
| Pooled field accuracy | 771/825 readable fields | 93.45% [90.60%, 95.92%] |
| Schema-valid documents | 90/90 documents | 100.00% [95.91%, 100.00%] |
| Exact documents | 65/90 documents | 72.22% [62.20%, 80.42%] |
| Missing readable fields | 23/825 fields | 2.79% [1.17%, 4.79%] |
| Incorrect readable fields | 31/825 fields | 3.76% [2.17%, 5.49%] |
| Unsupported fills | 0/220 absent or occluded fields | 0.00% [0.00%, 1.72%] |
| Distractor captures | 1/95 decoy fields | 1.05% [0.19%, 5.72%] |
| Arabic-script field accuracy | Arabic-script readable fields | 96.58% [93.48%, 99.29%] |

I recorded **zero critical failures and zero listed fabrications** in [fabrications.csv](fabrications.csv). I recorded one non-critical distractor capture, the `sex` field of `emirates_id-034`, in [document-outcomes.csv](document-outcomes.csv). I treat the 0/220 unsupported-fill result as an observed rate of zero; its Wilson upper bound of 1.72% exceeds my 1% ceiling, so this sample does not statistically establish that ceiling. Multiple unavailable fields can occur within one document, which also limits the independence assumption of that field-based interval.

I retain the per-kind breakdown from [per-kind.csv](per-kind.csv):

| Kind | Documents | Readable fields | Held-out accuracy [95% interval] |
| --- | --- | --- | --- |
| emirates_id | 30 | 217 | 92.63% [86.47%, 97.55%] |
| tawtheeq_contract | 30 | 361 | 96.12% [92.93%, 98.88%] |
| title_deed | 30 | 247 | 90.28% [83.66%, 95.92%] |

I spent **USD 0.975570**, equivalent to **USD 10.8397 per 1,000 documents** at the recorded usage and price basis. My successful-call latency was p50 **6.9385 s** and p95 **11.9069 s**. I used four API workers, made 90 calls, and recorded no retry, refusal, timeout, provider error, unrun item or budget stop. My predeclared class cap was USD 3. These receipt-derived costs exclude human review and downstream product infrastructure; I have no measured per-user document volume from which to claim a 20-user monthly bill.

## Comparison with screening and rejected alternatives

I use the [screening decision](../../../decisions/mc1-document-extraction.md) and [screening scores](../../screening-2026-09-28/mc1_document_extraction/scores.json) only as comparison evidence. The screening primary for the same candidate was **95.24% [91.64%, 98.12%]** over 30 documents and 273 readable fields. My held-out point estimate is **-1.78 percentage points** lower. The sets contain different documents, so I make no paired between-split comparison or established non-inferiority claim from that change. The two-point accuracy margin remains unchanged.

| Candidate | Screening disposition I retain | Evidence |
| --- | --- | --- |
| `gpt-6-luna` | I reject the former primary for two fabricated dates. | [Fabrications](../../screening-2026-09-28/mc1_document_extraction/fabrications.csv), [receipts](../../screening-2026-09-28/mc1_document_extraction/gpt-6-luna/receipts.jsonl) |
| `gemma4-12b` | I retain rejection for 90% schema validity, 74.73% field accuracy and 15 critical failures. | [Scores](../../screening-2026-09-28/mc1_document_extraction/scores.json), [receipts](../../screening-2026-09-28/mc1_document_extraction/gemma4-12b/receipts.jsonl) |
| `qwen2-5vl-7b` | I retain rejection after 17/30 documents; even perfect remaining calls could not meet 95% schema validity. | [Decision](../../../decisions/mc1-document-extraction.md), [receipts](../../screening-2026-09-28/mc1_document_extraction/qwen2-5vl-7b/receipts.jsonl) |
| `qwen3-vl-8b` | I retain deferred status after one schema-invalid call; I have no completed validation for this candidate. | [Decision](../../../decisions/mc1-document-extraction.md), [receipt](../../screening-2026-09-28/mc1_document_extraction/qwen3-vl-8b/receipts.jsonl) |

I ran only the survivor on held-out data. Its reported paired difference to itself is zero with interval [0, 0], which establishes no comparison with another model. I select the sole remaining evaluated candidate; I do not claim a new cheapest-within-margin comparison against candidates that did not survive.

## Frozen provenance and gates

I verified the committed held-out split hash **`7b56033c93ae80e36da97d5e827661f195326ee6b496e5981fc669388696bf99`** before collection. I retain the matching hash in every run header and in [preflight.json](../preflight.json) and [run-metadata.json](../run-metadata.json). I cite collection commit `b2755c5d19342c3e5d7feb312a99675206ae2b8b` and registry hash `074aa98e6ed3f5014f42ce66104cd7c7b88bfd7a5aaf77bc588583ab2a575200`. I changed no prompt, model schema or registry setting after the first held-out call. My per-kind prompt hashes, schema hashes and effective parameters match those used for this candidate in screening; the API model echo is `gpt-6-sol`, with no pinned snapshot.

I retain the language, licence, access, control and lifecycle evidence boundaries in my earlier gate record. These calls establish current access and observed bilingual extraction with server-side schema validation; they do not by themselves establish every field-level null-with-reason control, a pinned model version or a documented lifecycle guarantee. I leave those unresolved items explicit rather than marking all product gates complete.

## Limitations and product consequence

I evaluated seeded synthetic identity cards, tenancy registration certificates and title deeds, with 30 examples of each kind. I cannot generalise their controlled layouts, planted occlusions or decoys to genuine documents and phone captures. My exact-document rate and title-deed breakdown justify mandatory review even when a response is schema-valid. I preserve the frozen benchmark and require separate real-document and operational evidence before claiming production validation.

أعتمد `gpt-6-sol` مرشحاً أساسياً لاستخراج حقول المستندات مع مراجعة بشرية إلزامية. بلغت دقة الحقول في مجموعة الاختبار المحجوبة **93.45%** بفاصل ثقة 95% من **90.60% إلى 95.92%**. لم أسجل اختلاقاً للقيم المالية أو التواريخ، لكن البيانات اصطناعية ولم تثبت هذه العينة سقف التعبئة غير المدعومة البالغ 1% إحصائياً. لا أعتمد نموذجاً احتياطياً موثقاً، وأحتفظ بالإدخال اليدوي مساراً بديلاً.
