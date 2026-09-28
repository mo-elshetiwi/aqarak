# @aqarak/web

I expose the bilingual design catalogue at `/en/showcase`, `/ar/showcase`, `/en/showcase/states` and `/ar/showcase/states`. I prerender these routes and mark them `noindex`. I retain the locale-aware landing pages at `/en` and `/ar`.

I import the generated shared token stylesheet in `src/app/globals.css`. I map semantic colour roles, script-specific typography, radii, elevation and motion to utilities. I set document language and direction on the server. I pass the same direction into the component context for keyboard navigation without adding a second DOM direction boundary.

I store the appearance preference as `system`, `light` or `dark` under `aqarak-theme`. I apply explicit preferences in the head before paint and let the system media query respond immediately when the preference is `system`. I keep storage failures non-fatal.

I configure the token-aware class merger in `src/components/ui/cn.ts` so text sizes remain independent of text colours. I retain tooltip roles and description associations across pointer and keyboard interaction.

I export the reusable primitives from `src/components/ui/` and named screen components from `src/components/system/`. I keep entity/state unions, the complete 73-state catalogue and its fixed tone mapping in `status-catalogue.ts`. I use `Contrast` for progress because the installed icon package does not export `CircleHalf`.

I accept integer fils in `MoneyAmount`, timezone-qualified timestamps or ISO dates in `DateText`, and explicit reference times for relative ages. I keep copyable values free of bidirectional control characters. I mask identifier digits while retaining their separators and first and last three digits.

I separate unit tests from DOM component tests in `vitest.config.ts`. I use `renderWithIntl` with the real catalogues and direction context. I test production routes in Chromium with both themes, both languages, accessibility checks, typography measurements, reduced motion, focus restoration and persistence. I read the browser server port from `WEB_E2E_PORT`, defaulting to `3100`, and do not reuse an existing server.

```bash
pnpm --filter @aqarak/web test
pnpm turbo run typecheck lint test --filter=@aqarak/web --filter=@aqarak/ui-tokens --filter=@aqarak/i18n --filter=@aqarak/mobile
pnpm turbo run build --filter=@aqarak/web
WEB_E2E_PORT=3130 pnpm --filter @aqarak/web e2e
```

I provide account registration, email confirmation, sign-in and company setup at `/{locale}/sign-up`, `/{locale}/verify`, `/{locale}/sign-in` and `/{locale}/setup/company`. I keep the pending email in the protected server cookie and prefill it only on the verification page. I add the confirmation notice when the browser reaches sign-in after a successful confirmation. I use the single `postJson` browser boundary for JSON requests and stable refusal codes, retain form input after refusals, focus the error summary and prevent concurrent submissions.

I derive company context exclusively from `/{locale}/companies/{companyId}/{section}`. I require current server session permissions in the company layout and again when resolving each section. I render the same not-found state for missing and foreign companies and a separate not-permitted state for a known section outside the person's capacities. I keep authenticated routes dynamic. I pass only the derived CSRF value through the session context and never pass the session identifier into client components.

I keep the ordered capacity registry in `src/lib/navigation/sections.ts`. I combine staff roles with party links and replace the manager's Money section with the six accounting sections when the accountant capacity is present. I use the same registry to shape navigation and to check section access on the server. I render section-specific empty states without actions; the existing shared empty-state component requires an action, so I use an action-free component within the shell's owned directory. I provide the requested paths through the single dynamic section page, including Home, Inbox and Co-worker. I use only available icons, with no icon-name substitutions.

I use logical start and end positioning for the desktop sidebar and mobile navigation sheet. I preserve the current path when switching language and preserve the appearance preference across navigation. I use a context menu for other companies and a native account disclosure for appearance, language and sign-out. I perform a full document navigation after sign-out to discard the previous account's client cache.

I run browser acceptance tests against the single-process mock adapter. The test configuration generates a session secret at load time. I import synthetic credentials and the confirmation code from `src/lib/api/mock-fixtures.ts`; I do not store an environment secret in source. I cover protected cookies, origin refusal, all seeded capacities, company selection, registration and creation, keyboard focus and accessibility in both languages. I retain the existing design-system tests unchanged.
