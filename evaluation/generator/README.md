# Synthetic document generator

I generate a frozen bilingual document benchmark for field extraction. I use only fictional component lists, synthetic identifier ranges and visibly marked specimen layouts. I keep canonical truth separate from what the image supports. I never use this set for training.

## Run and verify

I run these commands from the repository root using the existing environment:

```sh
~/.venvs/aqarak-eval/bin/python evaluation/generator/generate.py --out evaluation/datasets/synthetic-docs-v1
~/.venvs/aqarak-eval/bin/python -m unittest discover -s evaluation/generator/tests -t evaluation/generator -v
~/.venvs/aqarak-eval/bin/python -m py_compile evaluation/generator/generate.py
```

I record the portable equivalent command in the manifest, with `python` resolving to that same environment. I require Python 3.14.7, Pillow 12.3.0 with raqm, numpy 2.5.3, opencv-python-headless 5.0.0.93 and matplotlib 3.11.2. I neither install packages nor alter the runtime. The default master seed is 20260928 and the default size is 40 documents per kind.

For spot regeneration I use a separate folder and the original master seed and size:

```sh
python evaluation/generator/generate.py --out evaluation/generator/spot-check --only emirates_id-001 --seed 20260928 --per-kind 40
```

I write one image and a one-record `labels.jsonl` in this mode. I do not create a partial manifest or a partial frozen split. I reject spot regeneration into a folder containing a full manifest. The stored per-document seed can also be supplied directly to `generate_document`, together with its recorded digit script, kind and index.

## Determinism and evidence

I derive each document seed from the first four bytes of SHA-256 of `master_seed:kind:index`, interpreted as an unsigned big-endian integer. These 32-bit seeds retain exact integer representation in both Python and JavaScript JSON consumers. I use local `random.Random` instances exclusively. I assign odd indices to layout a and even indices to layout b, and select exactly 12 of 40 documents per kind for Arabic-Indic neutral values using a separate seeded sampler. I define English month abbreviations directly and do not depend on locale, current time, system fonts or global random state.

I measure every drawn target and decoy with `ImageDraw.textbbox`. Before capture, I compare readable and decoy crops against the recorded glyph pixels and check page bounds. For an occluded value I check a uniform cover across the complete text box and its four-pixel margin. I check that absent and distractor targets have no own-value draw event. I fail generation if these checks fail. The deliberately erased-value test verifies that background or watermark ink cannot produce a false pass.

I keep target clean boxes in `render_box`, transformed boxes in `image_box`, and decoy final boxes in the required decoy record. The internal draw registry retains decoy clean boxes for validation and transformation. I count only absent conditions in `absent_not_drawn`; distractors are counted in `decoys_drawn`, after checking that their own value was not drawn. Occluded `printed` records the original string before covering; its supported `value` is null. Capture settings record actual normalised corner offsets, radial glare controls, rotation, blur and JPEG quality. I use one composed homography for pixels and all four corners of every box. I reject a capture that would clip any value, field label, required header or footer. I inset A4 headings and footers to preserve their visibility after the sampled transform.

I preserve label field insertion order. I use canonical sorted-key JSON only where specified for split hashing. I initialise a fresh `random.Random(20260928)` for each kind's sorted ids, shuffle once, select the first 10 for screening and freeze the remaining 30 as held-out. I store both membership lists in id order. The manifest inventories all images, labels and splits; it does not hash itself or the datasheet.

## Fonts and synthetic ranges

I load exactly `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` from `matplotlib.get_data_path()/fonts/ttf`, with `ImageFont.Layout.RAQM` on every font. I explicitly set RTL direction and Arabic language on Arabic runs and right-align those runs. I stop on missing raqm, missing fonts or hash mismatch. I pin these SHA-256 values in the generator:

I preserve identifier and code glyph order in both digit styles by applying U+202D LEFT-TO-RIGHT OVERRIDE and U+202C POP DIRECTIONAL FORMATTING inside the shaping call. A left-to-right paragraph direction alone still reverses Arabic-Indic groups separated by neutral hyphens. I apply the override to target and decoy identifiers; bilingual code descriptions, dates and amounts retain their normal shaping. The controls affect layout only and are not part of canonical values or recorded visible strings. My regression test compares the rendered glyph masks from left to right against independently rendered characters, including identity, card, contract, deed, plot and unit references.

| Font                | SHA-256                                                          |
| ------------------- | ---------------------------------------------------------------- |
| DejaVuSans.ttf      | 3fdf69cabf06049ea70a00b5919340e2ce1e6d02b0cc3c4b44fb6801bd1e0d22 |
| DejaVuSans-Bold.ttf | b184b89e3c1075f22f6b71575b6fc20d4972b3cfd3b23322ca6fd596dcaef167 |

I sample 32 paired first names and 32 paired family names independently. I use ten paired nationalities and ten paired districts. Birth years span 1955 to 2005; calendar days span 1 to 28; card issue years span 2020 to 2028. Identity numbers use `784-YYYY-000SSSS-C` and a computed Luhn digit, and card numbers start with `000`. Contract references use `SPC-YYYY-NNNNNN`, deed references `SPC-D-NNNNNNN`, and plot references `PNN-NNN`. Card expiry is two to ten years after issue. Contract start years span 2024 to 2028, registration is zero to 20 days earlier, and expiry is the anniversary minus one day. Rent spans AED 35,000 to 400,000 in steps of 500. I round a sampled five-to-ten-percent deposit to the nearest 100 with half-up integer arithmetic. I sample one, two, four, six or 12 cheques and areas from 45.0 to 650.0 square metres.

I use the exact listed field names, order and types. The identity card has 10 fields, the contract certificate 17 and the title deed 11. I sample conditions with the stated probabilities, enforce at least half readable per document, and reject a full set below 20 percent non-readable per kind.

## Add a version

I preserve the old images, labels, split and manifest. I change the generator version and create a new dataset directory for any correction, font change, layout change or dependency change. I regenerate, inspect examples from both layout families, rerun every acceptance test and record new hashes. I do not overwrite a frozen version to incorporate extraction results. Byte-identical regeneration is supported on the recorded runtime and font files; I make no cross-runtime JPEG or rasterisation identity claim.
