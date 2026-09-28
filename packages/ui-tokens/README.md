# @aqarak/ui-tokens

I define the shared colour, type, spacing, radius, target, elevation and motion contract in `src/index.ts`. I preserve the existing named exports for mobile consumers and expose `colorTokens`, `statusTones`, `chartPalette`, `typeScale`, `elevation`, `easing`, `contrastRatio` and `renderTokenCss`.

I use semantic colour names without the CSS `--` prefix in the typed data. I generate the corresponding custom properties for light, explicit dark and system dark themes. I include the type scale for both scripts, all seven categorical chart colours and the compatibility aliases in the same stylesheet. I reserve chart colours four and seven for fills.

I generate and commit `tokens.css` from the typed data. I import it on the web through `@aqarak/ui-tokens/tokens.css`. I keep this file deterministic and compatible with the repository formatter. I test its exact contents, the requested WCAG contrast pairs and the motion and typography constraints.

```bash
pnpm --filter @aqarak/ui-tokens tokens:css
pnpm --filter @aqarak/ui-tokens test
```

I accept opaque six-digit sRGB values in `contrastRatio`. I use the WCAG relative luminance calculation and reject unsupported or translucent inputs rather than implying that an unknown composited background was measured.

I expose the native colour contract through `@aqarak/ui-tokens/color`. I retain its 54 camelCase colour roles, six status tones and eight-digit overlay alpha, alongside the web colour contract and deterministic CSS. I export the native Latin and Arabic type roles and loaded font families from the package root.

I derive both themes from Aqarak's ink navy, warm cream and gold mark. I keep the interface colours flat, preserve violet provenance and the existing status hues, and leave the categorical chart palette and geometry scales unchanged. I document the complete theme values, three contrast adjustments and measured pair table in [my colour specification](../../docs/design/brand-palette.md).

I test every listed text pair at 4.5:1 and control or focus pair at 3:1 without expected failures. I include muted text on its own surface, brand links on cards and the sign-in sidebar, and input boundaries on cards. I also check native and web parity, the unchanged source asset digests, raster dimensions, mobile asset paths, and the specification tables against the same data used by the contrast tests.

I refresh the specification tables after changing colours or contrast pairs:

```bash
pnpm --filter @aqarak/ui-tokens palette:report
```

I verify the rendered mark against a local production build running in mock mode. I run `pnpm --filter @aqarak/ui-tokens test:brand` with `BRAND_BASE_URL` pointing to that local server, defaulting to `http://127.0.0.1:3171`. I check both locales and themes, explicit preferences against the opposite system preference, live system appearance, favicon responses and metadata, the 40 px sign-in mark, the 24 px shell mark at desktop and narrow widths, and the showcase background. I keep the captured views in the ignored `output/playwright` directory.
