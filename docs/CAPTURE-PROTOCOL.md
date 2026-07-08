# Neumeric — Drone Ground-Truth Capture Protocol (v1.0)

**Purpose.** This is the field procedure that turns a farmer's drone flight +
a human's on-the-ground assessment into a **calibration-grade labeled
example** — the one asset that unblocks a real supervised damage model
(docs/ENGINES.md §2b). Every capture run through this protocol becomes a row
in the Track B training export, and the loop is only *closed* when the
eventual adjuster settlement and final harvested yield are attached.

Nothing here is validated ML yet. The point of the protocol is rigor at
collection time, because you cannot fix a badly-captured label later.

---

## 1. When to fly

- **Timing vs. the loss event:** fly **within 72 hours** of discovering the
  damage, before harvest or destruction, and — for insurance — after the
  Notice of Loss is filed (the 72-hour rule; see the deadline tracker). Record
  the exact event date and discovery date.
- **Avoid:** flying into a second weather event (fresh damage confounds the
  label), or after regrowth has masked the original loss (hail canopy can
  partially recover in 1–2 weeks — capture the condition at its worst).

## 2. Flight parameters (what makes the orthomosaic usable)

| Parameter | Spec | Why |
|---|---|---|
| **Ground sample distance (GSD)** | ≤ 2 cm/px | The whole point of the drone tier is sub-10 m detail; log the actual GSD. |
| **Altitude** | Consistent AGL (typically 60–120 m depending on camera) | Constant GSD across the field; note it. |
| **Forward/side overlap** | ≥ 75% / ≥ 65% | Clean orthomosaic stitching; low overlap → geometry errors that corrupt affected-area geometry. |
| **Sun / weather** | Diffuse or consistent light; avoid low sun angle and wind > ~15 mph | Shadows and motion blur read as false "damage" in index math. |
| **Ground control** | RTK/PPK if available, else ≥ 4 GCPs or note "camera-GPS only" | Georeferencing quality bounds how honestly acreage can be claimed. |
| **Bands** | RGB minimum; RGB+NIR (NDVI) strongly preferred | ExG works on RGB; NDVI is more robust to soil/senescence — flag which you have. |
| **Export** | Georeferenced GeoTIFF orthomosaic (WGS84 or UTM), from DroneDeploy / Pix4D / WebODM | Ungeoreferenced photos cannot back an acreage claim; they go in the phone path. |

## 3. Human ground truth to collect (the label)

Collected in the app's capture session, at the field, alongside the flight:

- **Damage type** (hail / flood / wind / drought / disease / pest / other) and
  a one-line cause narrative.
- **Estimated % loss per zone.** Walk the field; for each visually-distinct
  zone, record an honest human estimate of % stand/yield loss and rough
  acreage. This is a *human* estimate — labeled as such — and is the interim
  target until the objective outcomes below arrive.
- **Ground photos:** ≥ 4 geotagged phone shots (whole-field context, mid-field,
  a close-up of representative damage, and the single worst spot).
- **Conditions:** growth stage, days since event, any regrowth observed.

## 4. Objective outcomes — the labels that actually matter (attach later)

These convert a human-estimate example into ground truth. The app makes each
trivially attachable to the same capture session when it becomes available:

1. **Adjuster settlement** — the % loss / indemnity the insurer's adjuster
   determined (with date and adjuster/AIP identity). The nearest thing to an
   agreed objective number.
2. **Actual harvested yield** (bu/ac) for the field/zone — the hardest ground
   truth of all; attach from scale tickets / yield-monitor data at harvest.

A capture is **calibration-grade** only once at least one objective outcome
(adjuster settlement or harvested yield) is attached. Human-estimate-only
captures are retained but flagged lower-weight in the training export.

## 5. Data integrity

- The orthomosaic is stored content-addressed (sha256 = storage key) and
  committed to the provenance chain; the label record links to that exact hash.
- Everything is versioned: capture protocol version, drone methodology
  version, and (once attached) the outcome source.
- **Never** back-fill or "clean" a human estimate after seeing a model output
  — that would poison the calibration set. Estimates are frozen at capture.

## 6. Where this feeds

`ground_truth_labels` + the drone FCR → the tier-aware training export
(`scripts/export-training.ts`). At ~150 calibration-grade labeled events per
damage type (docs/ENGINES.md §2b), the sim-trained prior (§B2) can be
fine-tuned and a conformal calibrator fit — at which point the fusion engine's
fixed abstention rules (docs/ENGINES.md §fusion) can begin to be replaced by
learned, validated confidence. Not before.
