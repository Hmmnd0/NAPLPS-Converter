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

## Phase 6 — Real Standard NAPLPS ✅ Complete

The encoder/decoder in earlier phases emit the app's own **TelidonP5 dialect**. This phase added a parallel **standard (real) NAPLPS** stack, validated against the 1993 DOS viewer TurShow under DOSBox-X.

- [x] `naplps-std-decoder.ts` — reads real `.nap` (interleaved coordinates, indexed 16-slot palette + period default colormap, polygons/lines/points, arcs → circles)
- [x] `naplps-std-encoder.ts` — exact inverse: period header, `SELECT`/`SET COLOR` palette, `SET & POLY FILLED` with absolute + relative deltas; round-trip is bit-exact on most fixtures
- [x] `naplpsToSvg.ts` — real `.nap` → SVG (auto-fit viewBox); powers the "Import NAPLPS (.nap → SVG)" panel
- [x] `naplpsRaster.ts` — low-res framebuffer renderer ported from TurShow's model (scanline fill + boundary pixels + seam-seal); the viewer's Standard mode
- [x] `svgToNaplpsStandard` — full PNG/SVG → real `.nap` pipeline ("Download standard .nap" buttons)
- [x] Validated in real TurShow (eagle / santa / MadMaze render faithfully)

---

## Phase 7 — Font Text & Text Placer ✅ Complete

- [x] `TEXT` / `FIELD` / SI font-text encoding in the standard encoder (crisp period letterforms, not traced glyphs)
- [x] **Text Placer** (`/text-placer`) — drag font-text blocks over a true-field raster preview; edit lines/position/size/color; export a real `.nap`
- [x] `rasterizeNaplps` gained a `fieldHeight` mode (absolute-field projection) so overlays register with the graphic

---

## Phase 8 — Cleanup & UI Modernization ✅ Complete

- [x] Removed the legacy "ASCII-Safe" encoder path: `NAPLPSEncoder`, `svgToNaplps`, its rect-only helpers, and the dead generators; `naplps.ts` is now types-only (commit `be3f9b5`)
- [x] Rewrote `README.md` for the current app, with a TurShow/DOSBox testing section (no binary redistributed)
- [x] Modern clean-light UI across all pages: a shared `AppHeader` nav, a consistent card/button design system in `globals.css`, and redesigned Converter / Text Placer / Viewer screens
- [x] Refactored the Authoring tool into a **NAPLPS Optimizer** (`/optimizer`): import a real `.nap` (std decoder), merge near-duplicate colors to the 16-slot palette (threshold slider), prune overdraw shapes, reorder the draw stack, live raster preview + before/after stats (shapes/colors/bytes), re-export real `.nap`. Removed the old `/author` canvas editor (a foxtoolbox-dialect consumer)

---

## Phase 9 — Standard-only (retire TelidonP5/foxtoolbox) ✅ Complete

The app is now single-format: real NAPLPS end to end.

- [x] Converter outputs **standard `.nap`** only (the hex preview + downloads come from `svgToNaplpsStandard`); dropped the "TelidonP5 dialect" download buttons
- [x] Viewer is **raster-only** (removed the TelidonP5 toggle, the `renderTelidon` path, and the `/telidon/` script loading)
- [x] Deleted `naplps-foxtoolbox.ts`, `naplps-decoder.ts` (+ its test), `public/telidon/*`, and the `test-rectangle/` dev page
- [x] Added **undo** + a **reference-image underlay** (aligned to the graphic's field footprint) to the Text Placer; matched the SvgAccuracyTest dropzone to the other upload boxes
- [x] Scrubbed README / ROADMAP / findings doc of the dialect

---

## Future Ideas

- **Weather frames** — fetch live data (e.g. NWS `api.weather.gov`) and compose NAPLPS weather pages (text + simple icons over a base map) — the canonical videotex application. Mostly reuses the standard encoder + font-text path; main new work is a layout/template module and a small icon set. (Open question: the degree symbol `°` needs G2-charset support — the TEXT path currently filters to ASCII.)

---

## Future Project — NAPLPS Vectorizer

A separate project that builds on this converter's encoder stack to produce period-accurate file sizes from raster images. Key additions:

- **Tesseract.js OCR** — detect text regions, emit NAPLPS 0x22 TEXT commands instead of rasterizing characters
- **Potrace (JS port)** — per-color region isolation → polygon outlines → `addPolygon()` calls
- **Text/graphics separation** — route detected text regions to OCR, non-text to Potrace
- Reuses the standard encoder (`naplps-std-encoder.ts`) and the raster viewer from this project

For Telidon-era content (bitmap fonts on solid backgrounds, simple vector graphics), this approach could match period file sizes of 350 B – 1.5 KB.

---

## Out of Scope (Do Not Touch)

The following are working correctly and should not be changed without a clear bug report:

- `naplps-std-encoder.ts` / `naplps-std-decoder.ts` — coordinate interleaving + indexed-palette logic, validated against real `.nap` fixtures and TurShow; only change with a failing fixture
- Color quantization (`pixelQuantize.ts`) — popularity-based: keeps a limited source palette **exactly** (≤16 colors → no loss), else bins near-identical colors and takes the most populous, preserving pure colors. Replaced the old median-cut averaging that muddied whites/brights. Covered by `pixelQuantize.test.ts`
