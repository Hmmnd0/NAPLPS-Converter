# Real NAPLPS Format — Findings from Decompiled Period Tools

Reverse-engineered from period DOS tools (Ghidra-decompiled to
`/Users/joe/NAPLPS Source files/decompiled/`), the JP RHINO decoder source
(`JP NAPLPS Source Files/rhsrv43a/PDISET.C`, clean C), and **real `.nap` files**
shipped with those tools (`MGE201A/*.NAP`, `NAPICO11/*.NAP`, `NAPWMF08/*.NAP`).

## TL;DR — the project is standard / real NAPLPS only

The codebase produces and reads **real NAPLPS** via `naplps-std-encoder.ts` +
`naplps-std-decoder.ts` (with `naplpsRaster.ts` and `naplpsToSvg.ts`) —
interleaved coordinates and an indexed 16-slot palette, **validated against real
`.nap` files and the 1993 DOS viewer TurShow**.

> **History:** the app originally shipped a non-standard **TelidonP5 "foxtoolbox"
> dialect** (`naplps-foxtoolbox.ts` + `naplps-decoder.ts` + a bundled TelidonP5.js
> viewer) — the only in-browser render path before real NAPLPS was reverse-
> engineered. It has since been **removed**; the notes below explain the
> divergences that motivated building the standard stack that replaced it.

1. **Coordinates.** Real NAPLPS *interleaves* X and Y bits inside every operand
   byte. The old foxtoolbox dialect wrote X as two whole bytes then Y as two whole
   bytes (separate). The standard encoder does the real interleaving.
2. **Color.** Real files use an indexed palette: define 16 slots once with
   `SET-COLOR` (0x3C), then pick a slot per shape with `SELECT-COLOR` (0x3E). The
   old dialect emitted a full RGB `SET-COLOR` before every shape and never used
   `SELECT-COLOR`. The standard encoder uses the indexed palette.

## Command-frequency survey (9 real files)

Counts of PDI opcodes actually used (graphics mode, SO/SI tracked):

| opcode | command | uses | we emit it? |
|---|---|---:|---|
| 0x3E | SELECT-COLOR | 231 | ❌ |
| 0x24 | PT-SET-ABS (move-to) | 214 | ❌ |
| 0x29 | LINE-REL | 192 | ❌ |
| 0x37 | SET&POLY-FILLED | 164 | ✅ |
| 0x26 | POINT-ABS | 55 | ❌ |
| 0x21 | DOMAIN | 36 | ✅ (header) |
| 0x38 | FIELD | 34 | ❌ |
| 0x3C | SET-COLOR | 32 | ✅ |
| 0x3D | WAIT | 29 | ❌ |
| 0x23 | TEXTURE | 20 | ❌ |
| 0x22 | TEXT | 14 | ❌ |
| 0x2B/0x25 | SET&LINE-REL / PT-SET-REL | 10/10 | ❌ |
| 0x2E/0x2F | ARC / ARC-FILLED | 6/7 | ❌ |
| 0x39 | INCR-POINT | 5 | ❌ |
| 0x31 | **RECT-FILLED** | **1** | ✅ (our *primary* primitive) |

**Takeaways:** real content is drawn with **move-to + relative lines** and
**polygons**, over an **indexed palette**. Filled rectangles — our main output —
appear once across all files. Arcs, text, incrementals and fields are all in use.

## Coordinate decode (the standard, from RHINO `getnum`)

`ONE = 8192` (13-bit fixed point; values > ONE are negative, i.e. `v -= 2*ONE`).
`DOMAIN` operand byte `c` (low 6 bits) sets the geometry:

```
dim = (c >> 5) & 1     # 0 = 2D
mvl = (c >> 2) & 7     # multi-value length: a coordinate is (mvl+1) bytes
svl = (c >> 0) & 3     # single-value length
```

Our header's DOMAIN byte is `0x4D` → `mvl=3` (4 bytes per coordinate), matching
the real files. For each operand byte `b` (low 6 bits), bits 5-3 are X, bits 2-0
are Y, most-significant first, 3 bits of each per byte:

```c
for (i = 0; i <= mvl; i++) {           // 2D
    x |= ((b[i] & 0x38) << 8) >> (i*3);
    y |= ((b[i] & 0x07) << 11) >> (i*3);
}
if (x > ONE) x -= ONE*2;               // sign
if (y > ONE) y -= ONE*2;
```

Operands are always `0x40-0x7F`; opcodes are `0x20-0x3F`. The stream is therefore
self-delimiting — collect operand bytes after an opcode until the next byte
< 0x40, then split into `(mvl+1)`-byte coordinates. Polygons/lines use an absolute
first vertex followed by relative deltas.

## Proof — decoding a real file

A POC decoder (`/tmp/nap_decode.py`, archived in git history of this change)
reads `EAGLE1.NAP` correctly:

```
0x20 RESET   0x21 DOMAIN(mvl=3)   0x3e SELECT-COLOR   0x3c SET-COLOR   0x23 TEXTURE
0x37 SET&POLY-FILLED ops=16  (0.031,0.750) ...   # 4 vertices
0x37 SET&POLY-FILLED ops=44  (0.215,0.701) ...   # 11 vertices
0x37 SET&POLY-FILLED ops=64  (0.236,0.649) ...   # 16 vertices
```

## Visible field & coordinate placement

NAPLPS works in a 0..1 unit square (Y up), but period viewers (TurShow) display
only the **4:3 area** up to **Y ≈ 0.75** — content above that is clipped off the
top. So when mapping a raster/SVG into the field, the converter fits the source,
preserving aspect, into a margined box `[m, fieldH-m]` (default `m=0.03`,
`fieldH=0.75`) and centers it (letterbox), rather than stretching to the full
square. This is why the Text Placer's preview is rendered at this 4:3 field and
why a reference image must be placed in the *same* letterboxed rectangle as the
`.nap` content (not stretched edge-to-edge) to align.

`naplpsRaster.ts` can project either the content bounding box (default viewer) or
the absolute field (`fieldHeight` option) — the latter keeps art at true field
coordinates so overlays (e.g. placed font text) register exactly.

## Status — standard stack implemented ✅

The recommendations below were built:

1. **Standard decoder** (`naplps-std-decoder.ts`) — reads real `.nap` →
   shapes via `getnum` interleaving + DOMAIN state + the indexed-palette model;
   tested against real sample files. `naplps-decoder.ts` is kept only for
   foxtoolbox-dialect round-trip tests.
2. **Standard encoder** (`naplps-std-encoder.ts`) — exact inverse: indexed
   palette (`SELECT-COLOR`/`SET-COLOR`), `SET&POLY-FILLED` with abs + relative
   deltas, plus `TEXT`/`FIELD` font text. Round-trip is bit-exact on most
   fixtures. Drives the Converter (its only output now), the Text Placer, and the
   Optimizer.
3. **Raster renderer** (`naplpsRaster.ts`) — ports TurShow's low-res framebuffer
   model (scanline fill + boundary pixels + seam-seal); the Viewer's renderer.

The TelidonP5 "foxtoolbox" dialect and its bundled viewer have been **removed** —
the app is now single-format (real NAPLPS) end to end.
