# NAPLPS Converter — Roadmap

Items below are ordered roughly by impact. The "Safe Cleanups" phase is complete.

---

## Phase 1 — Safe Cleanups ✅ Complete

- [x] Extract `downloadBinary` / `downloadText` helpers in `page.tsx` (replaced 7+ duplicate blob/URL patterns)
- [x] Remove debug `console.log` statements across all source files
- [x] Cap viewer retry loop at 25 attempts (~5 seconds) with timeout error
- [x] Remove dead code from `naplps.ts` (4 static test methods, 3 unused instance methods, 4 dead exports)
- [x] Remove dead code from `naplps-spec.ts` (duplicate generator, unused minimal generators, unused outlined rect pair)
- [x] Remove dead `generateMinimalNaplps()` from `svgToNaplps.ts`
- [x] Delete `page.tsx.backup`
- [x] Add `*.nap` / `naplps_output.*` to `.gitignore`

---

## Phase 2 — Error Handling & Robustness ✅ Complete

- [x] Show a user-facing error if the uploaded SVG is malformed (DOMParser parse error currently silent)
- [x] Show a warning if the SVG has no `<rect>` elements and would produce an empty `.nap`
- [x] Validate that image dimensions are > 0 before starting vectorization
- [x] Add file size warning before processing very large images (currently silently capped at 1M pixels)
- [x] Guard against empty hex string before binary download (currently shows a generic alert)

---

## Phase 3 — SVG Shape Support ✅ Complete (for PNG→NAP use case)

The PNG→SVG pipeline only produces `<rect>` elements. All other shape types (`<line>`, `<path>`, `<g transform>`, `stroke`) are only relevant if uploading hand-authored SVGs — not useful for the core PNG→NAP workflow.

- [x] Support `<polygon>` and `<polyline>` elements → encode as `SET & POLY FILLED (0x37)`
- [x] Support `<circle>` / `<ellipse>` elements → approximate as polygon with N sides
- [x] Support `<path>` elements (M/L/H/V/Z, straight lines) → axis-aligned 4-pt subpaths become rects, others become polygons; collinear-point (Douglas–Peucker) simplification
- [x] Support `<path>` curves (C/S/Q/T/A) → Bézier/arc flattening into oversampled polylines, then DP-simplified; verified rendering in TelidonP5 (heart via cubics, circle via arcs)
- [x] Fill resolution: inline `fill`, inline `style`, CSS-class `<style>` blocks (Illustrator `.stN`), and `<g>` ancestor inheritance
- [~] `<line>`, `<g transform>` coordinate offset, `stroke` — deferred (TEXT 0x22 / LINE 0x2A are the remaining new encoder primitives)

---

## Phase 4 — Performance (Lower Priority)

- [ ] Move PNG vectorization (`pixelToSvg.ts`) to a Web Worker to fully unblock the UI during large image processing
- [x] Rectangle merging at SVG generation stage (horizontal run-length encoding in `pixelToSvg.ts`; `parseSvgToPixels` updated to read rect dimensions directly)
- [x] Switch rect encoding from 0x37 SET & POLY FILLED (4 points, 17 bytes) to 0x31 RECT FILLED (2 points, 9 bytes) — ~47% file size reduction (55 KB → 28 KB on test image)
- [x] 2D rectangle merging in `optimizeRectangles()` (vertical then horizontal pass)
- [x] Sort rects by color + deduplicate `setColor` calls — eliminates redundant color commands
- [x] `optimizeRectangles()` now iterates merge passes until no further reduction (a horizontal merge can unlock a new vertical one)

---

## Phase 5 — Testing & Maintenance ✅ Complete

- [x] Vitest test suite (`src/lib/svgToNaplps.test.ts`, jsdom env) — 26 tests covering the pure conversion logic: path tokenizer, color parsing, axis-aligned rect detection, Douglas–Peucker simplification, iterative rectangle merging, `<path>` → rect/polygon parsing, and SVG fill resolution (inline / style / CSS class / `<g>` inheritance). Run with `npm test`.
- [x] Removed dead code: `imageProcessor.ts`, `naplps-spec.ts`, `svgVectorizer.ts`, `imagetracerjs.d.ts` (~690 unimported lines), the unused author-tool `colorSelect()` helper, the unused `NAPLPSViewer.tsx` component, and 3 unused `generate*` helpers in `naplps-foxtoolbox.ts`.
- [x] Dropped unused dependencies: `imagetracerjs`, `jimp`, `@types/jimp`.
- [x] Disabled the `DEBUG_SVG_NAPLPS` console-logging flag (was left on) and fixed outstanding lint errors.
- [x] Parse each SVG once per conversion (`parseSvgDocument`) instead of 5×; share the Document + CSS-fill map across all extractors.
- [x] In-repo NAPLPS decoder (`naplps-decoder.ts`) — inverse of the foxtoolbox encoder; powers encode→decode→compare round-trip tests and `.nap` inspection.
- [x] Deduplicated `NAPLPSPoint`/`NAPLPSColor` to a single definition in `naplps.ts`.
- [x] `getConversionStats` now counts all emitted shapes (path rects, polygons, circles), not just native `<rect>`.
- [x] Dev-gated the `SvgAccuracyTest` diagnostic panel out of production builds.
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): typecheck + lint + test + build on push/PR.

---

## Future Project — NAPLPS Vectorizer

A separate project that builds on this converter's encoder stack to produce period-accurate file sizes from raster images. Key additions:

- **Tesseract.js OCR** — detect text regions, emit NAPLPS 0x22 TEXT commands instead of rasterizing characters
- **Potrace (JS port)** — per-color region isolation → polygon outlines → `addPolygon()` calls
- **Text/graphics separation** — route detected text regions to OCR, non-text to Potrace
- Reuses `naplps-foxtoolbox.ts`, `addPolygon()`, and the viewer stack from this project unchanged

For Telidon-era content (bitmap fonts on solid backgrounds, simple vector graphics), this approach could match period file sizes of 350 B – 1.5 KB.

---

## Out of Scope (Do Not Touch)

The following are working correctly and should not be changed without a clear bug report:

- `naplps-foxtoolbox.ts` — 4-byte GRBGRB color encoding, 12-bit coordinate packing, SET & POLY FILLED (0x37) for rectangles
- `public/telidon/TelidonP5.js` — decoder and renderer (third-party, patched once for color propagation bug)
- Color quantization in `pixelToSvg.ts` — fragile but working; only change if a specific image reproduces a color problem
