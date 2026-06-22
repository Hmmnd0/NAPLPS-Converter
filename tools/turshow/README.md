# TURSHOW — view real `.nap` files on a period viewer

These launcher scripts run **TURSHOW**, a 1993 MS-DOS NAPLPS viewer, so you can
verify that the `.nap` files this project produces render correctly on real
period-correct software (not just the in-browser raster preview).

TURSHOW is 16-bit DOS software, so it runs under the **DOSBox-X** emulator.

> **TURSHOW** is © 1993 Shawn Rhoads / Software @ Work, included here for archival
> and interoperability testing. **DOSBox-X is not bundled** — install it yourself
> (see below).

## What's here

| File | What it is |
| --- | --- |
| `TURSHOW.EXE` | The 1993 DOS NAPLPS renderer (Turbo Pascal + Borland BGI) |
| `TURSHOW.DOC` | The original author's documentation |
| `FILE_ID.DIZ` | The original BBS description file |
| `view.sh` | macOS / Linux launcher |
| `view.bat` | Windows launcher |

## Install DOSBox-X (one time)

DOSBox-X is **not** bundled — it's a large, platform-specific binary. Install it
with your package manager:

```sh
# macOS
brew install dosbox-x

# Linux (Debian/Ubuntu; use your distro's package otherwise)
sudo apt install dosbox-x

# Windows
winget install dosbox-x        # or download from https://dosbox-x.com
```

## Render a `.nap`

```sh
# macOS / Linux
./tools/turshow/view.sh path/to/your.nap

# Windows
tools\turshow\view.bat path\to\your.nap
```

A DOSBox-X window opens and displays the image in VGA mode. Close the window to
exit. The launchers copy your file to a clean, space-free temp directory under
the DOS 8.3 name `VIEW.NAP` before mounting it, so any source filename works.

## Notes / gotchas

- **8.3 filenames:** DOS truncates long names. The launchers sidestep this by
  staging your file as `VIEW.NAP`; if you invoke `TURSHOW` by hand, keep the
  name ≤ 8 characters plus `.NAP`.
- **No spaces in the mount path:** `mount c "<path with spaces>"` fails in DOS.
  The launchers mount a temp directory to avoid this.
- **VGA:** the `-vga` flag selects the 640×480 4:3 display mode TURSHOW renders
  into. See the `TURSHOW.DOC` that ships with your copy for other display options.
