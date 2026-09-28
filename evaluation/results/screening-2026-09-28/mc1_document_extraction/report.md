# extraction screening report: screening-2026-09-28

I report these screening results on the screening split; headline figures come only from the held-out split.

## Run facts

| Candidate    | Git commit                               | Dataset manifest SHA-256                                         | Split SHA-256                                                    | Registry SHA-256                                                 | Scorer version | Price date | Command                                                                                                                                                                                    | Started at               |
| ------------ | ---------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| gemma4-12b   | 1fd26ab338c403cc7e2fe9ee300ef050ed0690cf | 5b8552c909425efb1542507a0881a798794a98412231241c680488c314ce9e96 | 88936a03b28fb0bf27b0e4a489cd1e6ae18f1c4af89ed6c8f35ebeb500d429b2 | 0243a954df4bc19dbf96c9817d06e4ca994df743bd3c55caa9ec8d983c0c98e2 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc1\_document\_extraction --split screening --candidates gemma4-12b --run-id screening-2026-09-28 --cap-usd 1                           | 2026-09-28T03:19:17.795Z |
| gpt-6-luna   | b4e9089eac5403c7402bea41d3030468917991dc | 5b8552c909425efb1542507a0881a798794a98412231241c680488c314ce9e96 | 88936a03b28fb0bf27b0e4a489cd1e6ae18f1c4af89ed6c8f35ebeb500d429b2 | 0243a954df4bc19dbf96c9817d06e4ca994df743bd3c55caa9ec8d983c0c98e2 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc1\_document\_extraction --split screening --candidates gpt-6-luna,gpt-6-sol --run-id screening-2026-09-28 --cap-usd 3 --concurrency 4 | 2026-09-28T03:10:57.041Z |
| gpt-6-sol    | b4e9089eac5403c7402bea41d3030468917991dc | 5b8552c909425efb1542507a0881a798794a98412231241c680488c314ce9e96 | 88936a03b28fb0bf27b0e4a489cd1e6ae18f1c4af89ed6c8f35ebeb500d429b2 | 0243a954df4bc19dbf96c9817d06e4ca994df743bd3c55caa9ec8d983c0c98e2 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc1\_document\_extraction --split screening --candidates gpt-6-luna,gpt-6-sol --run-id screening-2026-09-28 --cap-usd 3 --concurrency 4 | 2026-09-28T03:10:57.045Z |
| qwen2-5vl-7b | 1700e9d3815df6af97a13559dcc195decdf089d4 | 5b8552c909425efb1542507a0881a798794a98412231241c680488c314ce9e96 | 88936a03b28fb0bf27b0e4a489cd1e6ae18f1c4af89ed6c8f35ebeb500d429b2 | 074aa98e6ed3f5014f42ce66104cd7c7b88bfd7a5aaf77bc588583ab2a575200 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc1\_document\_extraction --split screening --candidates qwen2-5vl-7b --run-id screening-2026-09-28 --cap-usd 1                         | 2026-09-28T03:53:39.974Z |
| qwen3-vl-8b  | 722bd611241335e64f3c85ea95b0dc724486f87e | 5b8552c909425efb1542507a0881a798794a98412231241c680488c314ce9e96 | 88936a03b28fb0bf27b0e4a489cd1e6ae18f1c4af89ed6c8f35ebeb500d429b2 | 074aa98e6ed3f5014f42ce66104cd7c7b88bfd7a5aaf77bc588583ab2a575200 | 1.2.0          | 2026-09-28 | pnpm --filter @aqarak/evaluation screen -- --class mc1\_document\_extraction --split screening --candidates qwen3-vl-8b --run-id screening-2026-09-28 --cap-usd 1                          | 2026-09-28T04:15:58.768Z |

## Candidate summary

| Candidate    | Items | Status counts                                                                                                           | Schema-valid rate        | Primary metric                                | Secondaries                                                                                                                                                                                                                                                                                                                               | Total cost (USD) | p50 latency (s) | p95 latency (s) |
| ------------ | ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------- | --------------- |
| gemma4-12b   | 30    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 27; provider\_error: 0; refused: 0; schema\_invalid: 3; timeout: 0  | 90.0% \[74.4%, 96.5%\]   | Pooled field accuracy: 74.7% \[62.6%, 85.1%\] | Arabic field accuracy: 74.1% \[60.8%, 85.5%\]; Distractor capture rate: 62.2% \[46.1%, 75.9%\]; Exact document rate: 0.0% \[0.0%, 11.4%\]; Incorrect rate: 14.7% \[8.8%, 21.7%\]; Missing field rate: 10.6% \[0.4%, 23.5%\]; Paired accuracy difference to best: -20.5% \[-31.9%, -11.2%\]; Unsupported fill rate: 61.4% \[49.7%, 72.0%\] | 0.0000           | 44.620          | 67.924          |
| gpt-6-luna   | 30    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 30; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0  | 100.0% \[88.6%, 100.0%\] | Pooled field accuracy: 94.1% \[90.5%, 97.3%\] | Arabic field accuracy: 94.8% \[88.5%, 100.0%\]; Distractor capture rate: 13.5% \[5.9%, 28.0%\]; Exact document rate: 56.7% \[39.2%, 72.6%\]; Incorrect rate: 2.9% \[0.4%, 6.2%\]; Missing field rate: 2.9% \[1.0%, 5.6%\]; Paired accuracy difference to best: -1.1% \[-4.6%, 1.9%\]; Unsupported fill rate: 0.0% \[0.0%, 5.2%\]          | 0.0188           | 4.550           | 8.803           |
| gpt-6-sol    | 30    | budget\_stopped: 0; incomplete: 0; not\_run: 0; ok: 30; provider\_error: 0; refused: 0; schema\_invalid: 0; timeout: 0  | 100.0% \[88.6%, 100.0%\] | Pooled field accuracy: 95.2% \[91.6%, 98.1%\] | Arabic field accuracy: 94.8% \[89.2%, 100.0%\]; Distractor capture rate: 0.0% \[0.0%, 9.4%\]; Exact document rate: 73.3% \[55.6%, 85.8%\]; Incorrect rate: 2.9% \[0.7%, 5.9%\]; Missing field rate: 1.8% \[0.0%, 4.4%\]; Paired accuracy difference to best: 0.0% \[0.0%, 0.0%\]; Unsupported fill rate: 0.0% \[0.0%, 5.2%\]              | 0.3207           | 6.207           | 11.594          |
| qwen2-5vl-7b | 30    | budget\_stopped: 0; incomplete: 0; not\_run: 13; ok: 6; provider\_error: 0; refused: 0; schema\_invalid: 11; timeout: 0 | 20.0% \[9.5%, 37.3%\]    | Pooled field accuracy: 19.4% \[5.5%, 34.5%\]  | Arabic field accuracy: 15.5% \[3.6%, 29.3%\]; Distractor capture rate: 21.6% \[11.4%, 37.2%\]; Exact document rate: 0.0% \[0.0%, 11.4%\]; Incorrect rate: 2.6% \[0.7%, 5.1%\]; Missing field rate: 78.0% \[61.6%, 93.5%\]; Paired accuracy difference to best: -75.8% \[-89.7%, -61.2%\]; Unsupported fill rate: 15.7% \[9.0%, 26.0%\]    | 0.0000           | 58.773          | 84.591          |
| qwen3-vl-8b  | 30    | budget\_stopped: 0; incomplete: 0; not\_run: 29; ok: 0; provider\_error: 0; refused: 0; schema\_invalid: 1; timeout: 0  | 0.0% \[0.0%, 11.4%\]     | Pooled field accuracy: 0.0% \[0.0%, 0.0%\]    | Arabic field accuracy: 0.0% \[0.0%, 0.0%\]; Distractor capture rate: 0.0% \[0.0%, 9.4%\]; Exact document rate: 0.0% \[0.0%, 11.4%\]; Incorrect rate: 0.0% \[0.0%, 0.0%\]; Missing field rate: 100.0% \[100.0%, 100.0%\]; Paired accuracy difference to best: -95.2% \[-98.1%, -91.6%\]; Unsupported fill rate: 0.0% \[0.0%, 5.2%\]        | 0.0000           | 0.000           | 0.000           |

## Screening decisions

| Candidate    | Decision | Reasons                                                                                                                                                                                       |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gemma4-12b   | rejected | Schema-valid rate 0.9 is below 0.95. Critical failures 15 exceed 0. Primary accuracy 0.7472527472527473 is below 0.8923809523809523, the best 0.9523809523809523 minus three margins of 0.02. |
| gpt-6-luna   | rejected | Critical failures 2 exceed 0.                                                                                                                                                                 |
| gpt-6-sol    | survives | All screening gates passed.                                                                                                                                                                   |
| qwen2-5vl-7b | rejected | Schema-valid rate 0.2 is below 0.95. Critical failures 4 exceed 0. Primary accuracy 0.19413919413919414 is below 0.8923809523809523, the best 0.9523809523809523 minus three margins of 0.02. |
| qwen3-vl-8b  | rejected | Schema-valid rate 0 is below 0.95. Primary accuracy 0 is below 0.8923809523809523, the best 0.9523809523809523 minus three margins of 0.02.                                                   |

## Per-field accuracy

| Candidate    | Field               | Accuracy                  |
| ------------ | ------------------- | ------------------------- |
| gemma4-12b   | annual\_rent        | 66.7% \[25.0%, 100.0%\]   |
| gemma4-12b   | area\_sq\_m         | 85.7% \[50.0%, 100.0%\]   |
| gemma4-12b   | card\_number        | 80.0% \[33.3%, 100.0%\]   |
| gemma4-12b   | contract\_number    | 50.0% \[0.0%, 100.0%\]    |
| gemma4-12b   | date\_of\_birth     | 85.7% \[57.1%, 100.0%\]   |
| gemma4-12b   | deed\_number        | 71.4% \[33.3%, 100.0%\]   |
| gemma4-12b   | district\_ar        | 81.3% \[60.0%, 100.0%\]   |
| gemma4-12b   | district\_en        | 100.0% \[100.0%, 100.0%\] |
| gemma4-12b   | end\_date           | 75.0% \[42.9%, 100.0%\]   |
| gemma4-12b   | expiry\_date        | 77.8% \[50.0%, 100.0%\]   |
| gemma4-12b   | id\_number          | 60.0% \[0.0%, 100.0%\]    |
| gemma4-12b   | issue\_date         | 86.7% \[66.7%, 100.0%\]   |
| gemma4-12b   | landlord\_name\_ar  | 87.5% \[59.9%, 100.0%\]   |
| gemma4-12b   | landlord\_name\_en  | 80.0% \[50.0%, 100.0%\]   |
| gemma4-12b   | name\_ar            | 75.0% \[42.9%, 100.0%\]   |
| gemma4-12b   | name\_en            | 85.7% \[55.6%, 100.0%\]   |
| gemma4-12b   | nationality\_ar     | 75.0% \[42.9%, 100.0%\]   |
| gemma4-12b   | nationality\_en     | 100.0% \[100.0%, 100.0%\] |
| gemma4-12b   | number\_of\_cheques | 100.0% \[100.0%, 100.0%\] |
| gemma4-12b   | owner\_id\_number   | 57.1% \[16.7%, 100.0%\]   |
| gemma4-12b   | owner\_name\_ar     | 66.7% \[33.3%, 100.0%\]   |
| gemma4-12b   | owner\_name\_en     | 100.0% \[100.0%, 100.0%\] |
| gemma4-12b   | plot\_number        | 76.9% \[50.0%, 100.0%\]   |
| gemma4-12b   | property\_type      | 60.0% \[0.0%, 100.0%\]    |
| gemma4-12b   | property\_usage     | 44.4% \[11.1%, 77.8%\]    |
| gemma4-12b   | registration\_date  | 57.1% \[20.0%, 90.0%\]    |
| gemma4-12b   | security\_deposit   | 50.0% \[14.3%, 85.7%\]    |
| gemma4-12b   | sex                 | 83.3% \[50.0%, 100.0%\]   |
| gemma4-12b   | start\_date         | 55.6% \[22.2%, 88.9%\]    |
| gemma4-12b   | tenant\_id\_number  | 44.4% \[12.5%, 77.8%\]    |
| gemma4-12b   | tenant\_name\_ar    | 55.6% \[24.9%, 88.9%\]    |
| gemma4-12b   | tenant\_name\_en    | 83.3% \[50.0%, 100.0%\]   |
| gemma4-12b   | unit\_number        | 80.0% \[50.0%, 100.0%\]   |
| gpt-6-luna   | annual\_rent        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | area\_sq\_m         | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | card\_number        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | contract\_number    | 83.3% \[50.0%, 100.0%\]   |
| gpt-6-luna   | date\_of\_birth     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | deed\_number        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | district\_ar        | 87.5% \[68.8%, 100.0%\]   |
| gpt-6-luna   | district\_en        | 85.7% \[64.3%, 100.0%\]   |
| gpt-6-luna   | end\_date           | 87.5% \[62.5%, 100.0%\]   |
| gpt-6-luna   | expiry\_date        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | id\_number          | 80.0% \[40.0%, 100.0%\]   |
| gpt-6-luna   | issue\_date         | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | landlord\_name\_ar  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | landlord\_name\_en  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | name\_ar            | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | name\_en            | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | nationality\_ar     | 87.5% \[60.0%, 100.0%\]   |
| gpt-6-luna   | nationality\_en     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | number\_of\_cheques | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | owner\_id\_number   | 85.7% \[50.0%, 100.0%\]   |
| gpt-6-luna   | owner\_name\_ar     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | owner\_name\_en     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | plot\_number        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | property\_type      | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | property\_usage     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | registration\_date  | 85.7% \[57.1%, 100.0%\]   |
| gpt-6-luna   | security\_deposit   | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | sex                 | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | start\_date         | 88.9% \[66.7%, 100.0%\]   |
| gpt-6-luna   | tenant\_id\_number  | 77.8% \[50.0%, 100.0%\]   |
| gpt-6-luna   | tenant\_name\_ar    | 100.0% \[100.0%, 100.0%\] |
| gpt-6-luna   | tenant\_name\_en    | 83.3% \[50.0%, 100.0%\]   |
| gpt-6-luna   | unit\_number        | 80.0% \[54.5%, 100.0%\]   |
| gpt-6-sol    | annual\_rent        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | area\_sq\_m         | 85.7% \[57.1%, 100.0%\]   |
| gpt-6-sol    | card\_number        | 80.0% \[33.3%, 100.0%\]   |
| gpt-6-sol    | contract\_number    | 83.3% \[50.0%, 100.0%\]   |
| gpt-6-sol    | date\_of\_birth     | 85.7% \[57.1%, 100.0%\]   |
| gpt-6-sol    | deed\_number        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | district\_ar        | 87.5% \[68.8%, 100.0%\]   |
| gpt-6-sol    | district\_en        | 92.9% \[76.9%, 100.0%\]   |
| gpt-6-sol    | end\_date           | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | expiry\_date        | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | id\_number          | 80.0% \[40.0%, 100.0%\]   |
| gpt-6-sol    | issue\_date         | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | landlord\_name\_ar  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | landlord\_name\_en  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | name\_ar            | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | name\_en            | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | nationality\_ar     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | nationality\_en     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | number\_of\_cheques | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | owner\_id\_number   | 85.7% \[50.0%, 100.0%\]   |
| gpt-6-sol    | owner\_name\_ar     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | owner\_name\_en     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | plot\_number        | 92.3% \[75.0%, 100.0%\]   |
| gpt-6-sol    | property\_type      | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | property\_usage     | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | registration\_date  | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | security\_deposit   | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | sex                 | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | start\_date         | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | tenant\_id\_number  | 77.8% \[50.0%, 100.0%\]   |
| gpt-6-sol    | tenant\_name\_ar    | 88.9% \[62.5%, 100.0%\]   |
| gpt-6-sol    | tenant\_name\_en    | 100.0% \[100.0%, 100.0%\] |
| gpt-6-sol    | unit\_number        | 100.0% \[100.0%, 100.0%\] |
| qwen2-5vl-7b | annual\_rent        | 16.7% \[0.0%, 50.0%\]     |
| qwen2-5vl-7b | area\_sq\_m         | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | card\_number        | 40.0% \[0.0%, 85.8%\]     |
| qwen2-5vl-7b | contract\_number    | 33.3% \[0.0%, 75.0%\]     |
| qwen2-5vl-7b | date\_of\_birth     | 28.6% \[0.0%, 66.7%\]     |
| qwen2-5vl-7b | deed\_number        | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | district\_ar        | 12.5% \[0.0%, 29.4%\]     |
| qwen2-5vl-7b | district\_en        | 7.1% \[0.0%, 23.1%\]      |
| qwen2-5vl-7b | end\_date           | 37.5% \[0.0%, 71.5%\]     |
| qwen2-5vl-7b | expiry\_date        | 33.3% \[0.0%, 66.7%\]     |
| qwen2-5vl-7b | id\_number          | 40.0% \[0.0%, 100.0%\]    |
| qwen2-5vl-7b | issue\_date         | 13.3% \[0.0%, 33.3%\]     |
| qwen2-5vl-7b | landlord\_name\_ar  | 25.0% \[0.0%, 57.2%\]     |
| qwen2-5vl-7b | landlord\_name\_en  | 30.0% \[0.0%, 60.0%\]     |
| qwen2-5vl-7b | name\_ar            | 25.0% \[0.0%, 57.2%\]     |
| qwen2-5vl-7b | name\_en            | 14.3% \[0.0%, 50.0%\]     |
| qwen2-5vl-7b | nationality\_ar     | 12.5% \[0.0%, 40.0%\]     |
| qwen2-5vl-7b | nationality\_en     | 42.9% \[0.0%, 83.3%\]     |
| qwen2-5vl-7b | number\_of\_cheques | 33.3% \[0.0%, 75.0%\]     |
| qwen2-5vl-7b | owner\_id\_number   | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | owner\_name\_ar     | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | owner\_name\_en     | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | plot\_number        | 23.1% \[0.0%, 46.7%\]     |
| qwen2-5vl-7b | property\_type      | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | property\_usage     | 11.1% \[0.0%, 33.4%\]     |
| qwen2-5vl-7b | registration\_date  | 28.6% \[0.0%, 66.7%\]     |
| qwen2-5vl-7b | security\_deposit   | 37.5% \[0.0%, 71.4%\]     |
| qwen2-5vl-7b | sex                 | 0.0% \[0.0%, 0.0%\]       |
| qwen2-5vl-7b | start\_date         | 33.3% \[0.0%, 66.7%\]     |
| qwen2-5vl-7b | tenant\_id\_number  | 22.2% \[0.0%, 50.0%\]     |
| qwen2-5vl-7b | tenant\_name\_ar    | 22.2% \[0.0%, 50.0%\]     |
| qwen2-5vl-7b | tenant\_name\_en    | 16.7% \[0.0%, 50.0%\]     |
| qwen2-5vl-7b | unit\_number        | 20.0% \[0.0%, 50.0%\]     |
| qwen3-vl-8b  | annual\_rent        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | area\_sq\_m         | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | card\_number        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | contract\_number    | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | date\_of\_birth     | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | deed\_number        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | district\_ar        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | district\_en        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | end\_date           | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | expiry\_date        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | id\_number          | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | issue\_date         | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | landlord\_name\_ar  | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | landlord\_name\_en  | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | name\_ar            | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | name\_en            | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | nationality\_ar     | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | nationality\_en     | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | number\_of\_cheques | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | owner\_id\_number   | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | owner\_name\_ar     | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | owner\_name\_en     | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | plot\_number        | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | property\_type      | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | property\_usage     | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | registration\_date  | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | security\_deposit   | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | sex                 | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | start\_date         | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | tenant\_id\_number  | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | tenant\_name\_ar    | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | tenant\_name\_en    | 0.0% \[0.0%, 0.0%\]       |
| qwen3-vl-8b  | unit\_number        | 0.0% \[0.0%, 0.0%\]       |

## Per-kind accuracy

| Candidate    | Kind               | Documents | Not run | Readable fields | Accuracy                |
| ------------ | ------------------ | --------- | ------- | --------------- | ----------------------- |
| gemma4-12b   | emirates\_id       | 10        | 0       | 69              | 79.7% \[61.0%, 93.3%\]  |
| gemma4-12b   | tawtheeq\_contract | 10        | 0       | 127             | 66.9% \[43.0%, 86.2%\]  |
| gemma4-12b   | title\_deed        | 10        | 0       | 77              | 83.1% \[71.3%, 91.5%\]  |
| gpt-6-luna   | emirates\_id       | 10        | 0       | 69              | 97.1% \[92.4%, 100.0%\] |
| gpt-6-luna   | tawtheeq\_contract | 10        | 0       | 127             | 94.5% \[88.1%, 99.3%\]  |
| gpt-6-luna   | title\_deed        | 10        | 0       | 77              | 90.9% \[83.3%, 96.5%\]  |
| gpt-6-sol    | emirates\_id       | 10        | 0       | 69              | 95.7% \[88.7%, 100.0%\] |
| gpt-6-sol    | tawtheeq\_contract | 10        | 0       | 127             | 96.1% \[92.5%, 99.2%\]  |
| gpt-6-sol    | title\_deed        | 10        | 0       | 77              | 93.5% \[84.3%, 100.0%\] |
| qwen2-5vl-7b | emirates\_id       | 10        | 0       | 69              | 26.1% \[0.0%, 53.8%\]   |
| qwen2-5vl-7b | tawtheeq\_contract | 10        | 3       | 127             | 27.6% \[0.0%, 55.3%\]   |
| qwen2-5vl-7b | title\_deed        | 10        | 10      | 77              | 0.0% \[0.0%, 0.0%\]     |
| qwen3-vl-8b  | emirates\_id       | 10        | 9       | 69              | 0.0% \[0.0%, 0.0%\]     |
| qwen3-vl-8b  | tawtheeq\_contract | 10        | 10      | 127             | 0.0% \[0.0%, 0.0%\]     |
| qwen3-vl-8b  | title\_deed        | 10        | 10      | 77              | 0.0% \[0.0%, 0.0%\]     |

## Fabrications

| Candidate    | Document               | Field              | Returned value     |
| ------------ | ---------------------- | ------------------ | ------------------ |
| gemma4-12b   | emirates\_id-005       | id\_number         | 784-1966-0004267-3 |
| gemma4-12b   | emirates\_id-005       | date\_of\_birth    | 1959-04-13         |
| gemma4-12b   | emirates\_id-005       | issue\_date        | redacted           |
| gemma4-12b   | emirates\_id-005       | card\_number       | 000417658          |
| gemma4-12b   | emirates\_id-006       | id\_number         | 2-1180000198406    |
| gemma4-12b   | emirates\_id-006       | issue\_date        | redacted           |
| gemma4-12b   | emirates\_id-006       | card\_number       | redacted           |
| gemma4-12b   | emirates\_id-012       | id\_number         | 1387-06-000        |
| gemma4-12b   | emirates\_id-038       | issue\_date        | redacted           |
| gemma4-12b   | emirates\_id-039       | id\_number         | redacted           |
| gemma4-12b   | tawtheeq\_contract-005 | start\_date        | redacted           |
| gemma4-12b   | tawtheeq\_contract-005 | security\_deposit  | 14100.00           |
| gemma4-12b   | tawtheeq\_contract-012 | registration\_date | redacted           |
| gemma4-12b   | tawtheeq\_contract-012 | security\_deposit  | redacted           |
| gemma4-12b   | tawtheeq\_contract-020 | annual\_rent       | 25000.00           |
| gemma4-12b   | tawtheeq\_contract-024 | contract\_number   | SPC-2028-824350    |
| gemma4-12b   | tawtheeq\_contract-024 | tenant\_id\_number | redacted           |
| gemma4-12b   | tawtheeq\_contract-024 | annual\_rent       | 7500.00            |
| gemma4-12b   | tawtheeq\_contract-028 | end\_date          | redacted           |
| gemma4-12b   | tawtheeq\_contract-028 | annual\_rent       | redacted           |
| gemma4-12b   | tawtheeq\_contract-038 | contract\_number   | redacted           |
| gemma4-12b   | tawtheeq\_contract-038 | registration\_date | redacted           |
| gemma4-12b   | tawtheeq\_contract-039 | end\_date          | 2029-11-26         |
| gemma4-12b   | title\_deed-005        | issue\_date        | 2020-04-27         |
| gemma4-12b   | title\_deed-010        | owner\_id\_number  | redacted           |
| gemma4-12b   | title\_deed-020        | deed\_number       | B-849              |
| gemma4-12b   | title\_deed-024        | deed\_number       | SPC-D-1036013      |
| gemma4-12b   | title\_deed-037        | owner\_id\_number  | redacted           |
| gemma4-12b   | title\_deed-038        | deed\_number       | SPC-D-9630744      |
| gemma4-12b   | title\_deed-038        | owner\_id\_number  | 784-1991-0004657-4 |
| gpt-6-luna   | tawtheeq\_contract-010 | registration\_date | 2027-11-01         |
| gpt-6-luna   | tawtheeq\_contract-024 | contract\_number   | SPC-2028-824350    |
| gpt-6-luna   | title\_deed-005        | issue\_date        | 2027-04-13         |
| gpt-6-luna   | title\_deed-024        | deed\_number       | SPC-D-1036013      |
| gpt-6-luna   | title\_deed-038        | deed\_number       | SPC-D-9630744      |
| qwen2-5vl-7b | emirates\_id-005       | id\_number         | 784-1966-0004267-3 |
| qwen2-5vl-7b | emirates\_id-005       | date\_of\_birth    | 13/04/1959         |
| qwen2-5vl-7b | emirates\_id-005       | card\_number       | 000417658          |
| qwen2-5vl-7b | tawtheeq\_contract-010 | registration\_date | 2027-11-01         |
| qwen2-5vl-7b | tawtheeq\_contract-010 | annual\_rent       | 15,100             |
| qwen2-5vl-7b | tawtheeq\_contract-024 | contract\_number   | SPC-2028-824350    |
| qwen2-5vl-7b | tawtheeq\_contract-024 | tenant\_id\_number | redacted           |
| qwen2-5vl-7b | tawtheeq\_contract-024 | annual\_rent       | redacted           |

## Limitations

- I evaluate the screening split only.
- I report small n, with uncertainty intervals that may be wide.
- I use synthetic documents for MC1.
- I run local candidates on a laptop CPU or GPU.
- I use linear interpolation for latency and real-time-factor quantiles over successful receipts. I show unavailable latency as empty CSV cells and as zero in the report table.
- I use the last receipt per item as its final status and include every attempt in total cost. I count every missing receipt as not\_run in the full split denominator.
