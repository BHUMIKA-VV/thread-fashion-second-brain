# Sample data

Thread does not ship photographs. There are two ways to fill a fresh library for a demo:

## 1. Synthetic swatches (no files needed)

```bash
cd backend
.venv/Scripts/python -m scripts.seed_samples --synthetic
```

Generates 20 textile swatches (stripes, checks, ikat-like diamonds, bandhani-like and
block-print dots, saree-style borders, chevrons, plaids) in Indian dye colours, deterministically,
and uploads them through the normal pipeline. Each is labelled in its notes as a generated
swatch, not a photograph. Good for showing palettes, tags, search and similarity; they are not
fashion photos.

## 2. Your own photos (this folder)

Put up to 50 JPEG, PNG or WebP files here, then:

```bash
cd backend
.venv/Scripts/python -m scripts.seed_samples --from ../database/sample_data
```

- Use only images you have the right to use: your own photos, or images whose licence allows
  reuse (for example CC0 / public-domain collections such as museum open-access textile
  archives). Keep a note of each image's source and licence.
- A filename prefix sets the type: `garment-…`, `outfit-…`, `fabric-…`, `accessory-…`
  (anything else is "other").
- Everything in this folder except this README is git-ignored, so photos are never committed.

## Safe to rerun

- Files already in the library are skipped (matched by their exact bytes), never overwritten.
- `--status` reports how many samples are in the library; it never assumes they are there.
- `--remove` deletes only pieces whose stored bytes are exactly a sample's bytes, with the same
  source flag you seeded with (`--synthetic` or `--from <folder>`). Your own uploads are never
  touched, even if their notes mention samples.
- Development only: the script refuses to run when `THREAD_APP_ENV=production`.
