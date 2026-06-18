# Real NAPLPS Format — Findings from Decompiled Period Tools

Reverse-engineered from period DOS tools (Ghidra-decompiled to
`/Users/joe/NAPLPS Source files/decompiled/`), the JP RHINO decoder source
(`JP NAPLPS Source Files/rhsrv43a/PDISET.C`, clean C), and **real `.nap` files**
shipped with those tools (`MGE201A/*.NAP`, `NAPICO11/*.NAP`, `NAPWMF08/*.NAP`).

## TL;DR — our converter emits a non-standard dialect

Our encoder (`naplps-foxtoolbox.ts`) was reverse-engineered from TelidonP5.js. It
works **with that one viewer**, but it does **not** match the NAPLPS standard that
real period files and decoders use. Two concrete divergences:

1. **Coordinates.** Real NAPLPS *interleaves* X and Y bits inside every operand
   byte. We write X as two whole bytes then Y as two whole bytes (separate).
2. **Color.** Real files use an indexed palette: define 16 slots once with
   `SET-COLOR` (0x3C), then pick a slot per shape with `SELECT-COLOR` (0x3E). We
   emit a full RGB `SET-COLOR` before every shape and never use `SELECT-COLOR`.

Consequence: our in-repo decoder (`naplps-decoder.ts`) only knows 4 opcodes and
**cannot read any real `.nap` file**.

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

## Recommendations for the converter

1. **New standard decoder** (`naplps-std-decoder.ts`): read real `.nap` files →
   shapes, using `getnum` interleaving + DOMAIN state + the palette model. Test
   against the real sample files. Highest value — gives the project genuine
   interoperability with period content. Keep the existing `naplps-decoder.ts`
   (it decodes our own TelidonP5-dialect output for round-trip tests).
2. **Encoder roadmap, reprioritized by real usage:** lines (`PT-SET-ABS` +
   `LINE-REL`) and the indexed palette (`SELECT-COLOR`) matter far more than the
   filled-rect path we built. Arcs/text are secondary.
3. **Do NOT change `naplps-foxtoolbox.ts`** to "fix" the coordinate format — it is
   matched to the TelidonP5 viewer that the app ships and relies on. A
   standard-compliant encoder, if wanted, should be a separate module.
