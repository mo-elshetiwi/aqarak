# Tenant onboarding API

I implement individual tenant onboarding under `/v1/companies/:companyId`. I keep the company in the path and load the person's active membership and party links inside each company transaction. I use the domain permission matrix for `tenants_occupants` and `identity_documents`, with a company grant required for managerial commands.

## Authentication and composition

I expose `AccountAuthenticator` in `../documents/context.ts`. I wire production tenant and document modules to the shared identity request adapter. Web sessions and mobile bearer tokens therefore use `resolvePrincipal`, and company capacities use `requireCompanyActor`. I inject deterministic authentication only in isolated tests.

I export `createTenantsModule(deps)` and `createDocumentsModule(deps)` for composition. I initialise cloud dependencies lazily. I use an owned `../documents/database.ts` entry point to re-export the existing workspace database transaction implementation with extensionless imports. This preserves the API compiler configuration while the database package root exports explicit `.ts` paths; I duplicate no transaction implementation. I similarly re-export the domain source through `../documents/domain.ts` so that the local bundle can compile its extensionless imports. The local server packaging must also make the domain hashing dependency available to the API bundle; I include the exact unapplied change in `release-integration.patch`. I require `AWS_REGION`, `DATABASE_CLUSTER_ARN`, `APP_SECRET_ARN`, `DATABASE_NAME` and `DOCUMENTS_BUCKET_NAME`. I accept `DOCUMENTS_KEY_PREFIX`, which defaults to empty. My local integration fixtures require `test/tenants/` and the isolated database `aqarak_tenants`. I accept `PIPELINE_SECRET_ARN` and `OPENAI_API_KEY` as optional extraction configuration; a missing dependency returns `503 EXTRACTION_UNAVAILABLE`. I use `EXTRACTION_TIMEOUT_MS`, defaulting to 60000 milliseconds.

## Routes

| Method | Company-relative path                                          | Result                                                          |
| ------ | -------------------------------------------------------------- | --------------------------------------------------------------- |
| POST   | `/tenants`                                                     | I create an individual tenant.                                  |
| GET    | `/tenants`                                                     | I return company-scoped summaries with masked identity numbers. |
| GET    | `/tenants/:tenantId`                                           | I return a manager's detail or the linked tenant's own detail.  |
| POST   | `/tenants/:tenantId/invitations`                               | I create a seven-day invitation and its outbox row.             |
| POST   | `/tenants/:tenantId/identity`                                  | I save reviewed identity fields with a tenant version check.    |
| POST   | `/documents`                                                   | I create a document version and a checksum-bound upload URL.    |
| POST   | `/documents/:documentId/versions/:versionId/upload-complete`   | I bind verified uploaded bytes to their S3 VersionId.           |
| POST   | `/documents/:documentId/versions/:versionId/extraction`        | I gate extraction on the recorded version's malware tag.        |
| GET    | `/documents/:documentId/versions/:versionId`                   | I return extraction fields and review decisions.                |
| GET    | `/documents/:documentId/versions/:versionId/content`           | I issue a 60-second version-bound view URL and audit the view.  |
| PUT    | `/documents/:documentId/versions/:versionId/fields/:fieldName` | I accept, edit or mark a field absent.                          |
| POST   | `/documents/:documentId/versions/:versionId/reject`            | I reject a pending version with a reason.                       |

I require `Idempotency-Key` on every POST and PUT. I hash the validated request's original JSON body and path parameters with the domain canonical hash. I scope replay by company, account, command type and key. I return `Idempotent-Replayed: true` for stored responses and reject a changed hash. I use RFC 9457 problem bodies without request values and return `Cache-Control: no-store`.

## States and reviewed identity

I progress an uploaded version through `awaiting_upload`, `uploaded`, `scan_clean`, `extracting`, and either `extracted` or `extraction_failed`. I reject mismatched bytes and adverse scan tags as `scan_rejected`. I bind all content reads and scan checks to the saved S3 VersionId. My PUT signature covers content type, length and the unhoisted base64 SHA-256 header for 300 seconds.

I resolve the extraction candidate through the registry's `mc1_document_extraction.primary` class entry. I pass one sniffed JPEG or PNG image and the versioned document extraction prompt to the structured gateway. I persist a receipt before the pipeline transaction inserts the model call and, on success, the extraction. I grant the pipeline role narrowly scoped access to finish the extraction command's idempotency response in that same transaction. A replay during processing returns the stored `extracting` response; a replay after completion returns the final result. I do not automatically restart an interrupted extraction.

I interpret confidence as an uncalibrated evidence-support score, never a percentage. I require confirmation for identity numbers and dates and a source check when those scores are below one. I always display the other field classes as `check`. I copy accepted values on the server, validate edited values, and require an explicit decision for all ten fields. I preserve the decision's provenance and model-call attribution.

I read identity values exclusively from field reviews when saving. I update the tenant's names and identity number, the version's issue and expiry dates, and the document's current version in one transaction. I supersede a previously accepted version and check the tenant's expected entity version. I derive checklist expiry using the current calendar date in Asia/Dubai.

## Audit and refusal boundaries

I cover each inserted or updated registered row with exactly one event subject in the mutation's transaction. I use `appendAuditEvent` for all event writes. My events include `tenant.created`, `tenant.updated`, `invitation.created`, `document.created`, `document_version.created`, `document_version.uploaded`, `document_version.scan_clean`, `document_version.scan_rejected`, `document_version.extracting`, `extraction.created`, `model_call.created`, `field_review.created`, `field_review.updated`, `document_version.accepted`, `document_version.rejected`, `document_version.superseded` and `document.viewed`.

I roll ordinary 403, 404, 409 and 422 refusals back and then append one `policy.denied` in a separate transaction. I skip that event only when its company foreign key cannot exist. I write nothing for malformed requests or invalid sessions.

I resolve two conflicting requirements explicitly. A discovered malware rejection is an audited state transition followed by a `409 SCAN_REJECTED` denial, so the rejected status remains visible. A clean PDF is moved to `extraction_failed` with reason `unsupported_for_extraction` under the extraction-command event, followed by a `422 UNSUPPORTED_FOR_EXTRACTION` denial. This permits the specified manual review path without inserting a model call for unsupported bytes. These two responses persist their audited processing result. All ordinary policy refusals remain mutation-free.

I create invitation tokens from 32 random bytes and persist only their SHA-256 hash. I never return the token. My outbox payload contains only `invitation_id`; the invitation-delivery integration must establish its token-delivery mechanism before invitation emails can be completed.

## Validation

I keep the default suite offline, with injected authentication, database and storage ports. I enable database and S3 integration tests only with `J3_DEV_DATABASE=1`, enforce the `aqarak_tenants` database and test object prefix, and create fresh synthetic demo companies and accounts for each run. I use a fixed synthetic structured adapter and make no provider calls in tests. I retain synthetic fixtures for inspection because the database intentionally prevents destructive history removal.
