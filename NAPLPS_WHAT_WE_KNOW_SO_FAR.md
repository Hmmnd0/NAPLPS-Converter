# NAPLPS: What We Know So Far

## 1. Header Structure
- The NAPLPS file must start with a specific header sequence, matching known-good files and the TelidonP5.js viewer’s expectations.
- Example header (from working files):
  ```
  0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
  0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ```

## 2. Color Encoding
- Colors are set using the `SET_COLOR` command (`0x3C`) followed by a single color byte.
- The color byte is an ASCII-safe value (e.g., `0x52` for red, `0x59` for yellow) matching the Telidon palette.
- The color must be set before drawing commands.

## 3. Polygon Packing (for Filled Shapes)
- **Filled shapes must be encoded as polygons using the `Set & Poly Filled` command (`0x37`).**
- Each point is packed as two 12-bit coordinates (x, y), split into 6-bit nibbles, each offset by `0x40` (ASCII '@').
- Example for a rectangle:
  - Four points: (x0, y0), (x1, y0), (x1, y1), (x0, y1)
  - Each coordinate: high 6 bits, low 6 bits, both offset by 0x40

## 4. End of File
- The file should end with `SI` (`0x0F`) to switch back to text mode, which signals the end of graphics to the viewer.

## 5. Why Previous Attempts Failed
- Using rectangle primitives (`0x31`) or ASCII coordinate encoding did **not** work for filled shapes in TelidonP5.js.
- The viewer expects polygons with packed coordinates and the correct opcode.
- Even a single byte difference in the header or command sequence can cause a blank screen.
- Text test files work because their structure is simple and matches the viewer's expectations.

## 6. Best Practices
- **Always use a known-good header and command sequence as a template.**
- **Pack all polygon coordinates as 12-bit values, split into 6-bit nibbles, offset by 0x40.**
- **Set the color before each shape.**
- **End with `SI` (`0x0F`).**
- **Test each change by comparing the output byte-for-byte with a working file.**

## 7. Reference: TelidonJS Bit Test
- The breakthrough came from matching the bit-level structure used in the TelidonJS bit test, which uses 9-bit binary coordinates packed into 12-bit NAPLPS coordinates.

---

**With this knowledge, we can now reliably generate NAPLPS files with visible polygons in TelidonP5.js, and are ready to automate and expand the pipeline.** 