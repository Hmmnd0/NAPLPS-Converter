import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Canvas, { type CanvasHandle } from './components/Canvas'
import ColorPanel from './components/ColorPanel'
import NapColorPicker from './components/NapColorPicker'
import { decodeNaplpsStandard } from '@lib/naplps-std-decoder'
import { encodeNaplpsStandard, type NapText } from '@lib/naplps-std-encoder'
import { dpSimplify } from '@lib/regionTrace'
import { lintShapes, splitPolygonForHardware, snapToVgaColor } from '@lib/turshowSim'
import { mergeShapesExact } from './lib/mergeExact'
import type { NapShape } from '@lib/naplps-std-decoder'

export type Tool = 'select' | 'line' | 'rect' | 'poly' | 'circle' | 'text'

function fmtBytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

const MAX_HISTORY = 50

export default function App() {
  const [shapes, setShapes] = useState<NapShape[]>([])
  const [history, setHistory] = useState<NapShape[][]>([])
  const [future, setFuture] = useState<NapShape[][]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [tool, setTool] = useState<Tool>('select')
  const [preview, setPreview] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [grid, setGrid] = useState(false)
  const [snap, setSnap] = useState(false)
  const [drawColor, setDrawColor] = useState('#ff4040')
  // Reference image traced beneath the artwork. Editor-only aid — never saved to the .nap file.
  const [underlayImage, setUnderlayImage] = useState<string | null>(null)
  const [underlayOpacity, setUnderlayOpacity] = useState(0.5)
  const [underlayVisible, setUnderlayVisible] = useState(true)
  // NAPLPS font-text blocks (encoded as TEXT/FIELD commands on save; the
  // viewer supplies the letterforms). Authored fresh — the decoder does not
  // yet reconstruct TEXT blocks from existing files.
  const [texts, setTexts] = useState<NapText[]>([])
  const [selectedText, setSelectedText] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('Untitled')
  const [dirty, setDirty] = useState(false)
  // editor body is shown once a file is opened OR a blank canvas is started
  const [started, setStarted] = useState(false)
  const canvasHandle = useRef<CanvasHandle | null>(null)

  const pushHistory = useCallback((prev: NapShape[]) => {
    setHistory(h => [...h.slice(-MAX_HISTORY + 1), prev])
    setFuture([])
    setDirty(true)
  }, [])

  const mutate = useCallback((next: NapShape[]) => {
    setShapes(prev => { pushHistory(prev); return next })
    setSelectedIds(new Set())
  }, [pushHistory])

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h
      const prev = h[h.length - 1]
      setFuture(f => [shapes, ...f.slice(0, MAX_HISTORY - 1)])
      setShapes(prev)
      setSelectedIds(new Set())
      return h.slice(0, -1)
    })
  }, [shapes])

  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f
      const next = f[0]
      setHistory(h => [...h.slice(-MAX_HISTORY + 1), shapes])
      setShapes(next)
      setSelectedIds(new Set())
      return f.slice(1)
    })
  }, [shapes])

  const openFile = useCallback(async () => {
    if (!window.api) return
    const result = await window.api.openFile()
    if (!result) return
    try {
      const bytes = new Uint8Array(result.data)
      const decoded = decodeNaplpsStandard(bytes)
      setShapes(decoded.shapes)
      setTexts(decoded.texts)
      setSelectedText(null)
      setHistory([])
      setFuture([])
      setSelectedIds(new Set())
      setFilePath(result.path)
      setFileName(result.path.split('/').pop() ?? result.path)
      setDirty(false)
      setStarted(true)
    } catch (e) {
      alert(`Failed to decode: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const getBytes = useCallback((): number[] => {
    const { bytes } = encodeNaplpsStandard(shapes, { texts })
    return Array.from(bytes)
  }, [shapes, texts])

  const saveFile = useCallback(async () => {
    if (!window.api) return
    if (!filePath) { await saveFileAs(); return }
    await window.api.saveFile(getBytes(), filePath)
    setDirty(false)
  }, [filePath, getBytes])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const path = await window.api.saveFileDialog(getBytes(), fileName.endsWith('.nap') ? fileName : fileName + '.nap')
    if (!path) return
    setFilePath(path)
    setFileName(path.split('/').pop() ?? path)
    setDirty(false)
  }, [getBytes, fileName])

  const placeImage = useCallback(async () => {
    if (!window.api) return
    const dataUrl = await window.api.openImage()
    if (!dataUrl) return
    setUnderlayImage(dataUrl)
    setUnderlayVisible(true)
  }, [])

  const deleteSelected = useCallback(() => {
    if (!selectedIds.size) return
    mutate(shapes.filter((_, i) => !selectedIds.has(i)))
  }, [shapes, selectedIds, mutate])

  const mergeSelected = useCallback(() => {
    if (selectedIds.size < 2) return
    const selected = shapes.filter((_, i) => selectedIds.has(i))
    // Only filled shapes are areas to union — closing an open line/polyline
    // into a ring and merging it as if it were solid area is what warps
    // "line" shapes (Line tool strokes, or polygons converted via "To lines").
    const fillable = selected.filter(s => s.filled)
    const lines = selected.filter(s => !s.filled)
    if (fillable.length < 2) return
    const color = fillable[0].color
    const pieces = mergeShapesExact(fillable)
    if (!pieces.length) return
    const merged: NapShape[] = pieces.map(points => ({ type: 'polygon', filled: true, color, points }))
    const rest = shapes.filter((_, i) => !selectedIds.has(i))
    mutate([...rest, ...lines, ...merged])
  }, [shapes, selectedIds, mutate])

  const recolorSelected = useCallback((r: number, g: number, b: number) => {
    if (!selectedIds.size) return
    const c = snapToVgaColor({ r, g, b })
    mutate(shapes.map((s, i) => selectedIds.has(i) ? { ...s, color: c } : s))
  }, [shapes, selectedIds, mutate])

  const addShape = useCallback((shape: NapShape) => {
    setShapes(prev => { pushHistory(prev); return [...prev, shape] })
  }, [pushHistory])

  // Convert selected filled shapes into closed 1px line loops. Caveat shown in
  // the UI: TURSHOW's line rasterizer drops each segment's last pixel, so
  // curves made of short segments render dashed — best for straight strokes.
  const convertSelectedToLines = useCallback(() => {
    if (!selectedIds.size) return
    mutate(shapes.map((s, i) => {
      if (!selectedIds.has(i) || s.type !== 'polygon' || s.points.length < 3) return s
      return { ...s, type: 'polyline' as const, filled: false, points: [...s.points, s.points[0]] }
    }))
  }, [shapes, selectedIds, mutate])

  // Live encoded size; period viewers display at ~13k baud so bytes = seconds.
  const napSize = useMemo(() => {
    if (!shapes.length && !texts.length) return 0
    try { return encodeNaplpsStandard(shapes, { texts }).bytes.length } catch { return 0 }
  }, [shapes, texts])

  // Document palette as hex strings, for the swatch picker.
  const docPaletteHex = useMemo(() => {
    const seen = new Set<string>()
    const hx = (c: { r: number; g: number; b: number }) =>
      `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`
    for (const s of shapes) seen.add(hx(s.color))
    for (const t of texts) if (t.color) seen.add(hx(t.color))
    return [...seen]
  }, [shapes, texts])

  // ── vertex + text editing ────────────────────────────────────────────────
  const editShapePoints = useCallback((i: number, points: NapShape['points']) => {
    setShapes(prev => { pushHistory(prev); return prev.map((s, j) => (j === i ? { ...s, points } : s)) })
  }, [pushHistory])

  const addText = useCallback((t: NapText) => {
    setTexts(prev => [...prev, t])
    setSelectedText(texts.length)
    setDirty(true)
  }, [texts.length])

  const updateText = useCallback((i: number, patch: Partial<NapText>) => {
    setTexts(prev => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)))
    setDirty(true)
  }, [])

  const deleteText = useCallback((i: number) => {
    setTexts(prev => prev.filter((_, j) => j !== i))
    setSelectedText(null)
    setDirty(true)
  }, [])

  // Draw order: later in the array = drawn later = on top.
  const reorderSelected = useCallback((where: 'back' | 'front' | 'down' | 'up') => {
    if (!selectedIds.size) return
    let arr = shapes.map((s, i) => ({ s, sel: selectedIds.has(i) }))
    if (where === 'back') arr = [...arr.filter(a => a.sel), ...arr.filter(a => !a.sel)]
    else if (where === 'front') arr = [...arr.filter(a => !a.sel), ...arr.filter(a => a.sel)]
    else if (where === 'down') {
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].sel && !arr[i - 1].sel) { const t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t }
      }
    } else {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (arr[i].sel && !arr[i + 1].sel) { const t = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = t }
      }
    }
    const nextSel = new Set<number>()
    arr.forEach((a, i) => { if (a.sel) nextSel.add(i) })
    setShapes(prev => { pushHistory(prev); return arr.map(a => a.s) })
    setSelectedIds(nextSel)
  }, [shapes, selectedIds, pushHistory])

  // TURSHOW hardware linter: flag filled polygons over the fill-buffer limits.
  const lint = useMemo(() => lintShapes(shapes), [shapes])
  const autoSplitFlagged = useCallback(() => {
    if (!lint.length) return
    const flagged = new Set(lint.map(l => l.index))
    const next: NapShape[] = []
    shapes.forEach((s, i) => {
      if (!flagged.has(i)) { next.push(s); return }
      const pieces = splitPolygonForHardware(s.points)
      if (pieces.length === 0) { next.push(s); return }
      for (const points of pieces) next.push({ ...s, points })
    })
    mutate(next)
  }, [shapes, lint, mutate])

  // Duplicate the selection with a small offset; select the clones.
  const duplicateSelected = useCallback(() => {
    if (!selectedIds.size) return
    const clones = shapes
      .filter((_, i) => selectedIds.has(i))
      .map(s => ({ ...s, points: s.points.map(p => ({ x: p.x + 0.01, y: p.y - 0.01 })) }))
    setShapes(prev => { pushHistory(prev); return [...prev, ...clones] })
    const base = shapes.length
    setSelectedIds(new Set(clones.map((_, k) => base + k)))
  }, [shapes, selectedIds, pushHistory])

  // Arrow-key nudge: one coordinate step (1/2048 field, ≈0.3 VGA px); ×8 with Shift.
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    if (!selectedIds.size) return
    setShapes(prev => {
      pushHistory(prev)
      return prev.map((s, i) => selectedIds.has(i)
        ? { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        : s)
    })
  }, [selectedIds, pushHistory])

  // Mirror the selection about its own bounding-box centre.
  const flipSelected = useCallback((axis: 'h' | 'v') => {
    if (!selectedIds.size) return
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity
    shapes.forEach((s, i) => {
      if (!selectedIds.has(i)) return
      for (const p of s.points) {
        if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x
        if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y
      }
    })
    if (!isFinite(mnx)) return
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2
    mutate(shapes.map((s, i) => selectedIds.has(i)
      ? { ...s, points: s.points.map(p => axis === 'h' ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: 2 * cy - p.y }) }
      : s))
  }, [shapes, selectedIds, mutate])

  // tolerance is in field units (ColorPanel converts from its pixel slider).
  const simplifySelected = useCallback((tolerance: number) => {
    if (!selectedIds.size || tolerance <= 0) return
    const next = shapes.map((s, i) => {
      if (!selectedIds.has(i) || s.points.length <= 3) return s
      const pts = dpSimplify(s.points, tolerance)
      return pts.length >= 3 ? { ...s, points: pts } : s
    })
    // keep the selection — simplify is something you nudge repeatedly
    setShapes(prev => { pushHistory(prev); return next })
  }, [shapes, selectedIds, pushHistory])

  const moveShapes = useCallback((movedShapes: NapShape[]) => {
    setShapes(prev => { pushHistory(prev); return movedShapes })
    setDirty(true)
  }, [pushHistory])

  const sortByColor = useCallback(() => {
    mutate([...shapes].sort((a, b) => {
      const ka = `${a.color.r},${a.color.g},${a.color.b}`
      const kb = `${b.color.r},${b.color.g},${b.color.b}`
      return ka < kb ? -1 : ka > kb ? 1 : 0
    }))
  }, [shapes, mutate])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // don't hijack typing in inputs/textareas (text panel, sliders, colors)
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const meta = e.metaKey || e.ctrlKey
      if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) { e.preventDefault(); deleteSelected(); return }
      if (e.key === 'z' && meta && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (e.key === 'z' && meta && e.shiftKey) { e.preventDefault(); redo(); return }
      if (e.key === 'a' && meta) { e.preventDefault(); setSelectedIds(new Set(shapes.map((_, i) => i))); return }
      if (e.key === 'Escape') { setSelectedIds(new Set()); return }
      if (e.key === 'v' && !meta) { setTool('select'); return }
      if (e.key === 'l' && !meta) { setTool('line'); return }
      if (e.key === 'r' && !meta) { setTool('rect'); return }
      if (e.key === 'g' && !meta) { setTool('poly'); return }
      if (e.key === 'c' && !meta) { setTool('circle'); return }
      if (e.key === 't' && !meta) { setTool('text'); return }
      if (e.key === 'p' && !meta) { setPreview(p => !p); return }
      // e.code (not e.key) since Shift+' produces '"' on US keyboards, not "'"
      if (e.code === 'Quote' && meta && e.shiftKey) { e.preventDefault(); setSnap(s => !s); return }
      if (e.code === 'Quote' && meta) { e.preventDefault(); setGrid(g => !g); return }
      if (e.key === 'd' && meta) { e.preventDefault(); duplicateSelected(); return }
      if (e.key.startsWith('Arrow') && !meta && selectedIds.size) {
        e.preventDefault()
        const step = (e.shiftKey ? 8 : 1) / 2048
        if (e.key === 'ArrowLeft') nudgeSelected(-step, 0)
        else if (e.key === 'ArrowRight') nudgeSelected(step, 0)
        else if (e.key === 'ArrowUp') nudgeSelected(0, step)     // NAPLPS Y is up
        else if (e.key === 'ArrowDown') nudgeSelected(0, -step)
        return
      }
      if (e.key === 'm' && meta) { e.preventDefault(); mergeSelected(); return }
      if (e.key === '=' && meta) { e.preventDefault(); canvasHandle.current?.zoomIn(); return }
      if (e.key === '-' && meta) { e.preventDefault(); canvasHandle.current?.zoomOut(); return }
      if (e.key === '0' && meta) { e.preventDefault(); canvasHandle.current?.fitToWindow(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected, undo, redo, mergeSelected, shapes, duplicateSelected, nudgeSelected, selectedIds])

  // Menu IPC actions
  useEffect(() => {
    if (!window.api) return
    const unsub = window.api.onMenuAction(action => {
      switch (action) {
        case 'open': openFile(); break
        case 'save': saveFile(); break
        case 'save-as': saveFileAs(); break
        case 'undo': undo(); break
        case 'redo': redo(); break
        case 'delete': deleteSelected(); break
        case 'merge': mergeSelected(); break
        case 'select-all': setSelectedIds(new Set(shapes.map((_, i) => i))); break
        case 'deselect': setSelectedIds(new Set()); break
        case 'zoom-in': canvasHandle.current?.zoomIn(); break
        case 'zoom-out': canvasHandle.current?.zoomOut(); break
        case 'fit': canvasHandle.current?.fitToWindow(); break
        case 'toggle-grid': setGrid(g => !g); break
        case 'toggle-snap': setSnap(s => !s); break
        case 'place-image': placeImage(); break
      }
    })
    return unsub
  }, [openFile, saveFile, saveFileAs, undo, redo, deleteSelected, mergeSelected, shapes, placeImage])

  const title = `${dirty ? '● ' : ''}${fileName} — NAP Editor`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* Title bar / toolbar */}
      <div style={{
        height: 44,
        paddingLeft: 80, // macOS traffic light spacing
        paddingRight: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion'],
      }}>
        <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, textAlign: 'center' }}>{title}</span>
        {underlayImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Image</span>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={underlayOpacity}
              onChange={e => setUnderlayOpacity(Number(e.target.value))}
              title="Reference image opacity"
              style={{ width: 80 }}
            />
            <button
              className="icon-btn"
              title="Remove reference image"
              onClick={() => setUnderlayImage(null)}
              style={{ width: 24, height: 24, fontSize: 12 }}
            >✕</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
          <button className="icon-btn" title="Open (⌘O)" onClick={openFile}>⌘O</button>
          <button
            className="icon-btn"
            title="Save (⌘S)"
            onClick={saveFile}
            disabled={!shapes.length && !texts.length}
          >⌘S</button>
          <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
          <button className="icon-btn" title="Undo (⌘Z)" onClick={undo} disabled={!history.length}>↩</button>
          <button className="icon-btn" title="Redo (⌘⇧Z)" onClick={redo} disabled={!future.length}>↪</button>
          <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
          <button className="icon-btn" title="Zoom In (⌘=)" onClick={() => canvasHandle.current?.zoomIn()}>+</button>
          <button className="icon-btn" title="Zoom Out (⌘-)" onClick={() => canvasHandle.current?.zoomOut()}>−</button>
          <button className="icon-btn" title="Fit to Window (⌘0)" onClick={() => canvasHandle.current?.fitToWindow()}>⊞</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!started ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              color: 'var(--text-muted)',
            }}
          >
            <div style={{ fontSize: 48 }}>🖼</div>
            <div style={{ fontSize: 16 }}>Open a .nap file, or start drawing on a blank canvas</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="primary" style={{ fontSize: 14, padding: '8px 20px' }} onClick={openFile}>
                Open .nap file…
              </button>
              <button style={{ fontSize: 14, padding: '8px 20px' }} onClick={() => { setStarted(true); setFileName('Untitled'); }}>
                New blank canvas
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              ⌘O to open · Space + drag to pan · ⌘scroll to zoom
            </div>
          </div>
        ) : (
          <>
            {/* Illustrator-style tool strip */}
            <div style={{
              width: 44,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '10px 0',
              background: 'var(--surface)',
              borderRight: '1px solid var(--border)',
            }}>
              {([
                ['select', '⬚', 'Select (V)'],
                ['line', '╱', 'Line (L) — click points, Enter to finish. Straight strokes only: TURSHOW dashes tight curves'],
                ['rect', '▭', 'Rectangle (R) — drag'],
                ['poly', '⬠', 'Polygon (G) — click vertices, Enter/double-click to finish'],
                ['circle', '◯', 'Circle (C) — drag from centre'],
                ['text', 'T', 'Text (T) — click to place a NAPLPS font-text block'],
              ] as Array<[Tool, string, string]>).map(([t, icon, tip]) => (
                <button
                  key={t}
                  className="icon-btn"
                  title={tip}
                  onClick={() => setTool(t)}
                  style={{
                    width: 32, height: 32, fontSize: 15,
                    ...(tool === t ? { background: 'var(--accent)', color: '#fff' } : {}),
                  }}
                >{icon}</button>
              ))}
              <div style={{ marginTop: 4 }}>
                <NapColorPicker
                  value={drawColor}
                  onChange={setDrawColor}
                  docPalette={docPaletteHex}
                  side="right"
                  title="Draw colour — NAPLPS/VGA colours only (16 palette slots per file)"
                />
              </div>
              <div style={{ flex: 1 }} />
              <button
                className="icon-btn"
                title="Show Grid (⌘') — 1/128-field grid overlay"
                onClick={() => setGrid(g => !g)}
                style={{ width: 32, height: 32, ...(grid ? { background: 'var(--accent)', color: '#fff' } : {}) }}
              >⌗</button>
              <button
                className="icon-btn"
                title="Snap to Grid (⌘⇧') — drawing tools snap to the field grid; moving shapes snaps to the nearest VGA pixel"
                onClick={() => setSnap(s => !s)}
                style={{ width: 32, height: 32, ...(snap ? { background: 'var(--accent)', color: '#fff' } : {}) }}
              >🧲</button>
              <button
                className="icon-btn"
                title="Place reference image… — traced beneath the artwork, not saved to the .nap file"
                onClick={placeImage}
                style={{ width: 32, height: 32 }}
              >🖼</button>
              {underlayImage && (
                <button
                  className="icon-btn"
                  title={underlayVisible ? 'Hide reference image' : 'Show reference image'}
                  onClick={() => setUnderlayVisible(v => !v)}
                  style={{ width: 32, height: 32, ...(underlayVisible ? { background: 'var(--accent)', color: '#fff' } : {}) }}
                >◐</button>
              )}
              <button
                className="icon-btn"
                title="TURSHOW preview (P) — pixel-faithful render of what the period viewer draws"
                onClick={() => { setPreview(p => !p); setPlaying(false) }}
                style={{ width: 32, height: 32, ...(preview ? { background: 'var(--accent)', color: '#fff' } : {}) }}
              >👁</button>
              <button
                className="icon-btn"
                title="Baud playback — draw the file at ~13k baud, the way a period modem session painted it"
                onClick={() => { setPlaying(p => !p); if (!playing) setPreview(false) }}
                style={{ width: 32, height: 32, ...(playing ? { background: 'var(--accent)', color: '#fff' } : {}) }}
                disabled={!shapes.length && !texts.length}
              >⏵</button>
            </div>
            <Canvas
              shapes={shapes}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onMove={moveShapes}
              handle={canvasHandle}
              tool={tool}
              preview={preview}
              playing={playing}
              grid={grid}
              snap={snap}
              underlayImage={underlayImage}
              underlayOpacity={underlayOpacity}
              underlayVisible={underlayVisible}
              onStopPlaying={() => setPlaying(false)}
              drawColor={drawColor}
              onAddShape={addShape}
              onEditPoints={editShapePoints}
              texts={texts}
              selectedText={selectedText}
              onSelectText={setSelectedText}
              onAddText={addText}
              onUpdateText={updateText}
            />
            <ColorPanel
              shapes={shapes}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onDelete={deleteSelected}
              onMerge={mergeSelected}
              onRecolor={recolorSelected}
              onSortByColor={sortByColor}
              onSimplify={simplifySelected}
              onConvertToLines={convertSelectedToLines}
              onReorder={reorderSelected}
              onFlip={flipSelected}
              onDuplicate={duplicateSelected}
              texts={texts}
              selectedText={selectedText}
              onSelectText={setSelectedText}
              onUpdateText={updateText}
              onDeleteText={deleteText}
            />
          </>
        )}
      </div>

      {/* Status bar */}
      {shapes.length > 0 && (
        <div style={{
          height: 24,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}>
          <span>{shapes.length} shapes</span>
          <span title="Encoded .nap size — period viewers display at ~13k baud, so bytes are seconds">
            {fmtBytes(napSize)} · ~{Math.max(1, Math.round((napSize * 10) / 13288))}s @ 13k baud
          </span>
          {selectedIds.size > 0 && <span>{selectedIds.size} selected</span>}
          {lint.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e6a23c' }}>
              <span
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
                title="Select the offending shapes"
                onClick={() => setSelectedIds(new Set(lint.map(l => l.index)))}
              >
                ⚠ {lint.length} shape{lint.length !== 1 ? 's' : ''} exceed TURSHOW fill limits
              </span>
              <button style={{ fontSize: 10, padding: '1px 6px' }} onClick={autoSplitFlagged}>Auto-split</button>
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>Space+drag to pan · ⌘scroll to zoom · Shift+click/drag to add to selection</span>
        </div>
      )}
    </div>
  )
}
