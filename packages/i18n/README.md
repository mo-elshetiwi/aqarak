# @aqarak/i18n

I preserve the original `messages/en.json` and `messages/ar.json` catalogues for shared mobile consumers. I add design-system wording in matching `messages/en/` and `messages/ar/` namespace files: `Common`, `Theme`, `Status`, `States`, `Format` and `Showcase`.

I merge these namespaces in `getMessages(locale)` and derive `Messages` from the English files. I expose the same supported locales, default locale, validation, direction and alternate-language helpers as before.

I test identical leaf paths in both languages, non-empty strings and all six Arabic categories in each plural message. I keep synthetic property examples in the catalogues so the showcase never depends on live records.

```bash
pnpm --filter @aqarak/i18n test
```
