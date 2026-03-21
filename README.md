# NAPLPS Converter

A Next.js web application for converting images to **NAPLPS** (North American Presentation Layer Protocol Syntax) — the vector graphics format used by Telidon, Prodigy, and other 1980s videotex systems.

Live viewer powered by [TelidonP5.js](https://github.com/groundh0g/TelidonP5.js).

---

## Features

- **PNG → SVG → NAPLPS** — Upload a PNG/JPEG/GIF, vectorize it pixel-perfectly, then convert to a `.nap` file
- **SVG → NAPLPS (direct)** — Upload any `.svg` directly and convert without going through a PNG
- **NAPLPS Viewer** — In-browser viewer that renders `.nap` files using TelidonP5.js and p5.js
- **Test file generators** — One-click download of test `.nap` files (rectangle, polygon, text, hybrid)
- **Download** — Export as binary `.nap` or hex `.txt`

---

## What is NAPLPS?

NAPLPS (ANSI X3.110-1983 / CSA T500-1983) is a binary graphics protocol developed in the early 1980s for transmitting vector graphics over low-bandwidth links. It was used by:

- **Telidon** — Canada's videotex system, the direct ancestor of NAPLPS
- **Prodigy** — One of the first major US online services (1988–2001)
- **Cable television** — Interactive program guides and info graphics

Key encoding properties:
- Opcode bytes `0x20–0x3F` (bit 6 = 0); data bytes `0x40–0x7F` (bit 6 = 1)
- 12-bit coordinates per axis, packed as two 6-bit nibbles each offset by `0x40`
- Color via `SET COLOR (0x3C)`: 4-byte GRBGRB interleaved bit-packing (2 bits/channel/byte)
- Shapes drawn as polygons using `SET & POLY FILLED (0x37)`

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/Hmmnd0/NextJSNAPLPSProject.git
cd NextJSNAPLPSProject
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build for production

```bash
npm run build
npm start
```

---

## Usage

### PNG → NAPLPS
1. Drag and drop (or click to select) a PNG, JPEG, or GIF on the main page
2. The image is vectorized into an SVG — download the SVG if you want it
3. Click **Convert SVG to NAPLPS** to encode
4. Download the `.nap` binary file

### SVG → NAPLPS (direct)
1. Scroll to the **SVG → NAPLPS (Direct Upload)** section
2. Upload any `.svg` file — the SVG's `viewBox` or `width`/`height` is used for scaling
3. Click **Convert to NAPLPS** and download the result

### NAPLPS Viewer
- Click **Open NAPLPS Viewer** (top right) or navigate to `/naplps-viewer`
- Upload any `.nap` file to render it in the browser

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                # Main converter page
│   ├── naplps-viewer/
│   │   └── page.tsx            # NAPLPS viewer page
│   └── layout.tsx
├── components/
│   ├── FileUpload.tsx           # Drag-and-drop PNG upload
│   └── SvgAccuracyTest.tsx
└── lib/
    ├── naplps-foxtoolbox.ts    # Main encoder (SVG → NAPLPS)
    ├── naplps-spec.ts          # Test file generators
    ├── naplps.ts               # Legacy encoder + utilities
    ├── svgToNaplps.ts          # SVG parsing and conversion pipeline
    └── pixelToSvg.ts           # PNG → SVG vectorizer

public/telidon/
    ├── naplps.js               # NAPLPS binary decoder (NapDecoder)
    └── TelidonP5.js            # p5.js renderer (TelidonDraw)

docs/
    ├── NAP.txt                 # NAPLPS spec (Michael Dillon, 1993)
    ├── Displaying-NAPLPS-graphics-rev1.pdf
    └── NAPLPS Standard_compressed_compressed.pdf
```

---

## Technical Notes

### Encoding (naplps-foxtoolbox.ts)
- **Header**: `CANCEL ESC E NSR SO RESET DOMAIN` — sets 4-byte coordinate mode (`0x4D`)
- **Color**: `SET COLOR (0x3C)` + 4 data bytes in GRBGRB format
- **Shapes**: Each rectangle encoded as `SET & POLY FILLED (0x37)` with 4 corner points
- **Coordinates**: 12-bit per axis → `[0x40 + hi6, 0x40 + lo6]`

### Decoding (naplps.js + TelidonP5.js)
- `parseCommands` splits the byte stream at opcode boundaries
- `setColor` accumulates 2 bits/channel/byte across 4 bytes → 8-bit RGB
- `SET & POLY FILLED` uses a dedicated 12-bit coord path (`decodeCoord`)
- Coordinates are normalized to canvas space as `rawValue / 4095`

---

## Technologies

- **Next.js 15** with App Router
- **TypeScript**
- **Tailwind CSS**
- **p5.js** — canvas rendering in the viewer
- **TelidonP5.js** — NAPLPS decoder and renderer

---

## References

- ANSI X3.110-1983 / CSA T500-1983 — NAPLPS standard
- [NAP.txt](docs/NAP.txt) — Practical NAPLPS reference (Michael Dillon, 1993)
- [TelidonP5.js](https://github.com/groundh0g/TelidonP5.js) — Browser-based Telidon renderer
