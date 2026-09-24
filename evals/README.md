# Gate judgement eval

`scripts/eval-gate.mjs` answers one question with a number: **does a cheaper
model identify products as well as the expensive one?**

The whole cost architecture of the scan engine rests on the answer. Nothing
in `scripts/check-identification.mjs` can settle it, because that suite mocks
the model's verdicts in order to test the engine's logic. This one uses real
photographs and real API calls.

## Setup

1. Put scanned-style photos in `evals/photos/` and merchant listing images in
   `evals/candidates/`. A "scanned-style" photo means what a user would
   actually submit: a phone photo or a screenshot, with the background, crop
   and lighting that implies. Not a catalogue shot.
2. Write `evals/gate-cases.json`:

```json
[
  {
    "id": "polo-ph2083",
    "photo": "evals/photos/polo-glasses.jpg",
    "candidates": [
      { "image": "evals/candidates/polo-ph2083.jpg",   "expect": "exact" },
      { "image": "evals/candidates/polo-ph1117.jpg",   "expect": "similar" },
      { "image": "evals/candidates/zenni-4438821.jpg", "expect": "different" }
    ]
  }
]
```

3. `export ANTHROPIC_API_KEY=...`
4. `npm run eval:gate` prints what it will cost and stops. Add `--yes` to run.

## Which cases are worth including

The easy ones tell you nothing: every model gets an identical catalogue photo
right, and every model gets a drill-versus-eyeglasses wrong-category pair
right. The measurement lives in the hard middle:

- **Same brand, different model.** The Under Armour failure. A bag from the
  same line, same logo, different silhouette.
- **Same shape, different brand.** The Ralph Lauren failure. A frame with a
  near-identical profile and someone else's logo on the temple.
- **Same model, different colourway.** Labelled `similar`, never `exact`.
  This is where a weaker model tends to over-confirm.
- **The correct product photographed badly.** Angled, dim, partially
  occluded, with a price sticker on it. Labelled `exact`.

Twenty well-chosen cases are worth more than two hundred easy ones. Your
labels are the ceiling on the measurement's quality, so label conservatively:
if you cannot tell whether it is the identical model, the answer is `similar`.

## Reading the result

Two error classes, and they are not equally bad:

- **False confirmation** - said `exact` when the truth is `similar` or
  `different`. This is the one that ends up on a shareable card accusing a
  named seller over the wrong product. Treat any false confirmation rate
  above roughly 1% as disqualifying for that model.
- **Missed match** - said `similar` or `different` when the truth is `exact`.
  Costs a scan its verdict, not its integrity.

A cheap-first gate is only defensible if agreement with the strong model is
very high *and* the disagreements fall on the missed-match side.

Results are not comparable across changes to the gate prompt, because the
script deliberately imports the shipped prompt from `src/lib/gate-prompt.ts`
rather than a frozen copy.
