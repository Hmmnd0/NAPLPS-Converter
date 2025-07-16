# NAPLPS Polygon Breakthrough (TelidonP5.js)

## Summary

After extensive debugging and analysis, we successfully displayed a filled rectangle (polygon) in the TelidonP5.js viewer by matching the exact bit-level encoding and command structure expected by the viewer and the NAPLPS/Telidon spec.

---

## Key Findings

- **TelidonP5.js expects polygons (not rectangles) to be encoded as `Set & Poly Filled` (`0x37`) commands,** with coordinates packed as 12-bit values, split into 6-bit nibbles, and each nibble offset by `0x40` (ASCII '@').
- **Header, color, and end-of-file sequence must match working files.**
- **Rectangle/shape must be encoded as a polygon, not as a rectangle primitive.**
- **Text test files work because their structure is simple and matches the viewer's expectations.**

---

## Minimal Working Example

### Header (from working files):
```
0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
```

### Set Color (Yellow):
```
0x3C, 0x59
```

### Set & Poly Filled Command:
```
0x37
```

### Rectangle Points (from TelidonJS bit test, 9-bit, packed as 12-bit):
- (160, 120)
- (480, 120)
- (480, 360)
- (160, 360)

Each coordinate is packed as:
- High 6 bits: `(value >> 6) & 0x3F`, offset by 0x40
- Low 6 bits: `value & 0x3F`, offset by 0x40

### End of File:
```
0x0F
```

---

## Why Previous Attempts Failed
- Using rectangle primitives (`0x31`) or ASCII coordinate encoding did **not** work for filled shapes in TelidonP5.js.
- The viewer expects polygons with packed coordinates and the correct opcode.
- Even a single byte difference in the header or command sequence can cause a blank screen.

---

## Next Steps

1. **Automate Polygon Packing for Any Shape:**
   - Generalize the packing logic for any array of points.
2. **Integrate Color Selection:**
   - Allow user or code to pick any Telidon color.
3. **Automate Image-to-Polygon Conversion:**
   - Convert PNG/SVG images into polygons and pack them.
4. **Batch/Multiple Polygon Support:**
   - Support multiple polygons/colors per file.
5. **UI Improvements:**
   - Add color pickers, shape upload, and preview features.

---

## Reference: TelidonJS Bit Test

The breakthrough was based on matching the bit-level structure used in the TelidonJS bit test, which uses 9-bit binary coordinates packed into 12-bit NAPLPS coordinates.

---

**Congratulations! You can now generate NAPLPS files with visible polygons in TelidonP5.js.** 