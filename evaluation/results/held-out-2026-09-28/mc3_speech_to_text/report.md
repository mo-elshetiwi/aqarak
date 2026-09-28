# speech held-out report: held-out-2026-09-28

I report the frozen held-out results as my primary figures. I record product selection and screening comparisons in [my class decision record](decision.md).

## Run facts

| Candidate      | Git commit                               | Dataset manifest SHA-256                                         | Split SHA-256                                                    | Registry SHA-256                                                 | Scorer version | Price date | Command                                                                                                                                                                         | Started at               |
| -------------- | ---------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| gpt-transcribe | b2755c5d19342c3e5d7feb312a99675206ae2b8b | 7941a30b61d567d90ea84eb4624ba00a5e74d7183a391a9c79518278b832fbaf | 66f3c64427d5165553413db9cca39d319bd92c6033e76c66c89e56c31a4d850f | 074aa98e6ed3f5014f42ce66104cd7c7b88bfd7a5aaf77bc588583ab2a575200 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc3\_speech\_to\_text --split held\_out --candidates gpt-transcribe --run-id held-out-2026-09-28 --cap-usd 1 --concurrency 4 | 2026-09-28T05:31:06.971Z |

## Candidate summary

| Candidate      | Items | Status counts                                                                                                           | Schema-valid rate        | Primary metric                     | Secondaries                                                                   | Total cost (USD) | p50 latency (s) | p95 latency (s) |
| -------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | ----------------------------------------------------------------------------- | ---------------- | --------------- | --------------- |
| gpt-transcribe | 400   | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 400; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0 | 100.0% \[99.0%, 100.0%\] | Pooled WER: 17.3% \[14.9%, 19.9%\] | CER: 9.8% \[7.8%, 12.0%\]; Paired WER difference to best: 0.0% \[0.0%, 0.0%\] | 0.3403           | 1.532           | 3.321           |

## Existing rejection-rule checks

| Candidate      | Decision | Reasons                     |
| -------------- | -------- | --------------------------- |
| gpt-transcribe | survives | All screening gates passed. |

## Per-language WER

| Candidate      | Language | WER                    |
| -------------- | -------- | ---------------------- |
| gpt-transcribe | Arabic   | 31.5% \[23.4%, 41.6%\] |
| gpt-transcribe | CS       | 26.4% \[23.0%, 30.0%\] |
| gpt-transcribe | English  | 66.7% \[0.0%, 100.0%\] |
| gpt-transcribe | ar\_eg   | 6.2% \[3.4%, 10.1%\]   |
| gpt-transcribe | en\_us   | 4.3% \[3.2%, 5.5%\]    |

## Limitations

- I use all 400 frozen held-out clips: 200 MIXAT clips, 100 FLEURS Egyptian Arabic clips and 100 FLEURS US English clips. I report the pooled held-out WER as primary and preserve the separate language groups.
- I preserve scorer 1.2.0, with 2,000 bootstrap resamples, seed 20260928 and 95% intervals. I resample clips for WER and CER; the reported schema-valid proportion measures successful calls, not strict transcription-schema validation.
- I evaluate one screening survivor. Its paired difference to itself is identically zero and supplies no evidence of superiority or non-inferiority to another candidate.
- I compare screening and held-out estimates descriptively in my class decision record. Screening contains only MIXAT, whereas the held-out primary includes FLEURS; composition and disjoint items prevent a paired between-split comparison.
- I use the MIXAT transcript field and the FLEURS transcription field, applying the same committed normaliser to references and hypotheses. I keep all speech references, audio and raw hypotheses outside the repository.
- I sample podcast and read speech rather than operational property-management voice notes. Shared speakers and source programmes limit the independence assumed by clip-level intervals.
- I retain ordinary WER, which penalises legitimate spelling alternatives; I do not substitute another metric after seeing held-out output. Egyptian Arabic is a regression guard, not a Gulf dialect sample.
- I keep the API version unpinned as registered. Successful transcription does not establish grounded action extraction, safe execution, or the complete control gate.
- I adopt no rejected screening candidate as a validated fallback. Typing remains my degraded path; the registry and deployment are unchanged.
- I interpret the generated survives status and screening-gates wording only as the committed rejection-rule check; it does not establish every ADR gate or product readiness.
- I use linear interpolation for latency and real-time-factor quantiles over successful receipts. I show unavailable latency as empty CSV cells and as zero in the report table.
- I use the last receipt per item as its final status and include every attempt in total cost. I count every missing receipt as not\_run in the full split denominator.
