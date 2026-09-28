# Contract workflows

I implement company-scoped residential contract drafting and the manager, owner and tenant approval chain. I obtain current rights from active memberships and linked owner and tenant records for the company in the URL. I use the domain transition table for lifecycle decisions and run each command in one company transaction.

## HTTP routes

I mount these routes below `/v1/companies/:companyId`:

| Method | Route                                       | Result                                                      |
| ------ | ------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/contracts`                                | Scoped summaries with status filtering and an opaque cursor |
| GET    | `/contracts/drafting-options`               | Manager drafting choices and current owner gates            |
| POST   | `/contracts`                                | A numbered draft and its first immutable terms record       |
| GET    | `/contracts/:contractId`                    | Bilingual terms, rendering, approvals and viewer actions    |
| PUT    | `/contracts/:contractId/draft`              | A new draft version                                         |
| POST   | `/contracts/:contractId/clause-suggestions` | A labelled Arabic suggestion, warnings and provenance       |
| POST   | `/contracts/:contractId/submit`             | Frozen terms and the next approval request                  |
| POST   | `/contracts/:contractId/owner-approval`     | Owner approval of the current content hash                  |
| POST   | `/contracts/:contractId/tenant-acceptance`  | Tenant acceptance and a Tawtheeq record                     |
| POST   | `/contracts/:contractId/owner-return`       | Cancellation with the owner's reason                        |
| POST   | `/contracts/:contractId/tenant-return`      | Cancellation with the tenant's reason                       |
| POST   | `/contracts/:contractId/withdraw`           | Manager withdrawal of a submitted contract                  |
| POST   | `/contracts/:contractId/cancel`             | Manager cancellation of a draft                             |
| POST   | `/contracts/:contractId/revisions`          | One new draft copied from a cancelled contract              |
| GET    | `/approvals`                                | The authenticated person's requested approvals              |
| GET    | `/notifications`                            | The authenticated person's in-app inbox and unread count    |
| POST   | `/notifications/:notificationId/read`       | An audited read timestamp                                   |

I require a UUID company identifier, UUID resource identifiers, strict JSON bodies and an `Idempotency-Key` of 16 to 128 letters, digits, underscores or hyphens for every POST and PUT. I express money in integer fils and dates as `YYYY-MM-DD`. I return each `version.specialClauses[]` item with its stored 1-based `position`, `textEn`, `textAr`, `modelTranslated` and `suggestion`. I return `suggestion` as null for manually entered clauses, or `{ registryEntry, promptVersion, confirmation }` for saved model suggestions. I recover this metadata from the audit event covering the first entity version of the immutable contract version, including after submission or a reload. I expose `suggest_clause` in `viewer.allowedActions` only for a company manager viewing a draft. The contract list accepts `status`, `limit` and `cursor`; the inbox accepts `limit`. Both limits default to 50 and have a maximum of 100. The read command accepts an empty JSON object.

I return RFC 9457 problems with `application/problem+json`, `type`, `title`, `status`, `code` and an optional `field`.

| HTTP status | Codes                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400         | `VALIDATION_FAILED`                                                                                                                                                               |
| 401         | `SESSION_INVALID`                                                                                                                                                                 |
| 403         | `FORBIDDEN`                                                                                                                                                                       |
| 404         | `NOT_FOUND`                                                                                                                                                                       |
| 409         | `VERSION_CONFLICT`, `INVALID_TRANSITION`, `STALE_SUBJECT_HASH`, `APPROVER_NOT_DISTINCT`, `APPROVALS_REQUIRED`, `OVERLAPPING_CONTRACT`, `SUCCESSOR_EXISTS`                         |
| 422         | `REASON_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `SCHEDULE_TOTAL_MISMATCH`, `TENANT_DOCUMENTS_REQUIRED`, `OWNER_ACCOUNT_REQUIRED`, `UNIT_BLOCKED`, `TENANT_REQUIRED`, `INVALID_INPUT` |
| 503         | `UNAVAILABLE`, `MODEL_UNAVAILABLE`                                                                                                                                                |

## Authentication and dependencies

I expose `createWorkflowModules({ authenticate, dependencies })` from `workflows.ts`. The authentication function has the type `(request: Request) => Promise<{ accountId: string } | null>`. I create no sessions in these modules. The session integration can inject its authenticator at the module registration point.

I verify `Authorization: Session <id>` and mobile bearer tokens through the identity module. I load current company capacities through its actor loader inside the workflow transaction. Missing or invalid authentication returns 401 before company data access.

I create dependencies lazily. Database requests require `AWS_REGION`, `DATABASE_CLUSTER_ARN`, `APP_SECRET_ARN` and `DATABASE_NAME`. I use `SCHEDULER_SECRET_ARN` for the relay executor and retain injectable email, model gateway and clock interfaces. I use `AQARAK_APP_ORIGIN`, `NOTIFICATIONS_FROM_ADDRESS` and `EMAIL_CONFIGURATION_SET_NAME` for email rendering and delivery. I do not require those email variables for contract commands or inbox reads. Missing variables needed by a request produce 503.

## Transactions and records

I lock the contract before evaluating a transition. I authorize before replay, calculate the request identity from the validated path and body, and store the response in the command transaction. A committed replay returns the original response without new audit, approval or notification rows.

I write each business row before its event, cover secondary entity versions with `audit.event_subject`, and leave the database's deferred coverage constraint enabled. A refused authorized operation rolls back before I record one `policy.denied` event in a separate transaction. A company with no matching actor scope is concealed with 404; a nonexistent company has no audit chain write.

I freeze the computed owner gate on submission. Approval decisions bind to the stored content hash and include a short browser and platform summary in `lease.approval_context`. The fixed template has ten bilingual sections; I append special clauses from section 11. I render Western digits, `DD/MM/YYYY` dates, English `AED` amounts and Arabic currency words from stored values.

I export `insertNotifications(tx, input)` from `notifications/writer.ts`. It creates a sent in-app row, a queued email row and an outbox row containing only `notificationId`, then returns their audit coverage records. I render email copy from the English and Arabic `Notifications.json` catalogues through `getMessages`. I include only the company name, contract number, workflow outcome and a link to `/<locale>/companies/<companyId>/contracts/<contractId>`. I require sign-in at the destination. I include no approval token, action signature, party name, identity number, amount or contract term. I escape HTML, set `lang` and `dir`, and retain Western digits.

## Email relay

I export `deliverPendingEmails({ schedulerExecutor, appExecutor, email, now, companyId?, limit? })` from `notifications/relay.ts`. I return counts for `attempted`, `sent`, `failed`, `deadLettered` and `skipped`; the default limit is 100 rows across all selected companies. I list companies through the scheduler unless a company identifier is supplied. I process one due outbox row per scheduler transaction with `FOR UPDATE SKIP LOCKED`. I read the recipient's current email and language through a separate application-role system transaction and require an active company link.

I mark an already sent notification's outbox row as sent without calling the sender or inserting another attempt. For an actual delivery attempt, I update the notification and outbox, insert an append-only `work.notification_attempt`, and write one scheduler/system audit event with a null actor and null policy decision. I make the notification version the primary audit subject and cover the outbox version with `audit.event_subject` in the same transaction. I roll the database transaction back if the audit write fails.

I return `attempts`, `deadLettered` and `lastErrorCode` on every contract delivery item. I count the notification's attempt rows and derive `deadLettered` from the last attempt's outcome. I show the attempt number while retrying and the exhausted wording after dead-lettering; I retain the unverified-address explanation for `MessageRejected`.

I record the provider message identifier on success. On failure I increment the failure counter, redact email addresses from the error name and message, truncate the stored detail to 300 characters and delay the next attempt by `2^attempts` minutes. The first delay is 2 minutes. I dead-letter the eighth failure and retain the notification's failed status. Failed counts include dead-lettered attempts. I do not log recipient addresses or message bodies.

I provide at-least-once delivery. A crash after the provider accepts an email but before the database commits can send the email twice on retry. The sent-notification check prevents committed deliveries from being sent again; it cannot eliminate that crash window.

I use a UTF-8 simple email with text and HTML, one recipient, and a ten-second abort deadline. I default the sender address to `notifications@aqarak.ae` and the application origin to `https://aqarak.ae`. I use the optional configuration set when supplied. I run the relay once with:

```sh
pnpm --filter @aqarak/api notifications:relay
```

I print only the result counts from the relay entry point and exit nonzero on an infrastructure failure. I run no real email delivery in tests. I reserve live relay execution for a manual run against the synthetic mailbox simulator company, with `COMPANY_ID` set to that company's identifier.

## Clause suggestions

I accept `POST /contracts/:contractId/clause-suggestions` with an `Idempotency-Key` and `{ "textEn": "English special clause" }`. I require 1 to 2000 characters, a manager and a draft contract. I record the usual `policy.denied` event for an unauthorized role or invalid transition. I select the current `mc5_drafting` primary from the registry on each new request, and I ask for a faithful formal Arabic lease translation without invented obligations, parties, amounts or dates. I return ambiguities as warnings.

I validate structured output containing `textAr` of 1 to 2000 characters and at most five warnings, each no longer than 200 characters. I apply a 20-second gateway timeout. I return HTTP 200 with `{ suggestionId, suggestion: { textAr, warnings }, provenance: { registryEntry, promptVersion, outputSha256 } }`. I persist one `lease.clause_suggestion` row in the request transaction, with the requesting account, contract, registry entry, prompt version, English and Arabic SHA-256 hashes, Arabic text, warnings and structured-output hash. I cover that row with exactly one `clause_suggestion.created` event, initiated by the manager as a person. I store the response in the same transaction's idempotency record so replay returns the same identifier without another model call, suggestion row or event. I write no contract version when generating a suggestion and retain no gateway call record or raw response.

I accept `suggestionId` on an edited special clause after the manager explicitly chooses the suggested translation. I reject the former client `provenance` object through strict input schemas. I check the suggestion's company, contract and requesting account inside the save transaction. I refuse a mismatched or unknown identifier with HTTP 422 `INVALID_INPUT` at `specialClauses.<index>.suggestionId`; I also refuse suggestion identifiers on creation because the contract does not yet exist. I derive `modelTranslated` on the server and disregard a supplied flag. I treat a clause without an identifier as manual, including clauses copied into a revised contract.

I compare the SHA-256 of the Arabic text exactly as saved in UTF-8 with the stored Arabic-text hash. I record `clause_<position>: ai_confirmed` when they match and `ai_edited` otherwise, with the stored registry entry and prompt version on the contract command's event. I keep the suggestion identifier in the form after manual Arabic edits so this decision remains server-controlled. I reject a save combining different registry entries or prompt versions because the command event has one registry and prompt pair. I display the persisted registry, prompt and confirmation beside the Arabic clause after reloading the detail.

I return HTTP 503 `MODEL_UNAVAILABLE` with `detail` equal to `The clause can be translated by hand.` for provider failure, timeout, refusal, invalid output, stopped budget or missing credential. I use the existing structured adapter credential variable. For a local bundle I resolve the registry from the API package's source directory when no adjacent registry file is present. I therefore run the bundled local scripts from the API package through pnpm.

## Synthetic journey scripts

I run `contracts:seed-demo` with the application database role. I create a demo company, three linked accounts, an active manager membership, owner and tenant parties, a representative property ownership, a vacant residential unit, and an active mandate with a null owner gate. I let the company default gate apply. I insert each account while that account is the transaction's current account context. I cover every captured row version with the company creation event and its secondary audit subjects.

I label the company, account display names and parties with `(synthetic)`. I use mailbox simulator addresses of the form `success+<role>-<random>@simulator.amazonses.com`. I create accepted synthetic identity-document metadata with a placeholder key under `test/contracts/` and a synthetic hash; I upload no document. I print one JSON object containing the company, account, owner, tenant, property, unit and mandate identifiers. I keep this output outside the repository.

```sh
# I choose a demo JSON path outside this checkout before running these commands.
pnpm --silent --filter @aqarak/api contracts:seed-demo > "$DEMO_JSON"
STAGE=local pnpm --filter @aqarak/api dev:local
# I export the three verified session credentials for my synthetic accounts.
pnpm --filter @aqarak/api contracts:smoke "$DEMO_JSON"
```

I also accept `/dev/stdin` as the smoke file argument for an entirely in-memory handoff. I send identity `Session` authorization headers, draft four quarterly cheque instalments whose amounts sum to the total, submit, approve as the owner, accept as the tenant and read both inboxes and the manager's detail. I print the HTTP and contract status for each step, then the channel, template, status and last error code for each delivery row. I exit nonzero on any unexpected HTTP status or contract transition. I use a newly seeded company for each journey, since a concluded contract occupies its unit.

| Environment variable                                                           | Purpose                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `AWS_REGION`, `AWS_PROFILE`                                                    | Existing regional and profile configuration for database and email clients                 |
| `DATABASE_CLUSTER_ARN`, `APP_SECRET_ARN`, `DATABASE_NAME`                      | Application-role database access for the API, relay reads and seed command                 |
| `SCHEDULER_SECRET_ARN`                                                         | Scheduler-role relay writes                                                                |
| `AQARAK_IT_CLUSTER_ARN`, `AQARAK_IT_APP_SECRET_ARN`, `AQARAK_IT_DATABASE_NAME` | Seed-command fallback when the corresponding standard variable is absent                   |
| `AQARAK_APP_ORIGIN`                                                            | Email link origin, default `https://aqarak.ae`                                             |
| `NOTIFICATIONS_FROM_ADDRESS`                                                   | Sender address, default `notifications@aqarak.ae`                                          |
| `EMAIL_CONFIGURATION_SET_NAME`                                                 | Optional email configuration set                                                           |
| `COMPANY_ID`                                                                   | Optional company scope for a single relay run                                              |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`                                            | Existing structured adapter credential and optional endpoint override                      |
| `DEMO_MANAGER_SESSION`, `DEMO_OWNER_SESSION`, `DEMO_TENANT_SESSION`            | I supply verified identity sessions for the three synthetic accounts to the smoke command. |
| `API_BASE_URL`                                                                 | Smoke target, default `http://127.0.0.1:4000`                                              |
| `PORT`                                                                         | Local server listening port, default 4000                                                  |

I bundle workspace packages and their transitive dependencies for the local server and these scripts while keeping the AWS SDK external. I add no dependency. I add migration `0403_clause_suggestions.sql` for the registered, company-isolated suggestion log without altering an existing database object.

## Verification

I run the local checks with:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm turbo run lint typecheck test --filter=@aqarak/api --filter=@aqarak/db --filter=@aqarak/i18n --filter=@aqarak/web --concurrency=1
```

I run database tests against a dedicated development database using `AQARAK_IT_CLUSTER_ARN`, `AQARAK_IT_APP_SECRET_ARN`, `AQARAK_IT_SCHEDULER_SECRET_ARN`, `AQARAK_IT_MASTER_SECRET_ARN`, `AQARAK_IT_DATABASE_NAME`, `AWS_REGION` and the existing `AWS_PROFILE`. I reference database secret ARNs through the Data API and never fetch their values. I apply final migration files with:

```sh
DATABASE_CLUSTER_ARN=$AQARAK_IT_CLUSTER_ARN \
MASTER_SECRET_ARN=$AQARAK_IT_MASTER_SECRET_ARN \
DATABASE_NAME=$AQARAK_IT_DATABASE_NAME \
pnpm --filter @aqarak/db migrate:dev
pnpm --filter @aqarak/api test:integration
```

I run integration tests with one worker. The integration script enables the database suite explicitly; ordinary tests skip it, and the suite also skips when no development database name is present. Every scenario creates labelled synthetic records. The workflow fixtures use `.invalid` email addresses; the demo seed uses mailbox simulator addresses. The relay tests always inject fake senders and the suggestion tests always use fake adapters or a missing credential. I retain committed synthetic data for audit inspection. The platform insert probe rolls back its entire transaction.

I keep one exact historical fingerprint in the root `.gitleaksignore`: a fixed synthetic value in an older test commit that a later commit replaced with an ephemeral key. I leave the scanner configuration and commit history unchanged. I verify the complete branch range with:

```sh
~/.local/bin/gitleaks git --log-opts=origin/main..HEAD
```

I verify the production web build and mock journeys with:

```sh
pnpm --filter @aqarak/web build
WEB_E2E_PORT=3140 pnpm --filter @aqarak/web exec playwright test e2e/contracts.spec.ts e2e/approvals.spec.ts --workers=1
```
