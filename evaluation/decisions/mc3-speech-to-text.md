# mc3_speech_to_text: screening decision record

Date: 2026-09-28
Status: screening complete; held-out run pending

## Purpose

I evaluate transcription for Aqarak voice notes and push-to-talk orders. Every output remains a proposal that a named person confirms before saving or acting. I record screening elimination under [ADR 0005: Model selection method][adr], without claiming held-out performance or deployment.

## Candidates

I retain the identifiers, versions and price basis in the [registry][registry]. G, A, T and L below abbreviate candidate ids, without changing them.

| Key | Candidate id                  | Model identifier; version                                         | Runtime         | Licence     | Price basis, USD       |
| --- | ----------------------------- | ----------------------------------------------------------------- | --------------- | ----------- | ---------------------- |
| G   | gpt-transcribe                | gpt-transcribe; snapshot null                                     | API             | Proprietary | 0.0045/audio minute    |
| A   | amazon-transcribe             | amazon-transcribe-streaming; snapshot null                        | API             | Proprietary | 0.0001667/audio second |
| T   | faster-whisper-large-v3-turbo | large-v3-turbo; revision 0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf | Local CPU, int8 | MIT         | No marginal charge     |
| L   | faster-whisper-large-v3       | large-v3; revision edaa852ec7e145841d8ffdb056a99866b5f0a478       | Local CPU, int8 | MIT         | No marginal charge     |

## Gates

I reviewed sources on the record date. Successful screening calls establish observed access. Before the runs I made preliminary Arabic/English language-identification smokes for A and an Arabic smoke through the local bridge; their receipts are not in the repository. A receipts record no language-identification fallback.

| Candidate | Language                                                          | Licence                                                           | Access                                | Control                                                                                      | Lifecycle                                             |
| --------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| G         | Arabic/CS observed, [receipts G][rg]; multilingual [model][g]     | API only; weight licence not stated by the source [G][g]          | Successful [receipts G][rg]           | Strict outputs unsupported [G][g]; schema validity null [G receipts][rg]                     | Removal date not stated by the source [G][g]          |
| A         | Gulf Arabic/English streaming supported [AWS languages][aws-lang] | API only; weight licence not stated by the source [AWS][aws-lang] | Successful [receipts A][ra]           | Schema validity null [A receipts][ra]; strict tools not stated by the source [AWS][aws-lang] | Removal date not stated by the source [AWS][aws-lang] |
| T         | Arabic/CS observed [receipts T][rt]                               | MIT passes [conversion card][turbo]                               | Successful [receipts T][rt]           | Schema validity null [T receipts][rt]; strict tools not stated by the source [card][turbo]   | Removal date not stated by the source [card][turbo]   |
| L         | Arabic/English listed [conversion card][large]                    | MIT passes [conversion card][large]                               | Unverified here; no screening receipt | Strict tools not stated by the source [card][large]                                          | Removal date not stated by the source [card][large]   |

I do not equate successful transcription with the complete control gate. [Structured model outputs][structured] distinguishes JSON from schema adherence; [File transcription][speech] describes transcription responses. Receipts do not establish server-side field validation or null-with-reason controls. Those remain unresolved before selection.

## Rule, margins and ceilings

Under [ADR 0005][adr], I reject schema validity below 95%, any critical failure, or primary error exceeding the best by three relative margins of 0.1. I use pooled WER after identical Arabic letter, diacritic, tatweel, digit and punctuation normalisation, with CER and language breakdowns. Arabic exclusion rejects; deployable weights require Apache-2.0, MIT or CC-BY; announced removal within 12 months excludes. The method sets a two-percentage-point accuracy margin, a 1% unsupported-fill ceiling and rejection for fabricated money or dates. These field ceilings are not measured by speech WER. I use Wilson 95% intervals for proportions and paired clip bootstrap with 2,000 resamples for WER and differences; failures remain in denominators. An interval crossing the margin is inconclusive. Final selection considers the cheapest eligible candidate within the margin, including hosting at 20-user volume. Screening commands cap spend at USD 1 ([run headers][report]).

## Screening data

I used 50 MIXAT clips: 30 Arabic and 20 code-switched, totalling 637.464 seconds ([split][split], [CSV][csv], [receipts A][ra]). The source `screening_ids.txt` SHA-256 in every run header is `fc352a8a02891e50218d95e0a063ef93d4683beb35f91ccb44198c076a91a04e`; the frozen ID/audio-hash-pair digest is `7362f6cc9cd851b9ede2cc273638b510796b7f9925324573445d271f72b6358d` ([scores][scores]).

I supplied identical prepared audio; matching input hashes support comparability. I converted each clip once to 16 kHz mono PCM WAV and ran T alone on the CPU after discarding an attempt that competed for memory with a local vision model. Provider headers record `1fd26ab`, concurrency 4; T records `e430876` ([receipts G][rg], [A][ra], [T][rt]). I kept the speech code paths unchanged between those recorded commits.

I used streaming because batch requires S3 input and that location did not yet exist in the development account. [AWS languages][aws-lang] documents S3 batch input; [Amazon Transcribe Pricing][aws-price] gives USD 0.01/minute streaming versus 0.006 batch, billed per second without a minimum. Real-time pacing means A latency includes audio duration.

## Results

**Screening split, not a headline result.** I copy [summary.csv][csv] estimates, rounded as the [generated report][report]; brackets are 95% intervals. Schema rate comes from [scores.json][scores], which counts successful calls rather than strict-schema validation.

| Candidate | n   | WER %             | Schema-valid %      | CER %            | Difference to G, percentage points | Cost USD | p50/p95 seconds |
| --------- | --- | ----------------- | ------------------- | ---------------- | ---------------------------------- | -------- | --------------- |
| G         | 50  | 17.8 [14.5, 21.0] | 100.0 [92.9, 100.0] | 6.7 [5.3, 8.4]   | 0.0 [0.0, 0.0]                     | 0.0497   | 1.655/2.707     |
| A         | 50  | 27.0 [22.9, 31.2] | 100.0 [92.9, 100.0] | 12.8 [9.7, 16.4] | 9.1 [5.7, 12.9]                    | 0.1063   | 15.130/19.759   |
| T         | 50  | 23.7 [20.5, 26.7] | 100.0 [92.9, 100.0] | 9.5 [7.9, 11.2]  | 5.9 [3.3, 8.6]                     | 0.0000   | 7.282/11.757    |

Arabic/CS WER is G 15.5%/20.8%, A 23.4%/31.5%, T 20.7%/27.7% ([per-language.csv][languages]).

## Screening decision

I retain G for held-out evaluation: lowest WER, 17.8%, and all 50 calls successful ([receipts G][rg]). I reject A at 27.0% and T at 23.7% under the generated threshold `0.23192955589586525`, calculated from best `0.1784073506891271 × (1 + 3 × 0.1)` ([CSV reasons][csv], [receipts A][ra], [T][rt]).

T exceeds the threshold by only 0.5 percentage points, subtracting that threshold from `0.23736600306278713`. Its paired interval [3.3, 8.6] crosses the 5.4-point gap between threshold and best. This rejection rests on a point estimate over 50 clips and is weak evidence; the interval comparison is inconclusive.

## What happens next

I will evaluate survivors on the frozen held-out manifest, hash `66f3c64427d5165553413db9cca39d319bd92c6033e76c66c89e56c31a4d850f`: 200 other MIXAT clips plus 200 FLEURS test clips, 100 Egyptian Arabic and 100 US English ([split][split]). It was frozen before any held-out output. I leave the registry unchanged. I will change no prompt or schema after the first held-out run. After held-out evaluation and resolving gates, the class decision record would justify primary/fallback changes. A is the current fallback despite screening rejection; I will revisit it then. The degraded path remains typing.

## Limitations

I started L's screening run at 08:25 (Dubai) and stopped it after three clips because, on the shared laptop and CPU only, each clip took several times longer than T, so it could not finish in the window. I used CPU-only execution with no GPU path. I keep its partial receipts outside the repository and do not score them. L remains my next local speech run. My requirement for at least two evaluated open-weight candidates remains unmet.

I use [MIXAT][mixat], Emirati Arabic and English code-switched speech under CC BY-NC-SA 4.0, for evaluation only. No transcript, audio or hypothesis text is in the repository. Plain WER penalises legitimate alternative spellings; the authors propose PolyWER through MIXAT's linked updated-transcription project, with alternatives represented in [mixat-tri][tri]. This screening samples narrated podcast speech, not operational voice notes. Small n, shared speaker material, unpinned provider versions, unequal latency conditions and excluded local hosting costs limit generalisation.

[adr]: ../../docs/adr/0005-model-selection-method.md
[registry]: ../../services/api/src/models/model-registry.json
[split]: ../datasets/speech-splits-v1.json
[report]: ../results/screening-2026-09-28/mc3_speech_to_text/report.md
[csv]: ../results/screening-2026-09-28/mc3_speech_to_text/summary.csv
[scores]: ../results/screening-2026-09-28/mc3_speech_to_text/scores.json
[languages]: ../results/screening-2026-09-28/mc3_speech_to_text/per-language.csv
[rg]: ../results/screening-2026-09-28/mc3_speech_to_text/gpt-transcribe/receipts.jsonl
[ra]: ../results/screening-2026-09-28/mc3_speech_to_text/amazon-transcribe/receipts.jsonl
[rt]: ../results/screening-2026-09-28/mc3_speech_to_text/faster-whisper-large-v3-turbo/receipts.jsonl
[g]: https://developers.openai.com/api/docs/models/gpt-transcribe "OpenAI, GPT-Transcribe Model"
[speech]: https://developers.openai.com/api/docs/guides/speech-to-text "OpenAI, File transcription"
[structured]: https://developers.openai.com/api/docs/guides/structured-outputs "OpenAI, Structured model outputs"
[aws-lang]: https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html "AWS, Supported languages and language-specific features"
[aws-price]: https://aws.amazon.com/transcribe/pricing/ "AWS, Amazon Transcribe Pricing"
[turbo]: https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/blob/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf/README.md "Whisper large-v3 turbo model for CTranslate2"
[large]: https://huggingface.co/Systran/faster-whisper-large-v3/blob/edaa852ec7e145841d8ffdb056a99866b5f0a478/README.md "Whisper large-v3 model for CTranslate2"
[mixat]: https://github.com/mbzuai-nlp/mixat "Mixat: A Data Set of Bilingual Emirati-English Speech"
[tri]: https://huggingface.co/datasets/sqrk/mixat-tri "sqrk/mixat-tri dataset card"
