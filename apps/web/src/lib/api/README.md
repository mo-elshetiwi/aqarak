# Web session API contract

I define the schemas in `contract.ts` as the contract that the deployed API must meet. I use the domain package's `Result`, `ok` and `err` for expected refusals. I treat the API as the authority for accounts, sessions and current company capacities. I keep identity credentials and tokens behind that API; the authentication success body contains only navigation or an acknowledgement.

## Transport

I resolve the following paths relative to `AQARAK_API_BASE_URL`, preserving a base path if present. I send JSON bodies, `Accept: application/json`, `cache: "no-store"` and an abort signal of sixty seconds for company, current-session context and invitation-acceptance requests, or ten seconds otherwise. I allow the longer command deadline for multi-statement Data API transactions. I reject redirects so credentials cannot be forwarded to another origin. I authenticate session operations with `Authorization: Session <id>`. I normalize every email by trimming and lower-casing it before transport.

| Method and path                 | JSON input                                                               | Success status and body                                         | Refusal codes                                                                    |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| POST `/v1/auth/sign-up`         | `{ email, password, fullName, locale }`                                  | 201 `{ accountId, delivery: { medium: "email", destination } }` | `VALIDATION_FAILED`, `EMAIL_TAKEN`, `PASSWORD_POLICY`, `RATE_LIMITED`            |
| POST `/v1/auth/confirm-sign-up` | `{ email, code }`                                                        | 204, no body                                                    | `VALIDATION_FAILED`, `CODE_MISMATCH`, `CODE_EXPIRED`, `RATE_LIMITED`             |
| POST `/v1/auth/resend-code`     | `{ email }`                                                              | 204, no body                                                    | `VALIDATION_FAILED`, `RATE_LIMITED`                                              |
| POST `/v1/auth/sign-in`         | `{ email, password, client: "web" }`                                     | 200 `{ session: { id, expiresAt, idleExpiresAt } }`             | `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `USER_NOT_CONFIRMED`, `RATE_LIMITED` |
| POST `/v1/auth/sign-out`        | No body; session authorization                                           | 204, no body                                                    | `SESSION_INVALID`                                                                |
| GET `/v1/me`                    | No body; session authorization                                           | 200 `Me`                                                        | `SESSION_INVALID`                                                                |
| POST `/v1/companies`            | `{ kind, name: { en, ar }, tradeLicenceNumber? }`; session authorization | 201 `{ company: { id, kind, name, isDemo: false }, context }`   | `VALIDATION_FAILED`, `SESSION_INVALID`, `FORBIDDEN`                              |

I require error responses to use RFC 9457 `application/problem+json` with `type`, `title`, `status` and a closed `code`. I include `NOT_FOUND` and `UNAVAILABLE` in the shared code set. I map an unknown or missing code by HTTP status: 401 becomes `SESSION_INVALID` for session operations or `INVALID_CREDENTIALS` for sign-in, 404 becomes `NOT_FOUND`, 429 becomes `RATE_LIMITED`, and other statuses become `UNAVAILABLE`. I map network failures, timeouts, all 5xx responses, unexpected success statuses and invalid success bodies to `UNAVAILABLE` with status 503. I validate every success body and remove unknown properties before returning it.

## Data definitions

| Type               | Fields and constraints                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Account`          | UUID `id`, normalized `email`, nonempty `displayName`, `locale` of `en` or `ar`                                                                                                                  |
| `CompanyKind`      | `management_company` or `self_managed_owner`                                                                                                                                                     |
| `StaffRole`        | `manager`, `technician`, `company_administrator`, `accountant`                                                                                                                                   |
| `CompanyContext`   | UUID `companyId`, `companyName: { en, ar }`, `companyKind`, boolean `isDemo`, unique `staffRoles`, `partyLinks: { role: "owner" or "tenant", partyId: UUID }[]`; at least one role or party link |
| `Me`               | `{ account: Account, contexts: CompanyContext[] }`                                                                                                                                               |
| `SessionGrant`     | `{ session: { id, expiresAt, idleExpiresAt } }`; opaque 43-character base64url ID representing 32 random bytes; UTC ISO 8601 timestamps; idle expiry no later than absolute expiry               |
| Sign-up input      | Valid email, nonempty password up to 256 characters, trimmed full name of 2 to 120 characters, supported locale                                                                                  |
| Confirmation input | Valid email and exactly six decimal digits                                                                                                                                                       |
| Company input      | Trimmed English and Arabic names of 2 to 120 characters; licence of 1 to 40 characters, required for `management_company` and optional for `self_managed_owner`                                  |
| Sign-up delivery   | Masked destination such as `l***@example.com`, never an unmasked local part                                                                                                                      |

## Browser routes and server rendering

I expose POST handlers under `/api/auth/sign-up`, `/api/auth/confirm-sign-up`, `/api/auth/resend-code`, `/api/auth/sign-in`, `/api/auth/sign-out` and `/api/companies`. I validate `locale` through the shared locale guard. I require the exact allowed `Origin` and, if supplied, `Sec-Fetch-Site: same-origin` before parsing a body or calling the API. I require a session cookie and its `X-CSRF-Token` on sign-out and company creation. I return errors with a stable `code` for later English and Arabic screen copy. I mark every handler response `Cache-Control: no-store`.

I accept the sign-up fields directly. I accept `{ locale, code, email? }` for confirmation and `{ locale?, email? }` for resend; omitted emails come from the protected pending-sign-up cookie. I accept `{ locale, email, password, next? }` for sign-in and `{ locale }` for sign-out. I accept `{ locale, kind, nameEn, nameAr, tradeLicenceNumber? }` for company creation. I return `{ redirectTo }` for navigation or `{ ok: true }` for resend, without session identifiers or personal data in the body or URL.

I set `__Host-aqarak-sid` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, a whole-second `Max-Age` bounded by absolute expiry and no domain. I keep the pending email in `__Host-aqarak-signup` for thirty minutes with the same protections. I clear that cookie after confirmation. I also set it after an unconfirmed sign-in refusal. I derive a per-session CSRF token with HMAC-SHA256 over `csrf|<sessionId>` and compare tokens in constant time.

I retrieve current permissions through `getCurrentSession`, cached only for the current server render. I require `requireSession` in protected layouts and `requireCompanyContext` for company pages in the later screen change. I treat missing and foreign company IDs identically with a not-found response. I use the proxy only as an early cookie-presence check; it strips the query from the return path. I do not infer company context from cookies or roles from the proxy.

I revoke a newly issued session if the subsequent `getMe` call fails and do not issue its cookie. I clear the session cookie after successful sign-out or `SESSION_INVALID`. I retain it for retry if sign-out encounters another refusal. I reject unsafe return paths, including encoded traversal, and otherwise select setup, the sole company home, or the company chooser from `Me`.

## Environment and mock operation

I read configuration at call time. I accept `AQARAK_API_MODE=mock` or `http`; an absent mode defaults to mock only in development or test. I require an HTTPS `AQARAK_API_BASE_URL` for HTTP mode, allowing HTTP only on loopback hosts. I reject embedded credentials, query strings and fragments in that URL. I require `AQARAK_SESSION_SECRET` to contain at least 32 characters in production, and generate one process-scoped random value when it is absent in development or test. I use `AQARAK_APP_ORIGIN` as the public origin when supplied; otherwise I derive it from forwarded protocol and host, or the request host. I require the deployment ingress to overwrite untrusted forwarded headers or to supply the explicit origin.

I keep mock state on `globalThis` so development module reloads preserve it. I support only one process, without persistence across restarts or coordination across replicas. I export `createMockState` and a clock-injectable `createMockApi` for isolated tests. I store salted scrypt password hashes and only SHA-256 hashes of session IDs. I enforce eight-hour idle and seven-day absolute session lifetimes and revoke sessions on sign-out. I refresh idle expiry on authenticated API access, bounded by the absolute expiry.

I define the shared synthetic password only as `MOCK_ONLY_PASSWORD` in `mock-fixtures.ts`; callers and tests import it. I use only synthetic accounts on `example.com`, with fixed exported account, company and party UUIDs. I use the mock-only confirmation code `246810`, with a thirty-minute lifetime renewed by resend. I require at least twelve password characters with upper-case, lower-case, numeric and non-alphanumeric characters in mock registration. I leave production password policy and rate limiting to the deployed API.

| Handle          | English name      | Arabic name  | Email                        | Capacities                                                            |
| --------------- | ----------------- | ------------ | ---------------------------- | --------------------------------------------------------------------- |
| `manager-1`     | Layla Haddad      | ليلى حداد    | layla.haddad@example.com     | Company A: manager                                                    |
| `owner-1`       | Khalid Al Suwaidi | خالد السويدي | khalid.alsuwaidi@example.com | Company A: owner party link                                           |
| `tenant-1`      | Omar Farouk       | عمر فاروق    | omar.farouk@example.com      | Company A: tenant party link                                          |
| `technician-1`  | Anil Kumar        | أنيل كومار   | anil.kumar@example.com       | Company A: technician                                                 |
| `admin-1`       | Hassan Ali        | حسن علي      | hassan.ali@example.com       | Company A: company administrator                                      |
| `accountant-1`  | Noor Saleh        | نور صالح     | noor.saleh@example.com       | Company A: accountant                                                 |
| `owner-2`       | Mariam Al Nuaimi  | مريم النعيمي | mariam.alnuaimi@example.com  | Company A: owner; Company B: company administrator, manager and owner |
| `unconfirmed-1` | Sara Nasser       | سارة ناصر    | sara.nasser@example.com      | Unconfirmed, no contexts                                              |

I seed Company A as “Aqarak Demo Properties” / “عقارك للعقارات (تجريبي)”, a `management_company`, and Company B as “Mariam Al Nuaimi Properties” / “أملاك مريم النعيمي”, a `self_managed_owner`. I mark both as demo companies. I create subsequent companies with `isDemo: false`, granting the creator only `company_administrator` for a management company and additionally `manager` plus an owner party link for a self-managed owner company.

## Members and invitations

I validate all member and invitation response fields in `contract.ts`. I send
`Idempotency-Key` on invitation creation and acceptance, and on company creation
when supplied. I preserve each form's key across retries. I accept the API's
link-free replay response and never reconstruct a missing invitation token.

| Method and path                             | Input                                                        | Success                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| GET `/v1/companies/:companyId/members`      | Session                                                      | 200 `{ members }`                                                                                    |
| GET `/v1/companies/:companyId/invitations`  | Session                                                      | 200 `{ invitations }`                                                                                |
| POST `/v1/companies/:companyId/invitations` | Session, key, `{ kind: "staff", email, staffRoles, locale }` | 201 `{ invitation, token, acceptPath }`, nullable token and path on replay                           |
| POST `/v1/invitations/preview`              | `{ token }`                                                  | 200 `{ invitation: { companyName, companyKind, kind, staffRoles, maskedEmail, expiresAt, status } }` |
| POST `/v1/invitations/accept`               | Session, key, `{ token }`                                    | 200 `{ context }`                                                                                    |

| Projection | Fields                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Member     | `membershipId`, `accountId`, nullable `email` and `displayName`, `staffRoles`, `status`, `version`                        |
| Invitation | `id`, `kind`, `email`, `staffRoles`, nullable `targetId`, `status`, `expiresAt`, `deliveryStatus`, `createdAt`, `version` |

I retain `VERSION_CONFLICT`, `LAST_ADMINISTRATOR`, `ACTIVE_MEMBERSHIP_ELSEWHERE`,
`INVITATION_NOT_PENDING`, `INVITATION_EXISTS`, `PARTY_ALREADY_LINKED` (409),
`INVITATION_EMAIL_MISMATCH` (403), and `IDEMPOTENCY_KEY_REUSED` (422), alongside
the shared validation, session, permission, not-found and availability codes.

I expose three browser POST routes. I apply the shared origin check to all three
and require a session and CSRF token on creation and acceptance. I return only the
six declared invitation summary fields and `inviteUrl` from creation. I construct
that URL from the validated request origin and the validated API accept path. I
return `inviteUrl: null` on a replay because the API no longer holds the raw link.
I return the preview projection for preview and company-home navigation for
acceptance. I keep all responses uncached and exclude tokens from logs.

I do not infer a membership start date: the API projection does not supply one.

## Versioned member and company commands

I send a session and an `Idempotency-Key` on every command below. I validate
request and response bodies and retain refusal codes. I require a positive
`expectedVersion` in every command, including invitation resend. I return
`{ ok: true }` from the browser boundary, except resend, which returns the
same one-time `inviteUrl` projection as invitation creation.

| Method and API path                                              | Additional input                        | Success                                                         |
| ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| POST `/v1/companies/:companyId/members/:membershipId/roles`      | `staffRoles` (one to four unique roles) | `{ member }`                                                    |
| POST `/v1/companies/:companyId/members/:membershipId/suspend`    | `reason` (1 to 2000 characters)         | `{ member }`                                                    |
| POST `/v1/companies/:companyId/members/:membershipId/reactivate` | Optional `reason`                       | `{ member }`                                                    |
| POST `/v1/companies/:companyId/members/:membershipId/remove`     | Required `reason`                       | `{ member }`                                                    |
| POST `/v1/companies/:companyId/invitations/:invitationId/revoke` | Required `reason`                       | `{ invitation }`                                                |
| POST `/v1/companies/:companyId/invitations/:invitationId/resend` | None                                    | `{ invitation, token, acceptPath }`, link fields null on replay |
| GET `/v1/companies/:companyId`                                   | Session only                            | `{ company }`                                                   |
| PATCH `/v1/companies/:companyId`                                 | `name`, `tradeLicenceNumber`, or `trn`  | `{ company }`                                                   |

I expose matching browser POST paths without `/v1`, including POST
`/api/companies/:companyId` for settings. I require `locale`, `idempotencyKey`,
origin, session and CSRF at these boundaries. I validate a 15-digit TRN and
require a management company's licence in the settings boundary. I read its
kind from the API. I keep kind and the owner-approval default immutable.

I project company `id`, `kind`, bilingual `name`, nullable `tradeLicenceNumber`
and `trn`, `defaultOwnerGate`, `isDemo`, `status` and `version`. I preserve mock
membership versions, suspended and removed rows, immediate access changes,
last-administrator protection, invitation token replacement and replay without
links, and company-name changes across current contexts.
