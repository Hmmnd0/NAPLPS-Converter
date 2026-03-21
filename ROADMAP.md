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

## Phase 3 — SVG Shape Support (Careful)

Extends the SVG parser to handle more than just `<rect>` elements. New code paths added alongside existing rect handling — existing conversion pipeline unchanged.

- [x] Support `<polygon>` and `<polyline>` elements → encode as `SET & POLY FILLED (0x37)`
- [ ] Support `<line>` elements → encode as `SET & LINE ABS (0x2A)`
- [x] Support `<circle>` / `<ellipse>` elements → approximate as polygon with N sides
- [ ] Support `<path>` elements (basic straight-line paths, not curves) → parse `M`, `L`, `Z` commands
- [ ] Support `<g>` groups with `transform="translate(...)"` — apply offset to child elements
- [ ] Respect `stroke` attribute in addition to `fill`

---

## Phase 4 — Performance (Lower Priority)

- [ ] Move PNG vectorization (`pixelToSvg.ts`) to a Web Worker to fully unblock the UI during large image processing
- [x] Rectangle merging at SVG generation stage (horizontal run-length encoding in `pixelToSvg.ts`; `parseSvgToPixels` updated to read rect dimensions directly)

---

## Out of Scope (Do Not Touch)

The following are working correctly and should not be changed without a clear bug report:

- `naplps-foxtoolbox.ts` — 4-byte GRBGRB color encoding, 12-bit coordinate packing, SET & POLY FILLED (0x37) for rectangles
- `public/telidon/TelidonP5.js` — decoder and renderer (third-party, patched once for color propagation bug)
- Color quantization in `pixelToSvg.ts` — fragile but working; only change if a specific image reproduces a color problem
