# Aqarak 1.0.0

Repository: https://github.com/mo-elshetiwi/aqarak (release tag `v1.0.0`).

## What Aqarak is

Aqarak is a bilingual Arabic and English property-management co-worker for Abu Dhabi. It supports managers, owners, tenants and company staff in preparing and reviewing property records. People review and approve what the system drafts, and every committed business change is recorded in the audit trail.

I, Mohamed Elshetiwi, built Aqarak as my CM3070 Final Project, using the CM3020 Artificial Intelligence project template "Orchestrating AI models to achieve a goal"; this repository contains its code and evaluation.

## Roles and workflow status

The six roles are defined in the [domain permissions](packages/domain/src/permissions/matrix.ts): manager, owner, tenant, technician, company administrator (`company_administrator`) and accountant. The web application provides access for all six; the mobile application has manager, owner, tenant and technician navigation. Company administrators and accountants use the web application.

These statuses are based on the registered API modules, web routes, mobile screens and their tests in this release. Empty-state navigation and isolated domain rules are insufficient to implement a workflow. “Implemented and tested locally” describes local implementation evidence, without implying deployed journey or physical-device validation. The statuses cover the intended web and mobile scope together, so missing mobile workflows remain partial.

| Workflow                                                      | Roles                              | Status                                                                                                            | Implementation and test evidence                                                       |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| W1 owner onboarding                                           | manager, owner                     | partly implemented: API and web tested; mobile onboarding absent                                                  | API `owners/`; web estate forms and `estate.spec.ts`; mobile records shell             |
| W2 property and unit setup                                    | manager                            | partly implemented: API and web tested; mobile setup absent                                                       | API `properties/`; web estate tests; mobile records shell                              |
| W3 tenant onboarding                                          | manager, tenant                    | partly implemented: identity-card review tested; other identity documents and mobile onboarding absent            | API `tenants/`, `documents/`; web tenant and review tests                              |
| W4 contract drafting and approval                             | manager, owner, tenant             | partly implemented: web drafting and approvals tested; PDF and mobile workflow absent                             | API `contracts/`, `approvals/`; web contract and approval tests                        |
| W5 Tawtheeq registration (normal, skip and retroactive paths) | manager, owner, tenant             | partly implemented: API paths and web normal/skip review present; retroactive entry UI and mobile workflow absent | API `tawtheeq/` and integration tests; web Tawtheeq tests and `tawtheeq.spec.ts`       |
| W6 rent schedule and payments                                 | accountant, manager, tenant        | not implemented                                                                                                   | Contract instalment editor and domain payment rules only; mobile payments shell        |
| W7 maintenance                                                | tenant, manager, technician, owner | partly implemented: mobile intake and ticket review tested; triage to completion absent                           | API `maintenance/`, `media/`; mobile report and ticket tests                           |
| W8 renewal and move-out                                       | manager, tenant, owner             | not implemented                                                                                                   | Domain lifecycle rules only; no registered workflow API or dedicated screens           |
| W9 owner statements and portfolio                             | owner, accountant, manager         | not implemented                                                                                                   | No registered workflow API; mobile statements and portfolio shells                     |
| W10 document vault and expiry                                 | manager, owner, tenant             | partly implemented: workflow uploads present; standalone vault and expiry reminders absent                        | API document and extraction modules; web estate, tenant and Tawtheeq upload tests      |
| W11 notes, tasks and reminders                                | all six roles                      | not implemented                                                                                                   | Domain records and navigation only; no registered workflow API                         |
| W12 co-worker order                                           | all six roles                      | not implemented                                                                                                   | Permission rules and drafted-action components only; co-worker screens are shells      |
| W13 notifications and WhatsApp handoff                        | all six roles                      | partly implemented: contract email relay and delivery log tested; push and WhatsApp handoff absent                | API `notifications/` and relay tests; web delivery-log tests                           |
| W14 company sign-up and membership                            | company administrator              | implemented and tested locally                                                                                    | API `identity/`, `companies/`; web registration, invitation, member and settings tests |

API evidence is under `services/api/src/modules/`, web workflow routes under `apps/web/src/app/[locale]/companies/[companyId]/`, web estate tests under `apps/web/src/features/estate/tests/`, browser cases under `apps/web/e2e/`, and mobile screens and tests under `apps/mobile/src/`. Integration tests are separate from ordinary local unit tests; cloud integration requires configured development resources.

## Repository map

The repository contains the following workspaces and supporting materials.

| Folder        | Responsibility                                                                       |
| ------------- | ------------------------------------------------------------------------------------ |
| `apps/`       | Next.js web application and Expo mobile application                                  |
| `services/`   | HTTP API, workflow modules and document-scan worker                                  |
| `packages/`   | Domain rules, database migrations, translations, interface tokens and shared tooling |
| `infra/`      | CDK stacks, infrastructure tests, scripts and redacted development outputs           |
| `evaluation/` | Evaluation harness, synthetic datasets, manifests, decisions and results             |
| `evidence/`   | Evidence ledger and test-run records                                                 |
| `.github/`    | Continuous integration workflows and repository templates                            |

## Running locally

Use Node.js 24 and pnpm 11.11.0, as declared by the root `engines` and `packageManager` fields. Install the locked dependencies with:

```sh
pnpm install --frozen-lockfile
```

### Web fixture mode

Use the transport mode named `mock` for fixtures. Copy the example configuration, select mock mode through `AQARAK_API_MODE`, then start the web application:

```sh
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @aqarak/web dev
```

Open `/en/sign-in` or `/ar/sign-in` on the local development server. Use the synthetic accounts and companies already seeded by the mock adapter, documented in [the API contract](apps/web/src/lib/api/README.md). Obtain the mock-only password from `MOCK_ONLY_PASSWORD` in `apps/web/src/lib/api/mock-fixtures.ts`. Credentials and account addresses are not reproduced here. Mock state is process-local and resets when the process restarts; its extraction and clause suggestions are fixtures.

### HTTP mode and the API

Select the transport mode named `http` through `AQARAK_API_MODE`. Configure `AQARAK_API_BASE_URL`, `AQARAK_APP_ORIGIN` and `AQARAK_SESSION_SECRET` privately. Point the base URL at either a running local API or the deployed development API supplied by its operator. HTTP is allowed only for loopback hosts; other API locations require HTTPS. Use a session secret of at least 32 characters for a production web build.

Start the local API and the web application in separate terminals:

```sh
pnpm --filter @aqarak/api dev:local
pnpm --filter @aqarak/web dev
```

Configure the API through `AWS_REGION`, `DATABASE_CLUSTER_ARN`, `DATABASE_NAME`, `APP_SECRET_ARN`, `PIPELINE_SECRET_ARN`, `SCHEDULER_SECRET_ARN`, `DOCUMENTS_BUCKET_NAME`, `ISSUED_BUCKET_NAME`, `AUDIT_ANCHORS_BUCKET_NAME`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_IDS`, `APP_ORIGIN`, `EMAIL_FROM_ADDRESS`, `EMAIL_CONFIGURATION_SET` and `PROVIDER_KEYS_SECRET_ARN`. Optional settings are `PORT`, `STAGE`, `DOCUMENT_KEY_PREFIX` and `EXTRACTION_TIMEOUT_MS`. Use the SDK credential chain rather than placing credentials in this repository. Follow [the runtime configuration](services/api/src/config.ts) and [local server entry point](services/api/scripts/serve-local.ts) for optional development identity configuration. The local API still needs configured database, storage and identity services for business operations.

For generic synthetic API preparation, run:

```sh
pnpm --filter @aqarak/api contracts:seed-demo
```

Supply `DATABASE_CLUSTER_ARN`, `APP_SECRET_ARN`, `DATABASE_NAME` and `AWS_REGION`, with development access configured privately. Each run creates new records. Its accounts are API fixtures rather than identity-provider logins, and its document row has no uploaded file. The web mock seed is separate and needs no database seed command.

Create the named synthetic records through the application.

Account identifiers in infrastructure configuration, scripts and receipts are redacted. Supply operator-specific configuration before using those files against an AWS account. Optionally supply the CDK context key `sesSenderIdentity` for an additional development SES identity; its empty default grants no additional identity ARN.

## Tests and evaluation

Run the workspace checks separately to limit resource use:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Build the web application before running its browser suite. The default browser suite uses mock mode:

```sh
pnpm --filter @aqarak/web build
pnpm --filter @aqarak/web exec playwright install chromium
pnpm --filter @aqarak/web e2e
```

Release validation recorded 105 passing browser cases and two failures. The English mobile-navigation case passed on an isolated retry; the tenant identity check still failed its contrast assertion, with sampled link contrast below 4.5:1. These browser limitations remain in this release.

Use the evaluation commands documented in [evaluation/README.md](evaluation/README.md):

```sh
pnpm --filter @aqarak/evaluation typecheck
pnpm --filter @aqarak/evaluation lint
pnpm --filter @aqarak/evaluation test
~/.venvs/aqarak-eval/bin/python -m unittest discover -s evaluation/python/tests -t evaluation/python -v
pnpm --filter @aqarak/evaluation screen -- --help
pnpm --filter @aqarak/evaluation screen -- --class mc1_document_extraction --split screening --candidates <registry-ids> --run-id <id> --cap-usd <budget>
pnpm --filter @aqarak/evaluation screen -- --class mc3_speech_to_text --split screening --candidates <registry-ids> --run-id <id> --cap-usd <budget>
pnpm --filter @aqarak/evaluation score -- --run-id <id> --class mc1_document_extraction
pnpm --filter @aqarak/evaluation score -- --run-id <id> --class mc3_speech_to_text --candidates <id-a>,<id-b> --limitations <file>
pnpm --filter @aqarak/evaluation score -- --help
```

Replace the angle-bracket command arguments with the selected run parameters. Use `--split held_out` for frozen held-out collection; scoring reads the split from the run header. Collection can contact configured model services and incur cost; local validation uses hermetic fixtures. Configure external data through `AQARAK_DATA_DIR`, `AQARAK_PRIVATE_RUNS_DIR`, `AQARAK_WHISPER_MODELS_DIR` and `AQARAK_EVAL_PYTHON` as documented in the evaluation guide.

The speech dataset, audio, reference transcripts and hypotheses remain outside the repository because its licence permits non-commercial evaluation only. The repository contains only manifests and hashes for the speech data, together with text-free measurement receipts and aggregate results. Synthetic document inputs are stored separately under `evaluation/datasets/`.

## Where things live

Evaluation results and receipts are in [`evaluation/results/`](evaluation/results/), model-selection decisions in [`evaluation/decisions/`](evaluation/decisions/), and the evidence ledger and test-run record in [`evidence/`](evidence/).

## Deployment status

Deploy with `-c devAccount=<account id>` and pass the same context to `pnpm --filter @aqarak/cdk outputs:dev`; production uses `-c prodAccount=<account id>`.

The application is served at https://aqarak.ae; the web application runs on Vercel and the API and data run on AWS.

