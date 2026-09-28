# speech screening report: screening-2026-09-28

I report these screening results on the screening split; headline figures come only from the held-out split.

## Run facts

| Candidate                     | Git commit                               | Dataset manifest SHA-256                                         | Split SHA-256                                                    | Registry SHA-256                                                 | Scorer version | Price date | Command                                                                                                                                                                                            | Started at               |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| amazon-transcribe             | 1fd26ab338c403cc7e2fe9ee300ef050ed0690cf | 55fe0d05b4876a6f5e68ca0d8866f335b1a39d20e6073033f45fd57f74f69de6 | fc352a8a02891e50218d95e0a063ef93d4683beb35f91ccb44198c076a91a04e | 0243a954df4bc19dbf96c9817d06e4ca994df743bd3c55caa9ec8d983c0c98e2 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc3\_speech\_to\_text --split screening --candidates gpt-transcribe,amazon-transcribe --run-id screening-2026-09-28 --cap-usd 1 --concurrency 4 | 2026-09-28T03:20:08.341Z |
| faster-whisper-large-v3-turbo | e4308769671500977b7643bf8f8a6357391b8bbc | 55fe0d05b4876a6f5e68ca0d8866f335b1a39d20e6073033f45fd57f74f69de6 | fc352a8a02891e50218d95e0a063ef93d4683beb35f91ccb44198c076a91a04e | 074aa98e6ed3f5014f42ce66104cd7c7b88bfd7a5aaf77bc588583ab2a575200 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc3\_speech\_to\_text --split screening --candidates faster-whisper-large-v3-turbo --run-id screening-2026-09-28 --cap-usd 1                    | 2026-09-28T03:47:18.496Z |
| gpt-transcribe                | 1fd26ab338c403cc7e2fe9ee300ef050ed0690cf | 55fe0d05b4876a6f5e68ca0d8866f335b1a39d20e6073033f45fd57f74f69de6 | fc352a8a02891e50218d95e0a063ef93d4683beb35f91ccb44198c076a91a04e | 0243a954df4bc19dbf96c9817d06e4ca994df743bd3c55caa9ec8d983c0c98e2 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc3\_speech\_to\_text --split screening --candidates gpt-transcribe,amazon-transcribe --run-id screening-2026-09-28 --cap-usd 1 --concurrency 4 | 2026-09-28T03:20:08.331Z |

## Candidate summary

| Candidate                     | Items | Status counts                                                                                                          | Schema-valid rate        | Primary metric                     | Secondaries                                                                     | Total cost (USD) | p50 latency (s) | p95 latency (s) |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------- | ---------------- | --------------- | --------------- |
| amazon-transcribe             | 50    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 50; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0 | 100.0% \[92.9%, 100.0%\] | Pooled WER: 27.0% \[22.9%, 31.2%\] | CER: 12.8% \[9.7%, 16.4%\]; Paired WER difference to best: 9.1% \[5.7%, 12.9%\] | 0.1063           | 15.130          | 19.759          |
| faster-whisper-large-v3-turbo | 50    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 50; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0 | 100.0% \[92.9%, 100.0%\] | Pooled WER: 23.7% \[20.5%, 26.7%\] | CER: 9.5% \[7.9%, 11.2%\]; Paired WER difference to best: 5.9% \[3.3%, 8.6%\]   | 0.0000           | 7.282           | 11.757          |
| gpt-transcribe                | 50    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 50; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0 | 100.0% \[92.9%, 100.0%\] | Pooled WER: 17.8% \[14.5%, 21.0%\] | CER: 6.7% \[5.3%, 8.4%\]; Paired WER difference to best: 0.0% \[0.0%, 0.0%\]    | 0.0497           | 1.655           | 2.707           |

## Screening decisions

| Candidate                     | Decision | Reasons                                                                                                                              |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| amazon-transcribe             | rejected | Primary error rate 0.26952526799387444 exceeds 0.23192955589586525, the best 0.1784073506891271 times one plus three margins of 0.1. |
| faster-whisper-large-v3-turbo | rejected | Primary error rate 0.23736600306278713 exceeds 0.23192955589586525, the best 0.1784073506891271 times one plus three margins of 0.1. |
| gpt-transcribe                | survives | All screening gates passed.                                                                                                          |

## Per-language WER

| Candidate                     | Language | WER                    |
| ----------------------------- | -------- | ---------------------- |
| amazon-transcribe             | Arabic   | 23.4% \[18.9%, 27.8%\] |
| amazon-transcribe             | CS       | 31.5% \[24.4%, 39.5%\] |
| faster-whisper-large-v3-turbo | Arabic   | 20.7% \[16.4%, 25.0%\] |
| faster-whisper-large-v3-turbo | CS       | 27.7% \[23.6%, 31.3%\] |
| gpt-transcribe                | Arabic   | 15.5% \[11.6%, 19.3%\] |
| gpt-transcribe                | CS       | 20.8% \[15.3%, 25.8%\] |

## Limitations

- I evaluate the screening split only.
- I report small n, with uncertainty intervals that may be wide.
- I run local candidates on a laptop CPU or GPU.
- I use linear interpolation for latency and real-time-factor quantiles over successful receipts. I show unavailable latency as empty CSV cells and as zero in the report table.
- I use the last receipt per item as its final status and include every attempt in total cost. I count every missing receipt as not\_run in the full split denominator.
