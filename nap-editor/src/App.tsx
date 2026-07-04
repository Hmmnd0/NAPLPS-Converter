import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Canvas, { type CanvasHandle } from './components/Canvas'
import ColorPanel from './components/ColorPanel'
import { decodeNaplpsStandard } from '@lib/naplps-std-decoder'
import { encodeNaplpsStandard, type NapText } from '@lib/naplps-std-encoder'
import { dpSimplify, simplifyForHardware } from '@lib/regionTrace'
import { lintShapes, splitPolygonForHardware } from '@lib/turshowSim'
import polygonClipping from 'polygon-clipping'
import type { NapShape } from '@lib/naplps-std-decoder'

export type Tool = 'select' | 'line' | 'text'

function fmtBytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

// Period renderers (TURSHOW etc.) use fixed static vertex buffers — same cap as
// the converter pipeline's MAX_POLY_VERTS.
const MAX_VERTS = 64
// Tolerances are exposed to the user in "pixels" (a 640px-wide VGA display);
// shape coords are 0..1 field units, so scale before simplifying. Passing a
// pixel-scale epsilon to field-unit points would collapse everything.
const FIELD_PX = 1 / 640

const MAX_HISTORY = 50

function mergeShapesIntoPolys(selected: NapShape[], color: NapShape['color']): NapShape[] {
  const polys = selected.filter(s => s.points.length >= 3)
  if (!polys.length) return []

  // Convert each NAPLPS shape to polygon-clipping's ring format [[x,y]...]
  // NAPLPS coords are Y-up; we pass them as-is since the union algorithm is
  // direction-agnostic for simple polygons.
  const rings = polys.map(s =>
    [s.points.map(p => [p.x, p.y] as [number, number])] as polygonClipping.Polygon
  )

  const [first, ...rest] = rings
  let unionResult: polygonClipping.MultiPolygon
  try {
    unionResult = polygonClipping.union(first, ...rest)
  } catch {
    return []
  }

  return unionResult.map((multiPolyRing): NapShape | null => {
    // multiPolyRing[0] is the outer ring; [1..] would be holes (ignore for NAPLPS)
    const outer = multiPolyRing[0]
    // polygon-clipping closes the ring (last point == first); drop the duplicate
    const pts = outer[outer.length - 1][0] === outer[0][0] && outer[outer.length - 1][1] === outer[0][1]
      ? outer.slice(0, -1)
      : outer
    if (pts.length < 3) return null
    let points = pts.map(([x, y]) => ({ x, y }))
    // Union output can be arbitrarily vertex-heavy; keep it renderable.
    if (points.length > MAX_VERTS) points = simplifyForHardware(points, 1.5 * FIELD_PX)
    if (points.length < 3) return null
    return {
      type: 'polygon' as const,
      filled: true,
      color,
      points,
    }
  }).filter((s): s is NapShape => s !== null)
}

export default function App() {
  const [shapes, setShapes] = useState<NapShape[]>([])
  const [history, setHistory] = useState<NapShape[][]>([])
  const [future, setFuture] = useState<NapShape[][]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [tool, setTool] = useState<Tool>('select')
  const [preview, setPreview] = useState(false)
  const [drawColor, setDrawColor] = useState('#ff4040')
  // NAPLPS font-text blocks (encoded as TEXT/FIELD commands on save; the
  // viewer supplies the letterforms). Authored fresh — the decoder does not
  // yet reconstruct TEXT blocks from existing files.
  const [texts, setTexts] = useState<NapText[]>([])
  const [selectedText, setSelectedText] = useState<number | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('Untitled')
  const [dirty, setDirty] = useState(false)
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
      setTexts([])
      setSelectedText(null)
      setHistory([])
      setFuture([])
      setSelectedIds(new Set())
      setFilePath(result.path)
      setFileName(result.path.split('/').pop() ?? result.path)
      setDirty(false)
      if ((decoded.commandCounts['TEXT'] ?? 0) > 0) {
        alert('This file contains NAPLPS TEXT blocks. The editor cannot re-edit existing text yet — the graphics load fine, but the original text commands will be dropped if you save over them.')
      }
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

  const deleteSelected = useCallback(() => {
    if (!selectedIds.size) return
    mutate(shapes.filter((_, i) => !selectedIds.has(i)))
  }, [shapes, selectedIds, mutate])

  const mergeSelected = useCallback(() => {
    if (selectedIds.size < 2) return
    const selected = shapes.filter((_, i) => selectedIds.has(i))
    const color = selected[0].color
    const merged = mergeShapesIntoPolys(selected, color)
    if (!merged.length) return
    const rest = shapes.filter((_, i) => !selectedIds.has(i))
    mutate([...rest, ...merged])
  }, [shapes, selectedIds, mutate])

  const recolorSelected = useCallback((r: number, g: number, b: number) => {
    if (!selectedIds.size) return
    mutate(shapes.map((s, i) => selectedIds.has(i) ? { ...s, color: { r, g, b } } : s))
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
      if (e.key === 't' && !meta) { setTool('text'); return }
      if (e.key === 'p' && !meta) { setPreview(p => !p); return }
      if (e.key === 'm' && meta) { e.preventDefault(); mergeSelected(); return }
      if (e.key === '=' && meta) { e.preventDefault(); canvasHandle.current?.zoomIn(); return }
      if (e.key === '-' && meta) { e.preventDefault(); canvasHandle.current?.zoomOut(); return }
      if (e.key === '0' && meta) { e.preventDefault(); canvasHandle.current?.fitToWindow(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected, undo, redo, mergeSelected, shapes])

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
      }
    })
    return unsub
  }, [openFile, saveFile, saveFileAs, undo, redo, deleteSelected, mergeSelected, shapes])

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
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'] }}>
          <button className="icon-btn" title="Open (⌘O)" onClick={openFile}>⌘O</button>
          <button
            className="icon-btn"
            title="Save (⌘S)"
            onClick={saveFile}
            disabled={!shapes.length}
          >⌘S</button>
          <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
          <button className="icon-btn" title="Undo (⌘Z)" onClick={undo} disabled={!history.length}>↩</button>
          <button className="icon-btn" title="Redo (⌘⇧Z)" onClick={redo} disabled={!future.length}>↪</button>
          <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
          <button
            className="icon-btn"
            title="Select tool (V)"
            onClick={() => setTool('select')}
            style={tool === 'select' ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >⬚</button>
          <button
            className="icon-btn"
            title="Line tool (L) — click to add points, Enter/double-click to finish, Esc to cancel. Best for straight strokes: TURSHOW dashes tight curves."
            onClick={() => setTool('line')}
            style={tool === 'line' ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >╱</button>
          <button
            className="icon-btn"
            title="Text tool (T) — click to place a NAPLPS font-text block. The viewer supplies the letterforms."
            onClick={() => setTool('text')}
            style={tool === 'text' ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >T</button>
          {(tool === 'line' || tool === 'text') && (
            <input
              type="color"
              value={drawColor}
              onChange={e => setDrawColor(e.target.value)}
              title="Draw colour"
              style={{ width: 26, height: 24, padding: 1, alignSelf: 'center' }}
            />
          )}
          <button
            className="icon-btn"
            title="TURSHOW preview (P) — pixel-faithful render of what the period viewer draws"
            onClick={() => setPreview(p => !p)}
            style={preview ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >▶</button>
          <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
          <button className="icon-btn" title="Zoom In (⌘=)" onClick={() => canvasHandle.current?.zoomIn()}>+</button>
          <button className="icon-btn" title="Zoom Out (⌘-)" onClick={() => canvasHandle.current?.zoomOut()}>−</button>
          <button className="icon-btn" title="Fit to Window (⌘0)" onClick={() => canvasHandle.current?.fitToWindow()}>⊞</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {shapes.length === 0 ? (
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
            <div style={{ fontSize: 16 }}>Open a .nap file to start editing</div>
            <button className="primary" style={{ fontSize: 14, padding: '8px 20px' }} onClick={openFile}>
              Open .nap file…
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              ⌘O to open · Space + drag to pan · ⌘scroll to zoom
            </div>
          </div>
        ) : (
          <>
            <Canvas
              shapes={shapes}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onMove={moveShapes}
              handle={canvasHandle}
              tool={tool}
              preview={preview}
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
