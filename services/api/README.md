# @aqarak/api

I keep the HTTP health boundary and its OpenAPI contract in this workspace.

Its public API consists of `app`, `getOpenApiDocument` and the Lambda `handler`.

I run `pnpm --filter @aqarak/api test` from the repository root to test this workspace.

## Module registry

I add each feature module as one entry in `src/modules/index.ts`. I give each
module a unique `basePath` and register its relative routes in `register(app)`.
I validate duplicate base paths before mounting the modules. I expose the package
version and `STAGE` (default `local`) at `GET /v1/system/version`.

## Local server

I use Node 24 and run these commands from the repository root after signing in
to my existing development profile:

```sh
eval "$(aws configure export-credentials --profile aqarak-dev --format env)"
export STAGE=dev
export AWS_REGION=us-east-1
PORT=4000 pnpm --filter @aqarak/api dev:local
```

I export `DATABASE_CLUSTER_ARN`, `APP_SECRET_ARN`, `DATABASE_NAME`,
`DOCUMENTS_BUCKET_NAME`, `ISSUED_BUCKET_NAME` and `AUDIT_ANCHORS_BUCKET_NAME`
from my development configuration when a module needs those resources. I map
them to `clusterArn`, `appSecretArn`, `databaseName`, `documentsBucketName`,
`issuedBucketName` and `auditAnchorsBucketName` in `infra/cdk/outputs/dev.json`.
I read configuration only from the environment at runtime; I log the names of
configured variables without their values. I can smoke-test health and version
without cloud credentials.

I build the local entry point with the repository's existing bundler. I use
`http://localhost:4000/v1/health` in my browser, or my computer's LAN address on
a device on the same network. I bind to `0.0.0.0`, default to port 4000, and stop
with Ctrl+C or SIGTERM. I run the automated port-4010 curl and shutdown test
with `pnpm --filter @aqarak/api test`.

## Owners and properties module

I expose company-scoped owner list, create, detail and update routes at
`/v1/companies/{companyId}/owners`, with `/{ownerId}/mandate`,
`/{ownerId}/bank-details` and `/{ownerId}/invitation` commands. I expose property
list, create, detail and update routes at `/v1/companies/{companyId}/properties`,
with `/{propertyId}/units`, `/{propertyId}/units/{unitId}` and its `/status`
command. Both subjects support `/documents` and
`/documents/{documentId}/versions/{versionId}/{check|accept|reject}`. I require an
`Idempotency-Key` for every command and an entity version for optimistic updates.

I integrate identity through `IdentityResolver`, using the upstream `identity`
context variable before the optional local secret and account headers. I integrate
invitations through `OwnerInvitationPort`; `recordOwnerInvitation` records the
invitation and outbox atomically, while identity owns delivery, token issue and
acceptance. I change either default port in one assignment when integrating it.

I run `pnpm --filter @aqarak/api test:integration` against a development database
named by `DATABASE_NAME`, with the AWS environment configured and a synthetic key
prefix in `DOCUMENT_KEY_PREFIX`, for example `test/owners/`. I use fresh
synthetic demo companies and account addresses on `example.com`. The suite is
inactive without `DATABASE_CLUSTER_ARN`; with it set, the S3 test fails explicitly
if the malware-scan tag does not arrive within 120 seconds. I use a fresh
idempotency key for each check poll. Default tests require no AWS connection.

## Identity and company API

I mount identity at `/v1` and companies at `/v1/companies`. I construct the
runtime dependencies on the first identity request. I use
`DATABASE_SECRET_ARN`, falling back to `APP_SECRET_ARN`, for the runtime database
role. I use `USER_POOL_ID`, `USER_POOL_WEB_CLIENT_ID` and
`USER_POOL_MOBILE_CLIENT_ID` for the identity provider. I keep the local provider
out of the Lambda entry, application and runtime factory imports.

I select synthetic local identity explicitly when serving locally:

```sh
export IDENTITY_PROVIDER=local
export LOCAL_IDENTITY_CONFIRMATION_CODE=246810
export DATABASE_NAME=aqarak_identity
PORT=4010 pnpm --filter @aqarak/api dev:local
```

I supply the database cluster ARN, runtime secret ARN, AWS profile configuration
and region in that same shell. I require a six-digit local confirmation code at
startup. I keep synthetic users, salted scrypt password hashes and opaque mobile
tokens in process memory. I enforce a minimum password length of 12 with upper
case, lower case, numbers and symbols. I lose local provider state on restart;
I keep web sessions and business records in the database. I use the provider
label in the startup line to distinguish local operation.

I expose registration, confirmation, resend, password sign-in, sign-out and
`GET /v1/me` through `/v1/auth/sign-up`, `/v1/auth/confirm-sign-up`,
`/v1/auth/resend-code`, `/v1/auth/sign-in` and `/v1/auth/sign-out`. I return the
provider's UUID subject at registration and reuse it as the person account ID
when a company is created or an invitation is accepted. I refuse sign-in
challenges, including MFA and new-password challenges, with `403 FORBIDDEN` and
an account security event. I leave challenge completion outside this API slice.

I accept web sign-in as `{ email, password, client: "web" }`. I return
`{ session: { id, expiresAt, idleExpiresAt } }` and accept the opaque 43-character
ID in `Authorization: Session <id>`. I store only its SHA-256 hash. I use an
eight-hour idle limit and a seven-day absolute limit, slide the idle limit at
most once per minute and cap it at the absolute limit. I record expiration
once. I revoke the provider refresh token after web sign-in on a best-effort
basis and record revocation failures without retaining provider tokens.

I accept mobile sign-in as `{ username, password, client: "mobile" }` and return
`{ accessToken, accessTokenExpiresAt, refreshToken }`. I verify
`Authorization: Bearer <access token>` against both configured app clients. I
accept `{ refreshToken, client: "mobile" }` at `POST /v1/auth/refresh`, returning
a new access token and a refresh token only when it rotates. I require
`{ refreshToken }` when signing out with Bearer authentication.

I project `/v1/me` by authentication scheme. I return web accounts with `id`,
`email`, `displayName` and `locale`, and contexts with `companyId`,
`companyName`, `companyKind`, `isDemo`, `staffRoles` and `partyLinks`. I return
mobile accounts with exactly `id`, `displayName` and `locale`, and contexts with
exactly `companyId`, `companyName`, `isDemo` and `capacities`. I derive both
projections from current membership and party records. I remove suspended staff
from their staff context on the next request. I preserve any independent owner
or tenant capacity. I revoke the staff link on removal and leave account-scoped
sessions in other companies intact.

I expose company creation at `POST /v1/companies`, company read and update at
`GET/PATCH /v1/companies/:companyId`, member listing at
`GET /v1/companies/:companyId/members`, and membership commands at
`POST /v1/companies/:companyId/members/:membershipId/roles`, `/suspend`,
`/reactivate` and `/remove`. I require `expectedVersion` for updates and a
nonempty `reason` for suspension and removal. I retain an optional reactivation
reason in its audit event. I serialize company commands and
lock active administrator memberships before any change that could remove the
last active administrator. I rely on the global active-membership unique index
to enforce one active staff membership across companies, including companies
hidden by row-level security.

I list and create invitations at `GET/POST /v1/companies/:companyId/invitations`.
I revoke or resend through
`POST /v1/companies/:companyId/invitations/:invitationId/revoke` and `/resend`.
I require `expectedVersion` for both commands and a reason for revocation. I
accept staff invitations with a nonempty unique `staffRoles` list and owner or
tenant invitations with an existing unlinked `targetId`. I expose anonymous
preview at `POST /v1/invitations/preview { token }`, with company names, company
kind, invitation kind, roles, masked email, expiry and effective status. I
accept invitations at `POST /v1/invitations/accept { token }` after checking the
verified account email. I never expose token hashes through these responses.

I use 32 random bytes for invitation tokens and store only their hashes in the
database. I show the token and `acceptPath` once, in the first creation or resend
response. I replace a lost link through resend. I send bilingual
English and Arabic invitation email after the creation or resend transaction
commits. I include both company names, the role and expiry, and put the token in
`${APP_ORIGIN}/${locale}/invitation#${token}`. I default `APP_ORIGIN` to
`http://localhost:3000`. I use `EMAIL_FROM_ADDRESS` as the sender and
`EMAIL_CONFIGURATION_SET_NAME` as the SES configuration set. I select the
disabled sender when the sender address is absent and record `not_configured`.
I record `sent` or `failed` in a separate audited delivery transaction and keep
only the error name for failures. I return the invitation snapshot from the
delivery transaction in the first creation or resend response, including its
delivery status and current version. I use that version for the next revoke or
resend without reloading. I retain the command snapshot from before delivery in
the stored idempotent response.

I export `authenticate`, `requireCompanyActor`, `authorize`, `commandTx`,
`recordDenial` and `withIdempotency` from `src/modules/identity/index.ts`.
I attach authentication per route. I call `requireCompanyActor` inside
`commandTx`, using current active staff and linked parties, then call the domain
permission matrix for the trusted subject. I keep missing and foreign records
indistinguishable. I roll back refused commands before recording exactly one
`policy.denied` in the scoped company chain. I record `access_refused` in the
account security log when the company does not exist. I use this pattern for a
later company-scoped read:

```ts
import { Hono } from "hono";
import {
  authenticate,
  authorize,
  commandTx,
  type Dependencies,
  type IdentityVariables,
} from "../identity";
import { boundary } from "../identity/guard";
import { one } from "../identity/database";

export function registerCompanyRead(
  routes: Hono<{ Variables: IdentityVariables }>,
  deps: Dependencies,
): void {
  routes.get("/:companyId", authenticate(deps), (context) =>
    boundary(context, async () => {
      const companyId = context.req.param("companyId");
      const permission = {
        route: "/v1/companies/:companyId",
        method: "GET",
        capability: "company_settings" as const,
        operation: "read" as const,
      };
      const company = await commandTx(
        { deps, principal: context.get("principal"), companyId, permission },
        async (tx, actor) => {
          authorize(actor, permission, { company_id: actor.company_id });
          return one(
            tx,
            "select id from core.company where id=cast(:id as uuid)",
            {
              id: companyId,
            },
          );
        },
      );
      return context.json({ company });
    }),
  );
}
```

I keep each successful business command and its single covering audit event in
one transaction. I add secondary event subjects for every other version written
by that command. I cover six row versions when creating a self-managed owner
company for a new account: company, account, membership, owner and two company
links. I record account actions in `ops.security_event`. I exclude credentials,
raw tokens and token hashes from event fields. I use policy version
`permissions-2026-09-28` and record the capability and operation in permission
decisions, adding the route and refusal reason for denials.

I accept the domain-validated `Idempotency-Key` on business commands. I scope
keys by company, account and command and hash the validated body and path. I
reserve and complete the key in the command transaction, store `{ status, body }`
and replay it with `Idempotent-Replayed: true`. I derive company IDs from the
account and key using a fixed UUID-v5 namespace. I reject reuse with a different
request hash. I retain the invitation snapshot in creation and resend replay
records with `token: null` and `acceptPath: null`. I replay that stored body with
status 201 for creation or 200 for resend. I never persist the raw invitation
token in idempotency records, invitation records or audit events, or include it
in invitation listing and preview responses.

I return RFC 9457 `application/problem+json` responses with `type`, `title`,
`status` and `code`. I retain the web contract codes and add the following
business-command refusal codes:

| Status | Codes                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`, `PASSWORD_POLICY`, `CODE_MISMATCH`, `CODE_EXPIRED`                                                                                       |
| 401    | `INVALID_CREDENTIALS`, `SESSION_INVALID`                                                                                                                      |
| 403    | `USER_NOT_CONFIRMED`, `FORBIDDEN`, `INVITATION_EMAIL_MISMATCH`                                                                                                |
| 404    | `NOT_FOUND`                                                                                                                                                   |
| 409    | `EMAIL_TAKEN`, `VERSION_CONFLICT`, `LAST_ADMINISTRATOR`, `ACTIVE_MEMBERSHIP_ELSEWHERE`, `INVITATION_NOT_PENDING`, `INVITATION_EXISTS`, `PARTY_ALREADY_LINKED` |
| 422    | `IDEMPOTENCY_KEY_REUSED`                                                                                                                                      |
| 429    | `RATE_LIMITED`                                                                                                                                                |
| 503    | `UNAVAILABLE`                                                                                                                                                 |

I test provider and email adapters with injected transports. I run database
acceptance tests with `pnpm --filter @aqarak/api test:integration`, after exporting
the runtime database environment in the same shell. I require
`DATABASE_NAME=aqarak_identity`; I use the local provider and a fake sender.
I run independent test files in parallel with two workers and keep tests inside
each file sequential. I also exercise parallel commands in the explicit
concurrent-acceptance test. I retain synthetic records
and their audit chains instead of deleting fixture rows. I keep integration
files excluded from the ordinary API unit suite.

## Company command kernel and audit trail

I mount the append-only trail at `/v1/companies/:companyId/audit`. I resolve the
actor from active memberships and linked owners or tenants inside the company
transaction. I require the domain's company-scoped `audit_read` grant for events,
history, verification, anchors and CSV export. Personal-scope grants do not expose
the company trail; I return `NOT_PERMITTED` for these existing company actors.
I reserve party-scoped history for owners and tenants for later work.

I expose `GET /events`, `GET /subjects/:subjectType/:subjectId/versions`,
`POST /verification`, `POST /anchors` and `GET /export.csv`. I reject authenticated
attempts to patch or delete events with an audited problem. I return no-store
responses and use closed problem codes for screen catalogue mapping. I accept
only empty objects for verification and anchoring. A different valid body reusing
an idempotency key receives `IDEMPOTENCY_KEY_REUSED` at the kernel boundary;
additional fields on these two empty-body routes fail strict validation first.

I authenticate web sessions and mobile bearer tokens through the identity module's
`resolvePrincipal`. I load current company capacities through `requireCompanyActor`
inside each request transaction. The local server can select the in-process identity
provider; production uses the configured identity provider and the same guards.

I load database configuration lazily from `DATABASE_CLUSTER_ARN`,
`DATABASE_SECRET_ARN` (falling back to `APP_SECRET_ARN`), `DATABASE_NAME` and
`AWS_REGION`. I use optional `PIPELINE_SECRET_ARN` for document-pipeline work,
`DOCUMENTS_BUCKET_NAME` for documents, and `AUDIT_ANCHORS_BUCKET_NAME` for locked
checkpoints. I prepend `STORAGE_KEY_PREFIX` to object keys, defaulting to an empty
prefix. I log missing variable names without their values.

I serialize company commands and denials on the company row and hold the chain
head lock while verifying or anchoring. I read the company row without `FOR UPDATE`
for queries. I keep that lock for commands so chain-head and business-row locks
are acquired in the same order. I attach the requested record or draft subject
to the kernel specification, so early role and company refusals identify the
attempted target. An explicit refusal subject takes precedence over this fallback. I also resolve
audit subject and event identifiers from their existing route parameters before
authorization, keeping those early denials attached to the requested subject.
I reserve idempotency keys in the same
transaction as the command response and declared events. I roll back refusals
before recording one `policy.denied` event in a new transaction. I require each
command to call `coverTransactionVersions` after its writes and primary event;
the deferred database coverage trigger rejects uncovered changes.

I restore the nullable event `details` column in migration `0500`. I omit this
column from the canonical payload for older rows whose value is null, preserving
their original hashes. I read canonical payloads in pages of 500 and verify them
with both SQL and the domain verifier. I compare the latest checkpoint with its
specific S3 object version, checksum and Object Lock metadata. SQL alone cannot
detect a suffix deletion accompanied by a rewritten head; the independent
checkpoint exposes that deletion as `behind_anchor`.

I use default bucket Object Lock retention and require a returned version ID when
anchoring. An S3 write and database commit are separate operations: a failed or
ambiguous database commit can leave an unreferenced locked object version. I do
not claim cross-service atomicity. Successful idempotent replays never put another
object. I retain synthetic integration records and locked test objects for audit
evidence; the bucket retention policy governs their later removal.

I run `pnpm --filter @aqarak/api test` without cloud configuration and
`pnpm --filter @aqarak/api test:integration` with the development environment loaded.
I enable destructive synthetic-chain tests only when `MASTER_SECRET_ARN` is set.
I allow TypeScript source extensions during API typechecking because the database
workspace exports source files. Before Lambda deployment I need the identity
verifier, `AUDIT_ANCHORS_BUCKET_NAME`, versioned object read and put permissions,
and the optional pipeline secret and its access grant for the Tawtheeq workflow.

## Tawtheeq registration workflow

I expose the Tawtheeq module at `/v1/companies/:companyId/tawtheeq`. I use the
company command kernel for session authentication, idempotency, optimistic
versions and audit coverage, and the Tawtheeq domain for every registration
transition. I require manager write permission for registration commands and the
linked representative owner's approval capability for owner decisions. I filter
party reads by contract ownership and tenancy, and mask identity numbers outside
manager responses. I return developer English problems for catalogue translation.

I accept checksum-signed uploads of JPEG, PNG and PDF files up to 20 MiB. I sign
content type, length and the base64 SHA-256 checksum for five minutes. Completion
pins the S3 version, checks the declaration and file signature, and reads the
malware scan tag outside the database transaction. I recheck the record version
and document binding in the command transaction before persisting that evidence.
I link the certificate and apply the domain upload transition only for `scan_clean`.
I retain a pending version as `uploaded`, record `document.uploaded`, and return
HTTP 409 `SCAN_PENDING` without changing the record state or version. I retain
rejected versions as `scan_rejected`, record one `document.scan_rejected` event
with its reason, and return HTTP 422 `SCAN_REJECTED`. Both outcomes preserve the
current document link and allow a replacement upload. I retry pending completion
with a fresh idempotency key and the current record version. Source previews use
version-pinned GET URLs lasting at most five minutes.

I extract images through `mc2_contract_understanding`, first its primary candidate
and then its fallback. I use the committed document schema and label all proposals
`uncalibrated`. The current schema has no owner identity or authoritative UNT field;
I require manual confirmation of those values and do not equate a printed unit
label with an UNT number. PDF documents and unavailable extraction use manual
entry. I persist candidate attempts and extraction proposals with the pipeline
role, without placing proposals in lease tables. I reserve the command and snapshot
its source in a short transaction, then call the provider after that transaction
commits and releases its company lock. I store the result in the command's
idempotency response before persisting its pipeline rows. A retry of a completed
command returns that result and retries persistence without another provider call.
An in-progress replay returns an unavailable response. If the process stops before
storing the result, that key stays pending and requires a new command key after
investigation. I do not return internal call records to the client.

I require review fields in the form `{ value, provenance }`, where provenance is
`manual`, `extracted` or `edited`. Integer amounts are fils; decimal strings are
AED with exactly two decimal places. I compare identities as digits, dates as ISO
calendar dates, and names using case and whitespace normalization. Missing fields
are explicit comparison results. Optional unprinted fields do not create a
resolution task. I require an explanation for every resolution and permit
formatting or transliteration equivalence only for minor text fields.

I hash adoption terms with `contractContentHash`, using `sha256Hex(encodeCanonical(terms))`.
My term projection contains `term_start`, `term_end`, `annual_rent_fils`,
`total_fils`, `deposit_fils`, `grace_days`, `vat_bp`, `services`, `template_code`,
`template_version`, `contract_type`, `owner_name`, `tenant_name`, `unt_number`,
`owner_id_number` and `tenant_id_number`. I copy existing clauses and occupants
before submitting an immutable adoption version. Because contract versions have
no party-name or usage columns, I retain the adopted term projection and its
version/hash binding in the review's `_adoption` metadata. I use that projection
when subsequently comparing the current adoption version. I move the current
version only on the domain's `move_current_version` effect. The shared contract
module should ultimately own this hash projection so ordinary submissions and
Tawtheeq adoptions use one canonical term contract.

I create notification outbox rows only; requests do not send notifications. I add
an owner notification for a successful skip because the current domain skip
transition does not emit that notification. Owner skip confirmation is an
approval decision on the current contract hash, followed by the manager's domain
skip command. I retain the original review and discrepancy history.

I run the isolated integration suite with `AQARAK_INTEGRATION=1` against
`aqarak_tawtheeq`. Tests upload synthetic PNG files under `test/tawtheeq/`, set
scan tags themselves and inject a structured adapter. I do not make live model
calls in the default test suite. Any live model validation requires `LIVE_MODELS=1`.

After loading my local development environment, I bundle and run the smoke seed
with this one-line command from the repository root:

```sh
pnpm --filter @aqarak/api exec esbuild src/modules/tawtheeq/smoke/seed-local-smoke.ts --bundle --platform=node --format=esm --packages=external --alias:@noble/hashes=../../packages/domain/node_modules/@noble/hashes --alias:@aqarak/domain=../../packages/domain/src/index.ts --alias:@aqarak/db=../../packages/db/src/index.ts --alias:@aqarak/db/data-api=../../packages/db/src/data-api.ts --outfile=dist/seed-local-smoke.mjs && STAGE=local pnpm --filter @aqarak/api exec node dist/seed-local-smoke.mjs --sessions-out dist/sessions.json
```

I refuse smoke seeding outside `STAGE=local`, outside an `aqarak_` database, or
when the session-file destination is outside the working directory. I write only
session hashes to the file, with mode `0600`, and print synthetic account IDs and
local session IDs to stdout. I keep this output and the session file uncommitted.
The seed includes both companies, manager and secondary manager, linked owner and
tenant, accountant and technician, unit 711, and the frozen owner gate.
I accept `--company-id <uuid>` to choose the synthetic company ID for a local run;
I generate a random ID when it is omitted. An existing company is not overwritten.

For a deployed Lambda I need the real session verifier, the pipeline secret
reference and access grant, the runtime `OPENAI_API_KEY` secret reference, and a
versioned documents bucket. I need permission to sign PUTs and read versioned
objects, object attributes and scan tags, including the applicable KMS grants.
The malware scanner must publish its scan-status tag. I have not deployed or
validated those production integrations in this release.

## Retroactive Tawtheeq intake

I record an outside tenancy through a manager-owned `ai.drafted_action` whose
command type is `tawtheeq.retroactive_intake`. I retain its source as a Tawtheeq
`doc.document` with subject type `drafted_action`. I use the existing signed PUT,
checksum, object-version pinning, scan-tag and file-signature checks for uploads.
A refused intake completion rolls back all database changes and records a denial.
A pending scan can be checked again with the latest draft version and a new key.

I expose these routes relative to `/v1/companies/:companyId/tawtheeq`:

| Method | Route                                                       | Body and result                                                                                                                                                                   |
| ------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/retroactive`                                              | `{}` returns HTTP 201 with `draftId` and `version`.                                                                                                                               |
| POST   | `/retroactive/:draftId/uploads`                             | `expectedVersion`, `fileName`, `contentType`, `byteSize`, `sha256`; returns a signed upload and the next draft version.                                                           |
| POST   | `/retroactive/:draftId/uploads/:documentVersionId/complete` | `expectedVersion`; returns the draft view and document state.                                                                                                                     |
| POST   | `/retroactive/:draftId/extraction`                          | `expectedVersion`; returns the ready draft, proposals and extraction result.                                                                                                      |
| GET    | `/retroactive/:draftId`                                     | Returns the proposal, document state, exact identity candidates and a `missing` list.                                                                                             |
| POST   | `/retroactive/:draftId/confirm`                             | `expectedVersion`, `ownerId`, `unitId`, `tenantId` and `fields`; an optional `documentVersionId` must match the current source. Returns HTTP 201 with the registered record view. |

I require `Idempotency-Key` on every POST and use `X-Aqarak-Channel` for
`web_form` or `mobile_form`. Only the initiating manager can access the draft.
I reject stale versions before writes. I replay a successful confirmation with
its original result, without another contract, approval or notification.

I use the existing `mc2_contract_understanding` extraction and pipeline
persistence. I call the provider outside every transaction. I reserve extraction
against a draft version and source document, retain its result before pipeline
persistence, and publish proposals only into the draft payload. A replacement
upload invalidates that reservation, so an older result cannot become the new
proposal. A successful or degraded extraction makes the draft ready. The current
extraction schema does not propose an authoritative UNT or owner identity;
I therefore return empty candidate lists for those absent values and require
manual matching. I never interpret a printed unit label as an UNT number.

I require each of `unt_number`, `owner_id_number`, `tenant_id_number`, `term_start`,
`term_end`, `total_fils`, `vat_bp`, `payment_schedule`, `tawtheeq_number` and
`registered_on` as `{ value, provenance }`. Provenance is `extracted`, `edited`
or `manual`, persisted as `ai_confirmed`, `ai_edited` or `human_entered` on the
drafted action and primary event. Money is integer fils, dates are ISO calendar
dates, and `vat_bp` is 0 or 500. The payment schedule is an array of
`{ seqNo, amountFils, vatFils }`; I validate its exact total, VAT and unique
sequence numbers before confirmation. I require the linked records' identity
strings to equal the confirmed values exactly, and the chosen owner to be the
unit property's representative owner. I require both parties' company links to
be active. Missing records produce `RETROACTIVE_EVIDENCE_MISSING` with a `missing`
list. Identity refusals name the field and use HTTP 422; missing evidence and
unit overlap use HTTP 409. Every domain refusal rolls back before one denial event.

I build `conclude_retroactive` and call `transitionContract` for IN8R. I apply its
effects in one company transaction: the Concluded retroactive contract, immutable
standard version 1, inclusive blocking unit term, manager retroactive confirmation,
Registered retroactive Tawtheeq record, accepted document review, committed draft
and two notification outbox rows. I allocate `RC-<yyyy>-<six digits>` while the
kernel holds the company lock; the existing unique constraint provides a second
check. I map the unit exclusion constraint's SQLSTATE `23P01` to
`OVERLAPPING_CONTRACT`. I retain the confirmed fields and matched IDs in the draft
payload and hash that projection with `contractContentHash`. I bind the manager's
approval to that hash. I set `submitted_at` to the command time and
`frozen_owner_gate` to false because retroactive intake does not apply the owner gate.
The required annual-rent storage column receives the confirmed total; the intake
does not infer an annualised amount or an unconfirmed deposit.

I write `contract.created`, `approval.approved`, `contract.concluded` and
`tawtheeq_record.registered` in the same transaction. I use the first as the
primary event and cover every entity version written by the command. Notification
payloads contain identifiers, the recipient role and the
`retroactive_contract_recorded` template, without document content or identity
numbers. Outbox creation records notification intent; it does not prove delivery.

I defer the domain's `activate_schedule` effect in this release. I retain the confirmed
payment schedule in the committed drafted action and create no instalment rows.
The accountant records past instalments through the payments workflow. I return
`scheduleActivation: "deferred_to_payments"` in the confirmation response.
I use existing columns and constraints, so this intake requires no migration.

## Shared identity and invitation integration

I route company modules through `identity/adapters.ts`, which calls `resolvePrincipal`
for web sessions and mobile bearer tokens and `requireCompanyActor` for current
company roles and linked parties. I retain each module's response vocabulary and
record one policy refusal after its transaction rolls back. I exclude infrastructure
failures from the audit kernel's policy-denial events.

I issue owner and tenant invitations through `identity/invitations.ts`. I expire
matching pending rows in the issuing transaction and store only token hashes. I put
only the invitation identifier in `ops.outbox`. The relay claims pending work,
commits a replacement token hash before sending the bilingual acceptance link,
and records delivery or retry state. I run one company with
`COMPANY_ID=<company UUID> pnpm --filter @aqarak/api invitations:relay` using the
application and scheduler secret references. I do not persist acceptance tokens
in outbox payloads or idempotent party-command responses.

I exercise each shared-auth module and both party invitation lifecycles in
`src/modules/identity/shared-auth.integration.test.ts` against
`DATABASE_NAME=aqarak_integration`. I use a captured email transport in that suite
to inspect and accept the generated links without contacting external recipients.

I run the bilingual local browser journey with
`pnpm --filter @aqarak/web exec playwright test --config playwright.journey.config.ts`
after building the web app. I export the development database and bucket references
and the extraction API credential in the environment. The configuration starts the
local API on port 4000 and the web app on port 3100 in HTTP mode with one browser
worker. I record each blocked step and its reason in the untracked report, while
continuing independent steps. The browser journey obtains party acceptance links
from the identity resend response; the database suite verifies outbox delivery.
