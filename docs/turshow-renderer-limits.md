# TURSHOW Renderer Limits — Empirical Findings

Findings from bisecting TURSHOW.EXE (Software @ Work, 1993) behavior with
synthetic `.nap` test files in DOSBox-X, July 2026. These limits explain every
"garbled in TURSHOW" symptom we hit, and both converter pipelines
(`regionTrace.ts` for PNG tracing, `svgToNaplps.ts` for SVG) now enforce them.

## 1. Scanline fill breaks past ~16 intersections per row

**The big one — root cause of all the garbling.**

TURSHOW fills polygons with an even-odd scanline algorithm that has a fixed
per-row intersection buffer. A polygon whose boundary crosses one horizontal
scanline more than ~16 times overflows it; the even-odd pairing shifts and the
fill inverts in places — gaps between thin strips get painted solid, and spans
that should be filled are left empty (they show as rectangular holes revealing
whatever was painted underneath).

Bisect: comb ("picket fence") polygons of constant vertex count with T vertical
teeth = 2·T crossings per scanline.

| Teeth | Crossings | Result |
|------:|----------:|--------|
| 8     | 16        | ✅ renders correctly |
| 12    | 24        | ❌ gaps between teeth fill solid |

Symptoms this caused: thin parallel hatch lines merging into one solid band,
grey rectangular dropouts where complex shapes should be, snaking thin lines
(creases) vanishing or blobbing.

**Enforcement:** both pipelines split any region/polygon that would exceed
**12 crossings** (6 runs per pixel row — comfortable margin) with a vertical
cut, recursively. Note the cut must be mask-based (rasterize + re-trace):
geometric line clipping (Sutherland–Hodgman) bridges disjoint lobes of
rings/combs and paints seams across whatever sits between them.

## 2. The final command of a file is silently dropped without a trailer

TURSHOW is a streaming decoder: a drawing command executes only when the *next*
non-operand byte arrives. A file that ends flush with the last operand byte
leaves the last command buffered forever — the final shape never draws.

Genuine period files end with `0F 1A` (SI "shift-in" + DOS EOF). Our encoder
now appends that trailer. Before the fix, **every file we ever exported lost
its last shape.**

Bisect evidence: in a test file of 8 columns, whichever column's polygon was
last in the byte stream vanished, regardless of its vertex count.

## 3. Vertex limit: 63 proven safe

Individually tested 57, 58, 59, 60, 61, 62, 63 vertices — all render.
The tracer caps at **60** traced vertices because the encoder may insert
midpoints on large relative jumps (wire vertices can exceed traced vertices).

Rectangles (4 vertices, 2 crossings) are immune to limits 1 and 3 entirely —
which is why the raster/rect route can never garble.

## 4. Painter's order must be by filled area, descending

Neither of our tracers emits polygons with holes; a ring traces as its outer
boundary and fills solid. The only way that renders correctly is back-to-front
by area: the hole-filled ring goes down early, and everything it encloses
(strictly smaller) paints over its interior, leaving only the true ring
visible. Sorting by anything else — pixel count, SVG element type, document
order — buries small detail (thin hatch rects, text fragments) under large
fills.

Corollary for split shapes: pieces of a split component must sort by the
**parent's** area, or a small piece of a huge region draws late and covers
detail that sits on top of it.

## 5. Display time is baud-paced: bytes = seconds

TURSHOW simulates modem throughput (~13,000 baud observed). Display time is
`bytes × 10 / 13288` seconds — a 12 KB file takes ~9 s, a 63 KB file ~48 s.
File size is the cost axis when choosing a conversion route; rendering
complexity is irrelevant.

## 6. Screen projection: ~0.31 screen px per coordinate step

NAPLPS coordinates (mvl=3) step at 1/2048 of the field; TURSHOW projects the
field onto 640×480 VGA, so one step ≈ 0.3125 screen px. Content converted with
margins lands on ~596 of the 640 columns, so a 636 px-wide source squeezes by
~6% — roughly 1 in 16 single-pixel rows/columns lands on a shared screen pixel
and thins out. This is display rounding, not data loss. The converters snap
1 source px to an integer number of coordinate steps so abutting shapes can
never round apart (background seams).

## 7. The DOMAIN logical pel is a pen size — and period files ship a fat one

The DOMAIN command carries a "logical pel" coordinate: the drawing pen size.
The period sample our header was copied from sets pel 32/8192 (~2.5 VGA px),
which inflates every line AND every polygon outline. Small nonzero pels are
worse: they route line drawing through the textured-line path and draw broken
strokes (see RHINO PDISET.C `linea()`: `tlstl == 0 || (pelx==0 && pely==0)`
guards the solid-line call). **Pel (0,0) = plain single-pixel solid lines**;
our encoder now emits that.

## 8. The line rasterizer drops the last pixel of each segment

Long straight lines look perfect (the missing endpoint is invisible), but a
curve built from 2-3px segments loses a pixel at every joint and renders
dashed/hollow — at any pel, chained or as separate commands. Consequences:

- LINE primitives are only safe for **long straight strokes** (hatching,
  rules). The converter uses 2-point lines for thin axis-aligned strips only.
- **Outlines and curved thin strokes must be filled polygons.** Scanline fill
  is always solid, and with pel 0 the fill's outline no longer inflates, so a
  1-2px filled stroke renders at true width.

## 9. Fills are edge-inclusive: every shape renders one pixel wider

Measured from raw DOSBox-X framebuffer captures (bypassing window scaling):
2px-wide strips render 3px, 1px strips render 2px — identically for
SET&RECT-FILLED and SET&POLY-FILLED (verified side by side; RECT is if
anything more uniform). TURSHOW fills the span [x0..x1] inclusive at both
edges, inflating every filled shape ~1px per axis.

Consequences:
- **Fine hatching bleeds in the vector route**: at 2px-strip/2px-gap pitch,
  the +1px inflation halves the gaps and adjacent strips touch at some
  positions. No encoding fixes this; it is the fill convention. Keep vector
  hatch pitch ≥ strip+2px, or use the raster route.
- **Raster row-run tiling cancels the inflation**: consecutive runs on a row
  overwrite their neighbour's inflated edge, so 1:1 raster conversions render
  at true width. This (not just resolution) is why the raster/hybrid route is
  the fidelity route for fine detail.
- Judge thin features from **raw captures** (DOSBox-X Capture menu →
  Screenshot, saved to ~/Library/Preferences/capture/) or a much-enlarged
  window — default-size macOS window scaling adds misleading moiré on 1-3px
  features.

## Route comparison (MadMaze end screen, 636×331)

| Route | Shapes | Size | TURSHOW time | Fidelity |
|-------|-------:|-----:|-------------:|----------|
| Clean no-text SVG (Illustrator) → `svgToNaplpsStandard` | 145 | 12 KB | ~9 s | near-perfect |
| PNG → polygon tracer (`/vectorizer` Polygon) | ~800 | 31 KB | ~24 s | very good |
| PNG → 1:1 raster rects (`/vectorizer` Raster at source width) | 3213 | 63 KB | ~48 s | pixel-exact data |

Crisp text on any route: don't trace it — add NAPLPS font TEXT on top via the
Text Placer.
