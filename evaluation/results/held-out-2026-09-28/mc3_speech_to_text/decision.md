# MC3 speech to text: held-out decision record

Date: 2026-09-28
Status: held-out evaluation complete; product primary selected; no validated model fallback

I adopt `gpt-transcribe` as my product primary for editable speech-transcription proposals. My primary held-out result is **17.30% [14.92%, 19.94%] pooled WER**, based on **1,477 word edits over 8,536 reference words across all 400 frozen clips**. I report this full-split figure with the source breakdown: the 200 held-out MIXAT clips have **28.43% [24.51%, 32.93%] WER**, while the 200 FLEURS clips have **5.17% [3.70%, 7.08%] WER**. I require user confirmation of the transcript before it can contribute to any saved record or drafted action, under [ADR 0005](../../../../docs/adr/0005-model-selection-method.md).

I adopt **no validated model fallback**. I retain typing as the degraded path because the alternative fallback was rejected at screening and the unfinished local candidate has no completed evaluation. I leave the runtime registry unchanged in this branch; this record supplies the product selection decision and its conditions for subsequent integration. I do not infer safe action execution or complete control-gate validation from transcription accuracy.

## Held-out evidence

I score the frozen split with committed scorer **1.2.0**, 2,000 bootstrap resamples, seed 20260928 and 95% intervals. I preserve the committed normaliser for both references and hypotheses. I cite [summary.csv](summary.csv), [scores.json](scores.json), [the generated report](report.md) and [the receipts](gpt-transcribe/receipts.jsonl). I derive the supplementary source groups from the text-free clip counts using the same committed bootstrap function in [source-summary.csv](source-summary.csv) and [source-summary.json](source-summary.json).

| Measure | Held-out result |
| --- | --- |
| Pooled WER, primary | 17.30% [14.92%, 19.94%] |
| Pooled CER | 9.81% [7.84%, 12.02%] |
| Successful calls | 400/400, 100.00% [99.05%, 100.00%] |
| Failures, missing clips, retries and budget stops | 0 |
| Source duration | 4339.3600625 seconds, 72.3227 minutes |
| Recorded cost | USD 0.340275 |
| Cost per 1,000 source-audio minutes | USD 4.7050 |
| Successful-call latency p50 / p95 | 1.532 s / 3.3212 s |
| Real-time factor p50 | 0.1520 |

I distinguish the report's schema-valid-rate label from actual strict-schema validation: for this class it is the successful-call proportion, with a Wilson interval. I made 400 calls with four API workers and no retries. My cap was USD 1. I retain the 4,537 reported usage seconds separately from the smaller source-duration denominator; I calculate recorded cost from reported usage and the registry price, and normalised cost from source duration. I have not reconciled these estimates with an invoice or measured a 20-user monthly audio volume.

I preserve the frozen language labels and their separate denominators in [per-language.csv](per-language.csv) and [clip-scores.csv](clip-scores.csv):

| Group | Clips | Held-out WER [95% interval] |
| --- | --- | --- |
| MIXAT Arabic | 99 | 31.51% [23.39%, 41.63%] |
| MIXAT code-switched | 99 | 26.37% [22.99%, 29.96%] |
| MIXAT English | 2 | 66.67% [0.00%, 100.00%] |
| FLEURS Egyptian Arabic | 100 | 6.18% [3.45%, 10.14%] |
| FLEURS US English | 100 | 4.29% [3.23%, 5.49%] |

I treat **31.51% WER on MIXAT Arabic** and **26.37% on code-switched clips** as material product limitations. The stronger FLEURS results reduce the mixed primary estimate; they do not establish accurate operational Gulf Arabic voice notes. The two MIXAT English clips supply too little evidence for an English subgroup conclusion. I do not interpret FLEURS Egyptian Arabic as Gulf-dialect validation.

## Comparison with screening and rejected alternatives

I use the [screening decision](../../../decisions/mc3-speech-to-text.md) and [screening scores](../../screening-2026-09-28/mc3_speech_to_text/scores.json) only for comparison. The same candidate's screening WER was **17.84% [14.49%, 21.02%]** on 50 MIXAT clips. The full held-out point estimate is **-0.54 percentage points** lower, but this comparison mixes different source compositions. On the 200 held-out MIXAT clips alone, WER is **28.43% [24.51%, 32.93%]**, **10.59 points** higher than screening. I regard the latter as evidence of weaker transfer to the remaining selected MIXAT material, subject to differing clips and source programmes.

| Candidate | Screening comparison and disposition I retain | Evidence |
| --- | --- | --- |
| `amazon-transcribe` | I retain rejection at 26.95% WER against the 23.19% three-margin threshold. | [Scores](../../screening-2026-09-28/mc3_speech_to_text/scores.json), [receipts](../../screening-2026-09-28/mc3_speech_to_text/amazon-transcribe/receipts.jsonl) |
| `faster-whisper-large-v3-turbo` | I retain the point-estimate rejection at 23.74% WER. Its paired interval crossed the rejection margin, so the earlier comparison remains statistically inconclusive. | [Decision](../../../decisions/mc3-speech-to-text.md), [receipts](../../screening-2026-09-28/mc3_speech_to_text/faster-whisper-large-v3-turbo/receipts.jsonl) |
| `faster-whisper-large-v3` | I retain incomplete status; I have no completed, scored evaluation supporting fallback adoption. | [Decision](../../../decisions/mc3-speech-to-text.md) |

I preserve the 10% relative error-rate margin. I have only one held-out candidate, so the generated paired difference is its zero self-comparison, not evidence of superiority or non-inferiority. The screening and held-out clips are disjoint; I make no paired between-split comparison. I select the sole survivor while retaining the substantive MIXAT limitations, rather than asserting a new comparative cost or quality result.

## Frozen provenance, licence and gates

I verified the committed held-out id/audio-hash-pair digest **`66f3c64427d5165553413db9cca39d319bd92c6033e76c66c89e56c31a4d850f`** before any call. I retain it in the run header, [preflight.json](../preflight.json) and [run-metadata.json](../run-metadata.json). The speech header's dataset manifest hash is **`7941a30b61d567d90ea84eb4624ba00a5e74d7183a391a9c79518278b832fbaf`**, the hash of the committed combined manifest that contains both source-manifest hashes. I verified both manifests, all source labels and audio hashes, and disjoint membership before collection. I cite collection commit `b2755c5d19342c3e5d7feb312a99675206ae2b8b`; effective candidate parameters match screening, and I changed no registry setting, prompt or model schema after the first call.

I retain all raw hypotheses under `$AQARAK_DATA_DIR/runs/held-out-2026-09-28/mc3_speech_to_text/gpt-transcribe/raw/`. I commit only receipts, hashes and text-free scores for speech. I use MIXAT for non-commercial evaluation under its recorded licence; I leave audio, references and hypotheses outside the repository. I use the `transcript` field for MIXAT and `transcription` for FLEURS, whose 16 kHz sample counts supply durations.

I retain the earlier gate evidence boundaries: successful calls demonstrate observed access and language coverage, while the registered API snapshot remains null and no model echo was returned. I have not established strict transcription-schema control, downstream field validation or a lifecycle guarantee. I require those product controls to be assessed separately; the generated rejection-rule status does not close them.

## Limitations and product consequence

I evaluated podcast and read speech with shared speakers and programmes, which limit independence and resemblance to operational voice notes. My clip bootstrap does not become a speaker-level interval. Ordinary WER penalises alternative spellings, and I preserve that metric after seeing results. I tested no local model in this run. I have no validated fallback, no held-out comparison with a competing candidate, and no evidence here of deployed voice-command safety. I require editable transcripts, confirmation and an accessible typing path in the product.

أعتمد `gpt-transcribe` مرشحاً أساسياً لإنتاج نص قابل للتعديل والتأكيد. بلغ معدل خطأ الكلمات في مجموعة الاختبار المحجوبة كاملة **17.30%** بفاصل ثقة 95% من **14.92% إلى 19.94%**. بلغ المعدل في مقاطع MIXAT المحجوبة وحدها **28.43%**، لذلك لا أعتبر المتوسط المختلط دليلاً كافياً على دقة الملاحظات التشغيلية باللهجة الخليجية. لا أعتمد نموذجاً احتياطياً موثقاً، وأحتفظ بالكتابة مساراً بديلاً، وأبقي جميع النصوص الصوتية الخام خارج المستودع.
