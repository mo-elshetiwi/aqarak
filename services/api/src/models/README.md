# Runtime model decisions

I select the MC1 held-out survivor as the document primary and the MC3 held-out survivor as the speech primary. I set both model fallbacks to null. I retain `manual_form` for document degradation and `typing` for speech degradation, following the [document decision](../../../../evaluation/results/held-out-2026-09-28/mc1_document_extraction/decision.md) and [speech decision](../../../../evaluation/results/held-out-2026-09-28/mc3_speech_to_text/decision.md).

I select the pre-registered higher-capacity Responses candidate as the MC5 text and clause-suggestion primary. I have no held-out MC5 evaluation, so this remains an unvalidated default. I require human review of its output.

I resolve the provider credential from `OPENAI_API_KEY` for local execution or the `openai` field in `PROVIDER_KEYS_SECRET_ARN` at Lambda cold start. I cache the resolved value per execution environment. I create the secret with an empty field and leave value placement to the deployment operator. I use provider availability, without `LIVE_MODELS`, to enable deployed model calls. An empty field retains the existing unavailable or manual paths. After placing or rotating a value, the operator recycles execution environments before verifying extraction.

I bound extraction, speech and clause calls with `EXTRACTION_TIMEOUT_MS`, default 20000 and maximum 24000 milliseconds, leaving time to persist receipts before the 29-second request boundary. I package the validated registry with the function rather than reading an absent source-tree file at runtime.
