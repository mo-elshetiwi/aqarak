# extraction held-out report: held-out-2026-09-28

I report the frozen held-out results as my primary figures. I record product selection and screening comparisons in [my class decision record](decision.md).

## Run facts

| Candidate | Git commit                               | Dataset manifest SHA-256                                         | Split SHA-256                                                    | Registry SHA-256                                                 | Scorer version | Price date | Command                                                                                                                                                                        | Started at               |
| --------- | ---------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| gpt-6-sol | b2755c5d19342c3e5d7feb312a99675206ae2b8b | 5b8552c909425efb1542507a0881a798794a98412231241c680488c314ce9e96 | 7b56033c93ae80e36da97d5e827661f195326ee6b496e5981fc669388696bf99 | 074aa98e6ed3f5014f42ce66104cd7c7b88bfd7a5aaf77bc588583ab2a575200 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc1\_document\_extraction --split held\_out --candidates gpt-6-sol --run-id held-out-2026-09-28 --cap-usd 3 --concurrency 4 | 2026-09-28T05:31:06.854Z |

## Candidate summary

| Candidate | Items | Status counts                                                                                                          | Schema-valid rate        | Primary metric                                | Secondaries                                                                                                                                                                                                                                                                                                                 | Total cost (USD) | p50 latency (s) | p95 latency (s) |
| --------- | ----- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------- | --------------- |
| gpt-6-sol | 90    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 90; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0 | 100.0% \[95.9%, 100.0%\] | Pooled field accuracy: 93.5% \[90.6%, 95.9%\] | Arabic field accuracy: 96.6% \[93.5%, 99.3%\]; Distractor capture rate: 1.1% \[0.2%, 5.7%\]; Exact document rate: 72.2% \[62.2%, 80.4%\]; Incorrect rate: 3.8% \[2.2%, 5.5%\]; Missing field rate: 2.8% \[1.2%, 4.8%\]; Paired accuracy difference to best: 0.0% \[0.0%, 0.0%\]; Unsupported fill rate: 0.0% \[0.0%, 1.7%\] | 0.9756           | 6.938           | 11.907          |

## Existing rejection-rule checks

| Candidate | Decision | Reasons                     |
| --------- | -------- | --------------------------- |
| gpt-6-sol | survives | All screening gates passed. |

## Per-field accuracy

| Candidate | Field               | Accuracy                  |
| --------- | ------------------- | ------------------------- |
| gpt-6-sol | annual\_rent        | 95.8% \[86.4%, 100.0%\]   |
| gpt-6-sol | area\_sq\_m         | 87.0% \[71.4%, 100.0%\]   |
| gpt-6-sol | card\_number        | 81.0% \[62.5%, 95.5%\]    |
| gpt-6-sol | contract\_number    | 90.9% \[76.5%, 100.0%\]   |
| gpt-6-sol | date\_of\_birth     | 90.9% \[76.2%, 100.0%\]   |
| gpt-6-sol | deed\_number        | 95.7% \[86.4%, 100.0%\]   |
| gpt-6-sol | district\_ar        | 88.6% \[78.4%, 97.7%\]    |
| gpt-6-sol | district\_en        | 90.5% \[80.6%, 97.7%\]    |
| gpt-6-sol | end\_date           | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | expiry\_date        | 90.0% \[75.0%, 100.0%\]   |
| gpt-6-sol | id\_number          | 76.2% \[56.5%, 93.8%\]    |
| gpt-6-sol | issue\_date         | 95.2% \[87.8%, 100.0%\]   |
| gpt-6-sol | landlord\_name\_ar  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | landlord\_name\_en  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | name\_ar            | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | name\_en            | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | nationality\_ar     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | nationality\_en     | 96.0% \[87.0%, 100.0%\]   |
| gpt-6-sol | number\_of\_cheques | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | owner\_id\_number   | 73.7% \[52.6%, 92.9%\]    |
| gpt-6-sol | owner\_name\_ar     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | owner\_name\_en     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | plot\_number        | 88.6% \[78.0%, 97.5%\]    |
| gpt-6-sol | property\_type      | 95.2% \[85.0%, 100.0%\]   |
| gpt-6-sol | property\_usage     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | registration\_date  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | security\_deposit   | 88.0% \[72.0%, 100.0%\]   |
| gpt-6-sol | sex                 | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | start\_date         | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | tenant\_id\_number  | 87.0% \[72.2%, 100.0%\]   |
| gpt-6-sol | tenant\_name\_ar    | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | tenant\_name\_en    | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol | unit\_number        | 88.9% \[78.6%, 97.8%\]    |

## Per-kind accuracy

| Candidate | Kind               | Documents | Not run | Readable fields | Accuracy               |
| --------- | ------------------ | --------- | ------- | --------------- | ---------------------- |
| gpt-6-sol | emirates\_id       | 30        | 0       | 217             | 92.6% \[86.5%, 97.6%\] |
| gpt-6-sol | tawtheeq\_contract | 30        | 0       | 361             | 96.1% \[92.9%, 98.9%\] |
| gpt-6-sol | title\_deed        | 30        | 0       | 247             | 90.3% \[83.7%, 95.9%\] |

## Fabrications

No fabrications were recorded.

## Limitations

- I use all 90 frozen held-out synthetic documents, 30 per kind; these controlled layouts do not establish real-document or operational capture performance.
- I preserve scorer 1.2.0, with 2,000 bootstrap resamples, seed 20260928 and 95% intervals. I resample whole documents for pooled field accuracy and retain Wilson intervals for the committed proportion metrics.
- I report the committed unsupported-fill interval over unavailable fields; several such fields can share a document, so its independence assumption limits interpretation of the 1% ceiling.
- I evaluate one screening survivor. Its paired difference to itself is identically zero and supplies no evidence of superiority or non-inferiority to another candidate.
- I compare screening and held-out estimates descriptively in my class decision record; their disjoint items do not support a paired difference between splits.
- I preserve the frozen prompts, model schemas and registry settings. The API snapshot is unpinned, so these results apply to the recorded date and model echoes.
- I count every failed or missing item in the full denominator and retain every fabrication. A high pooled accuracy cannot override a fabricated money value or date.
- I record a product selection decision without changing the runtime registry or claiming deployment, completed control gates, or a validated fallback.
- I interpret the generated survives status and screening-gates wording only as the committed rejection-rule check; it does not establish every ADR gate or product readiness.
- I use linear interpolation for latency and real-time-factor quantiles over successful receipts. I show unavailable latency as empty CSV cells and as zero in the report table.
- I use the last receipt per item as its final status and include every attempt in total cost. I count every missing receipt as not\_run in the full split denominator.
