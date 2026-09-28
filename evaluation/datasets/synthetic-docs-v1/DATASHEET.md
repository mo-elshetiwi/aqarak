# Synthetic document set version 1

Author: Mohamed Elshetiwi

## Motivation

I generated this set to measure per-field extraction accuracy, missing-field rate and unsupported fill under controlled visibility conditions. I follow the question groups of Datasheets for Datasets (Gebru et al., 2021).

## Composition

I generated 120 JPEG documents with paired Arabic and English labels. I report the exact condition counts below, computed from the exported labels.

| Kind | Documents | Fields per document | Readable | Absent | Occluded | Distractor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| emirates_id | 40 | 10 | 286 | 34 | 44 | 36 |
| tawtheeq_contract | 40 | 17 | 488 | 65 | 72 | 55 |
| title_deed | 40 | 11 | 324 | 34 | 41 | 41 |

I retain the catalogue's field names and order. The identity card has 10 fields, the contract certificate 17 and the title deed 11.

## Generation process and synthetic flags

I use master seed 20260928 and independently derived document seeds. I sample names from fixed bilingual first-name and family-name components, not from a list of people. All records carry synthetic: true. I reserve the 000 identifier serial block, use specimen-prefixed contract and deed references, and print both diagonal SPECIMEN and عينة watermarks plus the SYNTHETIC SPECIMEN header. I include no issuing body, emblem, code image, face or signature. The card photo area is a plain grey box.

I sample conditions independently with probabilities 0.72 readable, 0.10 absent, 0.10 occluded and 0.08 distractor, then promote randomly selected fields if necessary to keep at least half readable. I reject a full generation with fewer than 20 percent non-readable field instances in any kind. An absent row is either empty or omitted at its reserved position. A distractor replaces that row's labels with different plausible bilingual labels and shows only its decoy. I retain canonical truth separately from supported values, and I use null for every non-readable target value.

I check exact glyph crops, page bounds, every cover pixel including its four-pixel margin, missing own-value draw events, and decoy glyphs before capture. I store measured clean boxes for target values and transformed boxes for target values and decoys. The render check counts absent fields separately from distractor fields. I keep the latter in decoys_drawn.

## Preprocessing

I render with the two frozen matplotlib DejaVu fonts and explicit raqm shaping. I vary the bilingual columns and typography across two layout families per kind. I select exactly 30 percent of documents per kind for Arabic-Indic neutral values. I apply Gaussian blur with sigma 0, 0.6 or 1.0, radial glare with opacity at most 0.2, corner jitter at most 2.5 percent per axis, rotation at most two degrees and JPEG quality from 60 to 92. I transform all box corners with the same composed homography used for the image. The clean-render proof does not establish readability after capture.

## Uses

I freeze 10 documents per kind for screening and 30 per kind for held-out extraction evaluation. I initialise a fresh random.Random(master_seed) for each kind's sorted ids, shuffle once, and take the first quarter for screening. I hash id/image pairs in sorted id order. I use this set only for evaluation, never training. I exclude held-out documents from screening and tuning. I do not treat absent, occluded or distractor truth as a supported extraction answer. An occluded synthetic field may be mapped to a redacted null reason in a later evaluator; no extraction-output schema is defined here.

## Distribution

I distribute synthetic images and labels within this repository. I use no sourced personal data or real document images. Random name combinations can coincide with names held by real people; they do not identify those people. The font binaries remain in the existing runtime, and I record their hashes and bundled source without redistributing them.

## Maintenance

I preserve this version and its split hashes on record. A dataset defect requires a new dataset and generator version, fresh manifests and a new documented split. I do not silently repair a frozen benchmark or its labels.

## Limitations

I provide look-alike layouts only, with two layout families and DejaVu typography. I simulate capture effects and include no real capture noise. My labels are exact by construction and do not measure labelling disagreement. I do not represent official security features, real issuer layouts, handwriting or faces. I constrain sampled calendar days to 1 through 28. My synthetic combinations, script allocation and condition floor are controlled design choices, not estimates of any population. Results on this set cannot establish accuracy on real documents.
