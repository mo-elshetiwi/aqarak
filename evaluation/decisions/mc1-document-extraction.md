# mc1_document_extraction: screening decision record

Date: 2026-09-28
Status: screening complete for four candidates, one pre-registered candidate incomplete; held-out run pending

## Purpose

I evaluate extraction of identity, tenancy registration and title documents into reviewable fields for Aqarak. Every output remains a proposal that a named person confirms before saving. I record screening decisions under [ADR 0005: Model selection method][adr].

## Candidates

I copy identifiers, versions and price bases from the [registry][registry]. Keys abbreviate candidate ids. Local prices exclude hosting.

| Key | Candidate id | Model identifier; version                                                             | Runtime | Licence     | Price basis, USD                        |
| --- | ------------ | ------------------------------------------------------------------------------------- | ------- | ----------- | --------------------------------------- |
| L   | gpt-6-luna   | gpt-6-luna; snapshot null                                                             | api     | proprietary | 0.1/0.5 per million input/output tokens |
| S   | gpt-6-sol    | gpt-6-sol; snapshot null                                                              | api     | proprietary | 2/10 per million input/output tokens    |
| G   | gemma4-12b   | gemma4:12b; sha256:4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c   | local   | Apache-2.0  | No marginal charge                      |
| Q2  | qwen2-5vl-7b | qwen2.5vl:7b; sha256:5ced39dfa4bac325dc183dd1e4febaa1c46b3ea28bce48896c8e69c1e79611cc | local   | Apache-2.0  | No marginal charge                      |
| Q3  | qwen3-vl-8b  | qwen3-vl:8b; sha256:901cae73216286ea8c5aba8b46d307ff7188f737285ec500c795a12f05225d28  | local   | Apache-2.0  | No marginal charge                      |

I checked local tags against [Ollama qwen3-vl:8b][oq3], [gemma4:12b][og] and [qwen2.5vl:7b][oq2].

## Gates

I reviewed sources on the record date. NS means **not stated by the source**; lifecycle cells concern removal dates. Screening receipts establish observed access, not the timing of preliminary smokes.

| Candidate | Language                                | Licence                        | Access                                   | Control                              | Lifecycle      |
| --------- | --------------------------------------- | ------------------------------ | ---------------------------------------- | ------------------------------------ | -------------- |
| L         | Arabic exclusion NS [L][ml]             | API; weight licence NS [L][ml] | Successful [receipts][rl]                | Structured outputs supported [L][ml] | NS [L][ml]     |
| S         | Arabic exclusion NS [S][ms]             | API; weight licence NS [S][ms] | Successful [receipts][rs]                | Structured outputs supported [S][ms] | NS [S][ms]     |
| G         | Multilingual; Arabic NS [card][mg]      | Apache-2.0 passes [card][mg]   | Successful [receipts][rg]                | Strict guarantee NS [card][mg]       | NS [card][mg]  |
| Q2        | English tag only [card][mq2]            | Apache-2.0 passes [card][mq2]  | Successful [receipts][rq2]               | Strict guarantee NS [card][mq2]      | NS [card][mq2] |
| Q3        | Multilingual OCR; Arabic NS [card][mq3] | Apache-2.0 passes [card][mq3]  | Responded, schema-invalid [receipt][rq3] | Strict guarantee NS [card][mq3]      | NS [card][mq3] |

I distinguish schema adherence from JSON validity using [Structured model outputs][structured]. Receipts record validation outcomes; they do not establish every server-side or null-with-reason control. I leave undocumented gate evidence unresolved. I treated Q2's English tag as incomplete documentation, not an explicit Arabic exclusion, and screened this optional candidate to evaluate two open-weight candidates.

## Rule, margins and ceilings

I follow [ADR 0005][adr]: reject schema validity below 95%, any critical failure, or primary accuracy more than three two-percentage-point margins below the best. The error-rate margin is 10% relative. Unsupported fill must not exceed 1%. Rule 6 rejects fabricated money or dates; identity-number fabrications are listed. I reject documented Arabic exclusions and removal within 12 months; deployable weights require Apache-2.0, MIT or CC-BY. Access requires a preliminary smoke. Control requires strict schema/tools, server-side validation and null with a reason.

I use Wilson 95% intervals for proportions, document-cluster bootstrap for pooled accuracy, and paired bootstrap with 2,000 resamples for differences. Failures remain in denominators. Comparisons crossing the margin are inconclusive. Final selection chooses the cheapest eligible candidate within the margin at 20-user volume, including hosting; a non-inferior open model requiring another endpoint remains undeployed.

I corrected the scorer in `787dce3` to rule 6 before recording: identity-number decoys had incorrectly counted as critical. I then added the paired accuracy difference to the best candidate (`a02c7be`, scorer 1.2.0); neither change altered a screening decision ([scores][scores]).

## Screening data

I used 30 documents, ordered as 10 identity cards, 10 tenancy registration certificates and 10 title deeds. The [split][split] records `screening_sha256` as `88936a03b28fb0bf27b0e4a489cd1e6ae18f1c4af89ed6c8f35ebeb500d429b2`. I planted absent, occluded and decoy fields in bilingual synthetic layouts ([datasheet][data]). These controlled conditions do not establish real-document performance.

I ran L/S at `b4e9089`, concurrency 4; G at `1fd26ab`, thinking off; Q2 at `1700e9d`; Q3 at `722bd61`, thinking on ([L][rl], [S][rs], [G][rg], [Q2][rq2], [Q3][rq3]). Per-kind prompt/schema hashes and header split/manifest hashes agree across runs. I ran local documents sequentially on the laptop GPU, with one local model loaded.

## Results

**Screening split, not a headline result.** I copy [summary.csv][csv] and [scores.json][scores], rounded as the [generated report][report]. Rates are percentages; brackets are 95% intervals. Accuracy divides correct by readable fields; missing rate divides null/failed by readable fields. Each row retains n=30 documents and 273 readable fields.

| Candidate; coverage | Pooled field accuracy | Difference to S, points | Schema-valid        | Missing | Unsupported fill  | Distractor | Exact document | Arabic | Fabrications/critical | Cost USD | p50/p95 seconds |
| ------------------- | --------------------- | ----------------------- | ------------------- | ------- | ----------------- | ---------- | -------------- | ------ | --------------------- | -------- | --------------- |
| L; 30 of 30 run     | 94.1 [90.5, 97.3]     | -1.1 [-4.6, 1.9]        | 100.0 [88.6, 100.0] | 2.9     | 0.0 [0.0, 5.2]    | 13.5       | 56.7           | 94.8   | 5/2                   | 0.0188   | 4.550/8.803     |
| S; 30 of 30 run     | 95.2 [91.6, 98.1]     | 0.0 [0.0, 0.0]          | 100.0 [88.6, 100.0] | 1.8     | 0.0 [0.0, 5.2]    | 0.0        | 73.3           | 94.8   | 0/0                   | 0.3207   | 6.207/11.594    |
| G; 30 of 30 run     | 74.7 [62.6, 85.1]     | -20.5 [-31.9, -11.2]    | 90.0 [74.4, 96.5]   | 10.6    | 61.4 [49.7, 72.0] | 62.2       | 0.0            | 74.1   | 30/15                 | 0.0000   | 44.620/67.924   |
| Q2; 17 of 30 run    | 19.4 [5.5, 34.5]      | -75.8 [-89.7, -61.2]    | 20.0 [9.5, 37.3]    | 78.0    | 15.7 [9.0, 26.0]  | 21.6       | 0.0            | 15.5   | 8/4                   | 0.0000   | 58.773/84.591   |
| Q3; 1 of 30 run     | 0.0 [0.0, 0.0]        | -95.2 [-98.1, -91.6]    | 0.0 [0.0, 11.4]     | 100.0   | 0.0 [0.0, 5.2]    | 0.0        | 0.0            | 0.0    | 0/0                   | 0.0000   | null/null       |

I retain Q3's null latency from JSON; the report renders zero although no successful call exists. Latency quantiles use successful calls only. Unsupported fill covers absent/occluded fields, while decoy captures are separate.

I copy per-kind accuracy from [per-kind.csv][kind]; cells show **accuracy%; documents/not_run**.

| Candidate | Identity   | Tenancy    | Title      |
| --------- | ---------- | ---------- | ---------- |
| L         | 97.1; 10/0 | 94.5; 10/0 | 90.9; 10/0 |
| S         | 95.7; 10/0 | 96.1; 10/0 | 93.5; 10/0 |
| G         | 79.7; 10/0 | 66.9; 10/0 | 83.1; 10/0 |
| Q2        | 26.1; 10/0 | 27.6; 10/3 | 0.0; 10/10 |
| Q3        | 0.0; 10/9  | 0.0; 10/10 | 0.0; 10/10 |

## Screening decision

I reject L, the current primary, for two fabricated dates: registration_date on tawtheeq_contract-010 and issue_date on title_deed-005 ([fabrications][fab], [receipts][rl]). Its 94.1% accuracy remains within three margins of S's 95.2%. I record its paired difference to S as -1.1 [-4.6, 1.9] percentage points; negative values mean below S. The whole interval lies inside the three-margin screening band of six percentage points, calculated as three times the two-percentage-point margin. The interval crosses the two-point margin below S, so I regard non-inferiority to S at that margin as inconclusive on this sample.

I retain S, the current fallback: 100% schema validity, 95.2% accuracy and no critical failures ([receipts][rs]). Its unsupported-fill interval reaches 5.2%, exceeding the 1% ceiling; this small screening sample cannot establish that ceiling statistically. I identify S as the best candidate on this split and the reference for the paired differences; screening alone establishes no non-inferiority claim.

I reject G: 90% schema validity, 74.7% accuracy and 15 critical failures ([receipts][rg]). Its primary also fails screening. Literal “redacted” values in unavailable fields count as unsupported fills, and as critical in money/date fields ([fabrications][fab]).

I reject Q2 on schema validity alone. After 17 documents, 11 were invalid and six valid; even all 13 remaining successes give at most 19/30, below 95% ([receipts][rq2]). Its scored primary and critical failures also fail screening. I stopped it to free the local slot. Unrun tenancy certificates 037, 038, 039 and every title deed remain denominator failures; its title row contains no model output.

I defer pre-registered Q3. After a discarded empty-content attempt and a probe, I enabled thinking in `7844134` before scored collection. Its only receipt is schema_invalid, with one retry, 8,192 output tokens against a 4,096-token budget per attempt, 533.659 seconds and empty [raw text][rawq3] ([receipt][rq3]). I stopped for insufficient time. I do not adopt the generated rejection caused by 29 not_run documents as a completed screening decision.

## What happens next

I will run survivors on the 90 held-out documents, frozen before any output: `held_out_sha256` is `7b56033c93ae80e36da97d5e827661f195326ee6b496e5981fc669388696bf99` ([split][split]). They remain unrun. Q3 needs a parameter decision recorded before rerunning, potentially a larger output budget, and several hours of local time. I will freeze prompts/schema after the first held-out run. The class decision after held-out evaluation and gate resolution sets primary/fallback. This record leaves the registry unchanged.

## Limitations

I cannot generalise synthetic look-alike documents to real capture conditions. My local runs shared one laptop with other work. Small samples, kind-ordered truncation, unpinned API snapshots, uncertain gates and omitted local hosting costs limit comparisons.

[adr]: ../../docs/adr/0005-model-selection-method.md
[registry]: ../../services/api/src/models/model-registry.json
[split]: ../datasets/synthetic-docs-v1/splits.json
[data]: ../datasets/synthetic-docs-v1/DATASHEET.md
[csv]: ../results/screening-2026-09-28/mc1_document_extraction/summary.csv
[scores]: ../results/screening-2026-09-28/mc1_document_extraction/scores.json
[report]: ../results/screening-2026-09-28/mc1_document_extraction/report.md
[kind]: ../results/screening-2026-09-28/mc1_document_extraction/per-kind.csv
[fab]: ../results/screening-2026-09-28/mc1_document_extraction/fabrications.csv
[rawq3]: ../results/screening-2026-09-28/mc1_document_extraction/qwen3-vl-8b/raw/emirates_id-005.json
[rl]: ../results/screening-2026-09-28/mc1_document_extraction/gpt-6-luna/receipts.jsonl
[rs]: ../results/screening-2026-09-28/mc1_document_extraction/gpt-6-sol/receipts.jsonl
[rg]: ../results/screening-2026-09-28/mc1_document_extraction/gemma4-12b/receipts.jsonl
[rq2]: ../results/screening-2026-09-28/mc1_document_extraction/qwen2-5vl-7b/receipts.jsonl
[rq3]: ../results/screening-2026-09-28/mc1_document_extraction/qwen3-vl-8b/receipts.jsonl
[ml]: https://developers.openai.com/api/docs/models/gpt-6-luna "OpenAI, GPT-6 Luna Model"
[ms]: https://developers.openai.com/api/docs/models/gpt-6-sol "OpenAI, GPT-6 Sol Model"
[structured]: https://developers.openai.com/api/docs/guides/structured-outputs "OpenAI, Structured model outputs"
[oq3]: https://ollama.com/library/qwen3-vl:8b "Ollama, qwen3-vl:8b"
[og]: https://ollama.com/library/gemma4:12b "Ollama, gemma4:12b"
[oq2]: https://ollama.com/library/qwen2.5vl:7b "Ollama, qwen2.5vl:7b"
[mg]: https://huggingface.co/google/gemma-4-12B "Google, Gemma 4 12B model card"
[mq2]: https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct "Qwen, Qwen2.5-VL-7B-Instruct model card"
[mq3]: https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct "Qwen, Qwen3-VL-8B-Instruct model card"
