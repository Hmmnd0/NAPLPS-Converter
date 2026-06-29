# NAPLPS Conversion Pipeline — Technical Guide

## Overview

This project converts source images (PNG, SVG) into real period-compatible NAPLPS `.nap`
files for playback in TURSHOW, the 1993 DOS-era NAPLPS viewer, via DOSBox-X. The pipeline
spans five stages: raster quantization, SVG editing, polygon conversion, palette encoding,
and optional font-text placement.

```
PNG ──► [Quantizer] ──► pixel-art SVG
                              │
                    (optional: edit in Illustrator
                     to merge pixels into clean
                     vector polygons)
                              │
                              ▼
                        vector SVG ──► [svgToNaplps] ──► NAPLPS shapes
                                                               │
                                                     [Text Placer adds
                                                      TEXT/FIELD cmds]
                                                               │
                                                               ▼
                                                        .nap file ──► TURSHOW
                                                                       (DOSBox-X)
```

---

## Stage 1 — PNG → SVG (Color Quantization)

**Files:** `src/lib/pixelQuantize.ts`, `src/lib/pixelToSvg.worker.ts`

The source PNG is decoded into a pixel buffer and quantized to a limited palette using a
**popularity quantizer**:

1. Build a histogram of all unique RGB values in the image.
2. If the image already uses ≤ N distinct colors, keep every color exactly — zero loss.
3. Otherwise, bin colors into 16-unit-wide buckets per channel (`r >> 4`, `g >> 4`, `b >> 4`)
   and take the single most-popular exact color from each bucket as the representative.

This preserves "pure" colors (saturated primaries, clean grays) rather than averaging each
bucket as median-cut would. Adjacent pixel runs of the same quantized color become a single
`<rect>` element in the output SVG.

**Why color source matters:** The quantizer's output colors differ from an Illustrator
raster-trace of the same PNG. For the MadMaze scroll example:

| Source path | Brown value |
|---|---|
| Our quantizer | `rgb(160, 80, 0)` |
| Adobe Illustrator trace | `rgb(160, 72, 20)` |

Both are valid RGB values but produce different colors in NAPLPS. A `.nap` file generated
from a quantizer-output SVG will have the quantizer colors; one generated from an
Illustrator SVG will have Illustrator's traced colors. Mix the two and colors in the output
will be inconsistent. Stick to one source SVG throughout a project.

---

## Stage 2 — SVG Editing (Optional but Important)

A pixel-art SVG from Stage 1 contains hundreds of tiny `<rect>` elements — one per pixel
run. Converting this directly to NAPLPS produces hundreds of tiny filled polygons that
render poorly at TURSHOW's low resolution.

For clean, period-accurate output the SVG is **manually edited in a vector tool**
(e.g. Adobe Illustrator):

- Merge adjacent same-colored rects into large filled vector polygons.
- Trace outlines as clean polylines.
- Remove traced text (add it back via NAPLPS TEXT/FIELD in Stage 4 instead).

**Shape count impact:** A pixel-art SVG of the MadMaze scroll contains ~700 rect elements.
The manually-cleaned vector version produces ~66 NAPLPS shapes — matching the scale of
real period files.

**Layer/document order is the painter's order.** TURSHOW draws shapes in file byte-order,
later shapes overdrawing earlier ones (painter's algorithm). The SVG document order becomes
the NAPLPS byte order. Background fills must appear earlier in the SVG than foreground
detail outlines so they don't cover them.

---

## Stage 3 — SVG → NAPLPS Shapes (`svgToNaplps.ts`)

### Coordinate mapping

NAPLPS uses a unit square (X∈[0,1], Y∈[0,1]) with **Y pointing up** (origin at
bottom-left). SVG has Y pointing down (origin at top-left). The converter:

1. Reads each shape's SVG pixel coordinates.
2. Normalizes to the unit square: `nx = px / svgWidth`, `ny = py / svgHeight`.
3. Flips Y: `naplps_y = 1 − ny`.
4. Fits content into the TURSHOW-visible field with an isotropic letterbox:
   - `fieldHeight = 0.75` — TURSHOW clips content above Y≈0.75.
   - `margin = 0.03` — breathing room inside the field boundary.
   - Content is scaled to fit in `[margin, 1−margin] × [margin, fieldHeight−margin]`
     while preserving the source aspect ratio (letterboxing if necessary).

### Douglas-Peucker simplification

All polygon and path shapes are simplified with `DP_TOLERANCE = 0.5` (SVG coordinate
units). This is intentional, not conservative:

- Pixel-art staircase edges consist of 1-pixel diagonal steps.
- A 1px step produces a point at exactly 0.5px perpendicular distance from the
  chord — the strict `>` test drops it.
- TURSHOW renders at ~320×240. Staircase vertices at this resolution cause the
  even-odd scanline fill to invert, corrupting the polygon interior.
- Smoothing the staircase before encoding gives correct fills at low resolution.

### Despeckle

Shapes whose pixel-space bounding-box area falls below `minShapeArea` are dropped. This
removes 1×1 pixel artifacts that would become invisible NAPLPS `POINT-ABS` commands.

### Draw order

No automatic reordering is applied. The source SVG's element order is preserved as the
NAPLPS byte stream order. The SVG author controls which shapes draw first (background)
and which draw last (foreground detail).

**Sorting heuristics that were investigated and abandoned:**

- **Frequency sort** (most shapes first): fails for vector SVGs where outlines have more
  elements than background fills — puts outlines first and they get covered.
- **Area sort** (largest bounding box first): fails for pixel-art SVGs where all shapes
  are the same size — produces no meaningful ordering.
- **Coverage sort** (total bounding-box area per color): unreliable for thin outline shapes
  that have large bounding boxes but small actual fill area.

The correct answer is to control order in the source SVG.

---

## Stage 4 — NAPLPS Encoding (`naplps-std-encoder.ts`)

### Wire format

Real period NAPLPS with the standard header:

```
18 1b 22 46 1b 45 1f 40 40  — service preamble
0e                           — SO → graphics mode
20 7f 4f                     — RESET
21 4d 40 40 49 40            — DOMAIN: mvl=3, svl=1
23 40 40 52 40 40            — TEXTURE
```

Then palette definitions (`SELECT-COLOR` + `SET-COLOR` per slot), then shapes.

### Coordinate encoding (MVL=3)

Each coordinate occupies 4 bytes. `ONE = 8192` (13-bit fixed-point, values > ONE are
negative). For each operand byte `b` at position `i`:

```
x |= ((b & 0x38) >> 3) << (11 − 3i)    // bits 5-3 of b → X
y |= ((b & 0x07) << 11) >> (3i)          // bits 2-0 of b → Y
```

The Y formula is `(<< 11) >> (3i)`, not `<< (11 − 3i)`. These produce the same result
for i=0,1,2 but differ at i=3 (the LSB): the correct formula gives LSB=4 fixed-point
units; the wrong one would give LSB=8 — values that appear plausible but introduce a
systematic 2× error in low-order bits.

The encoder is the exact inverse of this. Large deltas (approaching ±ONE) are subdivided
into collinear steps — a full-width edge delta of −1.0 would wrap to +1.0 in the signed
encoding, sending a vertex to x=2.0 and corrupting the polygon.

### Palette

Colors are GRB-interleaved across 4 bytes, 2 bits per channel per byte, giving 8 bits of
precision per channel. The indexed palette holds up to 16 slots:

- Black (`rgb(0,0,0)`) is **always placed at slot 0**. TURSHOW uses slot 0 as the
  background color after RESET. Without this, the RESET background takes on the color
  of the most-frequent shape instead of black.
- Remaining slots are filled by frequency (most-used colors first).

### TEXT / FIELD encoding

Font text uses the authentic period mechanism rather than traced polygon glyphs:

```
SELECT-COLOR <slot>
TEXT  0x40  0x40  <charW coord>  <charH coord>
FIELD <position coord>  <extent coord>
APD (0x0a)
SI  (0x0f)   ← enter text mode
<literal ASCII>
CR APD       ← between lines
SO  (0x0e)   ← return to graphics mode
```

**Attribute bytes must be `0x40 0x40`.** The original code used `0x70 0x40`. Byte
`0x70` sets bits 4-5 to `11` in TURSHOW's text-direction register, selecting
"vertical bottom-to-top" character path — all text renders sideways. `0x40 0x40`
selects horizontal left-to-right with no rotation.

**FIELD extent Y is negative** (downward). `emitCoord(out, fieldW * ONE, -fieldH * ONE)`
— the negative Y signals that text flows down from the top of the field.

---

## Stage 5 — TURSHOW Rendering

TURSHOW is run via `tools/turshow/view.sh <file.nap>`, which copies the file into a clean
temp directory and launches DOSBox-X with the bundled `TURSHOW.EXE`.

**Painter's algorithm:** shapes draw in the byte-stream order. No depth sorting. Later
shapes overdraw earlier ones. Draw order is determined entirely by the source SVG
(Stage 2-3).

**Field clipping:** content with Y > 0.75 is clipped. The converter's `fieldHeight=0.75`
constant accounts for this.

**Resolution:** TURSHOW renders at VGA resolution. Thin shapes that are sub-pixel at low
resolution may not be visible.

**Font:** TURSHOW renders TEXT/FIELD commands with its own period bitmap font. The web
Viewer does not render text — TEXT commands are invisible in the browser Viewer tab. The
Text Placer shows a CSS monospace font overlay as a positional preview only; actual
character appearance will differ from TURSHOW's bitmap font.

---

## PRODIGY 8-Bit Protocol Encoding

PRODIGY-sourced `.nap` files (ad frames, service frames) use a distinct encoding:

| Property | Our encoder | PRODIGY files |
|---|---|---|
| Protocol byte high bit | Clear (7-bit) | **Set** — opcodes at 0xA0–0xBF, operands at 0xC0–0xFF |
| Text bytes | N/A | Plain 7-bit ASCII (no high bit) |
| DOMAIN (MVL, SVL) | MVL=3, SVL=1 | **MVL=2, SVL=0** |
| Bytes per coordinate | 4 | **3** |
| Bits per color channel | 8 | **6** |
| Service preamble | Present | **Absent** |

The high bit is the protocol/text delimiter: `1` = NAPLPS structural byte, `0` = literal
text inside a TEXT run. TURSHOW detects this mode and strips bit 7 unconditionally
(`byte & 0x7f`).

Our decoder pre-normalizes these files with `normalizeIfEightBit()`: it scans the first
64 bytes for an opcode in the 0xA0–0xBF range and, if found, strips bit 7 from all
protocol bytes before passing the stream to the standard 7-bit decoder. See
`docs/prodigy-naplps-format.md` for full analysis.

---

## Web Viewer vs TURSHOW

The browser Viewer (`naplpsRaster.ts`) approximates TURSHOW's rendering model:

| Aspect | TURSHOW | Web Viewer |
|---|---|---|
| Fill algorithm | Even-odd scanline | Even-odd scanline |
| Boundary pixels | Set in fill color (closes edge seams) | Same |
| Sub-pixel seams | Merged at low framebuffer resolution | Seam-seal pass (2 iterations) |
| Text | Period bitmap font | **Not rendered** |
| Resolution | Fixed VGA (~320×240) | `max(userSetting, 512)px` internal |
| Display size | Fixed | CSS-scaled from internal render |

The viewer renders at a minimum of 512px internally regardless of the display-size slider,
to prevent thin shapes from disappearing at sub-pixel widths. Actual display size is
controlled by CSS scaling.

---

## Tools Reference

| Tool | Location | Purpose |
|---|---|---|
| Converter | `/` (main page) | PNG → pixel-art SVG → NAPLPS |
| Text Placer | `/text-placer` | Upload SVG + position font-text blocks → NAPLPS |
| Viewer | `/naplps-viewer` | Render `.nap` in browser |
| Optimizer | `/optimizer` | Reduce SVG complexity pre-conversion |
| Vectorizer | `/vectorizer` | PNG → NAPLPS direct (raster or polygon mode) |
| TURSHOW launcher | `tools/turshow/view.sh` | Period viewer under DOSBox-X |
| Desktop editor | `nap-editor/` | Electron app for NAPLPS editing |

---

## Test Fixtures

| File | Description |
|---|---|
| `test-fixtures/nap/eagle1.nap` | Period eagle — primary encoder round-trip fixture |
| `test-fixtures/nap/santa.nap` | Period Santa graphic |
| `test-fixtures/nap/amerwest.nap` | Period airline graphic, multi-palette |
| `test-fixtures/nap/memra3.nap` | Period file with TEXT/FIELD — used to validate text encoding |

---

## Related Documents

- `docs/naplps-format-findings.md` — opcode survey, coordinate decode math, decoder/encoder status
- `docs/prodigy-naplps-format.md` — PRODIGY 8-bit protocol encoding, ad file format analysis
