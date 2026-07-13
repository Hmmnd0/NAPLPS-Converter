import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'
import { renderTurshowSim, SIM_W, SIM_H, snapToVgaColor } from '@lib/turshowSim'
import { decodeNaplpsStandard } from '@lib/naplps-std-decoder'
import { encodeNaplpsStandard } from '@lib/naplps-std-encoder'
import type { NapShape, NapPoint } from '@lib/naplps-std-decoder'
import type { NapText } from '@lib/naplps-std-encoder'
import type { Tool } from '../App'

// Period modem pacing observed in TURSHOW: ~13288 baud ≈ 1329 bytes/s.
const BAUD_BYTES_PER_S = 1329

// NAPLPS field: x ∈ [0,1], y ∈ [0,0.75], Y-up.
// Natural SVG space: 1000×750px, Y-down.
const NW = 1000
const NH = 750
const DRAG_THRESHOLD = 4 // pixels before a mousedown-on-shape becomes a drag

function toSvg(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * NW, y: (0.75 - p.y) * NW }
}

function pointsStr(pts: Array<{ x: number; y: number }>): string {
  return pts.map(p => { const s = toSvg(p); return `${s.x},${s.y}` }).join(' ')
}

function applyOffset(pts: Array<{ x: number; y: number }>, dx: number, dy: number) {
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }))
}

function shapeBbox(shape: NapShape): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of shape.points) {
    const s = toSvg(p)
    if (s.x < x0) x0 = s.x
    if (s.y < y0) y0 = s.y
    if (s.x > x1) x1 = s.x
    if (s.y > y1) y1 = s.y
  }
  return { x0, y0, x1, y1 }
}

function colorHex(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r},${c.g},${c.b})`
}

interface RubberBand {
  sx: number; sy: number
  ex: number; ey: number
}

interface Transform {
  zoom: number
  panX: number
  panY: number
}

export interface CanvasHandle {
  fitToWindow: () => void
  zoomIn: () => void
  zoomOut: () => void
}

interface Props {
  shapes: NapShape[]
  selectedIds: Set<number>
  onSelect: (ids: Set<number>) => void
  onMove: (movedShapes: NapShape[]) => void
  handle?: React.MutableRefObject<CanvasHandle | null>
  tool?: Tool
  /** TURSHOW-faithful raster preview instead of the editable vector view */
  preview?: boolean
  /** baud-paced playback of the encoded byte stream */
  playing?: boolean
  onStopPlaying?: () => void
  /** show a field-space grid; drawing-tool clicks snap to it */
  grid?: boolean
  /** hex colour for the line/text tools */
  drawColor?: string
  onAddShape?: (shape: NapShape) => void
  onEditPoints?: (shapeIdx: number, points: NapPoint[]) => void
  texts?: NapText[]
  selectedText?: number | null
  onSelectText?: (i: number | null) => void
  onAddText?: (t: NapText) => void
  onUpdateText?: (i: number, patch: Partial<NapText>) => void
}

export default function Canvas({
  shapes, selectedIds, onSelect, onMove, handle,
  tool = 'select', preview = false, playing = false, onStopPlaying, grid = false,
  drawColor = '#ffffff', onAddShape,
  onEditPoints, texts = [], selectedText = null, onSelectText, onAddText, onUpdateText,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tf, setTf] = useState<Transform>({ zoom: 1, panX: 0, panY: 0 })
  const [rubber, setRubber] = useState<RubberBand | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null)
  // Line/poly tool draft, in NAPLPS field coordinates
  const [draft, setDraft] = useState<Array<{ x: number; y: number }>>([])
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  // Rect/circle drag draft: anchor + current corner (field coords)
  const [dragDraft, setDragDraft] = useState<{ a: NapPoint; b: NapPoint } | null>(null)
  const dragDraftRef = useRef(dragDraft)
  useEffect(() => { dragDraftRef.current = dragDraft }, [dragDraft])
  const toolRef = useRef(tool)
  useEffect(() => { toolRef.current = tool }, [tool])
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  // Baud playback: encoded bytes + current position (bytes drawn so far)
  const [playPos, setPlayPos] = useState(0)
  const [playPaused, setPlayPaused] = useState(false)
  const playBytesRef = useRef<Uint8Array | null>(null)
  // Vertex editing: which shape is in vertex mode, live-dragged points
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editPts, setEditPts] = useState<NapPoint[] | null>(null)
  const editIdxRef = useRef(editIdx)
  useEffect(() => { editIdxRef.current = editIdx }, [editIdx])
  const editPtsRef = useRef(editPts)
  useEffect(() => { editPtsRef.current = editPts }, [editPts])
  const vertexDrag = useRef<{ vi: number } | null>(null)
  // Text block dragging
  const textDrag = useRef<{ ti: number; startX: number; startY: number; origX: number; origY: number } | null>(null)

  // Refs to avoid stale closures in event handlers
  const tfRef = useRef(tf)
  useEffect(() => { tfRef.current = tf }, [tf])
  const shapesRef = useRef(shapes)
  useEffect(() => { shapesRef.current = shapes }, [shapes])
  const selectedRef = useRef(selectedIds)
  useEffect(() => { selectedRef.current = selectedIds }, [selectedIds])
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  const onMoveRef = useRef(onMove)
  useEffect(() => { onMoveRef.current = onMove }, [onMove])

  // Interaction state refs (mutated directly, don't need re-renders)
  const panStart = useRef<{ mx: number; my: number; panX: number; panY: number } | null>(null)
  const dragState = useRef<{
    startMx: number
    startMy: number
    originalShapes: NapShape[]
    moved: boolean
  } | null>(null)
  const pointerMode = useRef<'none' | 'pan' | 'drag' | 'rubber' | 'vertex' | 'text' | 'shape'>('none')

  const fitToWindow = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const zoom = Math.min((width - 40) / NW, (height - 40) / NH)
    const panX = (width - NW * zoom) / 2
    const panY = (height - NH * zoom) / 2
    setTf({ zoom, panX, panY })
  }, [])

  useLayoutEffect(() => { fitToWindow() }, [fitToWindow])

  useEffect(() => {
    if (!handle) return
    handle.current = {
      fitToWindow,
      zoomIn: () => setTf(t => zoomAround(t, 0, 0, 1.25, containerRef.current)),
      zoomOut: () => setTf(t => zoomAround(t, 0, 0, 0.8, containerRef.current)),
    }
  }, [handle, fitToWindow])

  // Cmd/Ctrl+wheel zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setTf(t => ({
        zoom: Math.max(0.05, Math.min(50, t.zoom * factor)),
        panX: cx - (cx - t.panX) * factor,
        panY: cy - (cy - t.panY) * factor,
      }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Spacebar → pan mode
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setSpaceHeld(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // Grid: 1/128 field steps (≈5 VGA px), major line every 8 minors.
  const GRID_STEP = 1 / 128
  const gridRef = useRef(grid)
  useEffect(() => { gridRef.current = grid }, [grid])
  const snapField = useCallback((p: NapPoint): NapPoint => {
    if (!gridRef.current) return p
    return {
      x: Math.round(p.x / GRID_STEP) * GRID_STEP,
      y: Math.round(p.y / GRID_STEP) * GRID_STEP,
    }
  }, [GRID_STEP])

  // Window-level mouse tracking during drag/pan so the cursor can leave the SVG
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const mode = pointerMode.current
      const { zoom, panX, panY } = tfRef.current
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()

      if (mode === 'pan' && panStart.current) {
        const ps = panStart.current
        const dx = e.clientX - ps.mx
        const dy = e.clientY - ps.my
        setTf(t => ({ ...t, panX: ps.panX + dx, panY: ps.panY + dy }))
        return
      }

      if (mode === 'drag' && dragState.current) {
        const ds = dragState.current
        const screenDx = e.clientX - ds.startMx
        const screenDy = e.clientY - ds.startMy
        if (!ds.moved && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return
        ds.moved = true
        // Convert screen delta → NAPLPS delta (Y is flipped: down screen = down Y NAPLPS)
        const napDx = screenDx / zoom / NW
        const napDy = -screenDy / zoom / NW
        setDragOffset({ dx: napDx, dy: napDy })
        return
      }

      if (mode === 'rubber') {
        setRubber(r => r ? { ...r, ex: e.clientX, ey: e.clientY } : null)
        return
      }

      if (mode === 'vertex' && vertexDrag.current) {
        const vi = vertexDrag.current.vi
        const natX = (e.clientX - rect.left - panX) / zoom
        const natY = (e.clientY - rect.top - panY) / zoom
        const p = { x: natX / NW, y: 0.75 - natY / NW }
        setEditPts(pts => (pts ? pts.map((q, k) => (k === vi ? p : q)) : pts))
        return
      }

      if (mode === 'text' && textDrag.current) {
        const td = textDrag.current
        const dx = (e.clientX - td.startX) / zoom / NW
        const dy = -(e.clientY - td.startY) / zoom / NW
        onUpdateText?.(td.ti, { x: td.origX + dx, y: td.origY + dy })
        return
      }

      if (mode === 'shape' && dragDraftRef.current) {
        const natX = (e.clientX - rect.left - panX) / zoom
        const natY = (e.clientY - rect.top - panY) / zoom
        const b = snapField({ x: natX / NW, y: 0.75 - natY / NW })
        setDragDraft(d => (d ? { ...d, b } : d))
      }
    }

    const onUp = (e: MouseEvent) => {
      const mode = pointerMode.current
      pointerMode.current = 'none'

      if (mode === 'pan') {
        panStart.current = null
        return
      }

      if (mode === 'drag' && dragState.current) {
        const ds = dragState.current
        const { zoom } = tfRef.current
        if (ds.moved) {
          // Commit the move
          const screenDx = e.clientX - ds.startMx
          const screenDy = e.clientY - ds.startMy
          const napDx = screenDx / zoom / NW
          const napDy = -screenDy / zoom / NW
          const sel = selectedRef.current
          const moved = ds.originalShapes.map((s, i) =>
            sel.has(i)
              ? { ...s, points: applyOffset(s.points, napDx, napDy) }
              : s
          )
          onMoveRef.current(moved)
        }
        dragState.current = null
        setDragOffset(null)
        return
      }

      if (mode === 'vertex') {
        vertexDrag.current = null
        if (editPtsRef.current && editIdxRef.current !== null) {
          onEditPoints?.(editIdxRef.current, editPtsRef.current)
        }
        setEditPts(null)
        return
      }

      if (mode === 'text') {
        textDrag.current = null
        return
      }

      if (mode === 'shape') {
        const d = dragDraftRef.current
        setDragDraft(null)
        if (d && onAddShape) {
          const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(drawColor)
          const color = m
            ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
            : { r: 255, g: 255, b: 255 }
          const MIN = 2 / 2048 // ignore accidental clicks
          if (toolRef.current === 'rect') {
            const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x)
            const y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y)
            if (x1 - x0 > MIN && y1 - y0 > MIN) {
              onAddShape({
                type: 'polygon', filled: true, color,
                points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
              })
            }
          } else if (toolRef.current === 'circle') {
            const r = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)
            if (r > MIN) {
              const pts: NapPoint[] = []
              for (let k = 0; k < 24; k++) {
                const t = (2 * Math.PI * k) / 24
                pts.push({ x: d.a.x + r * Math.cos(t), y: d.a.y + r * Math.sin(t) })
              }
              onAddShape({ type: 'polygon', filled: true, color, points: pts })
            }
          }
        }
        return
      }

      if (mode === 'rubber') {
        // Use rubber directly from closure (it's in the useEffect dep array so it's current).
        // Don't use a setRubber updater — calling onSelectRef inside an updater triggers
        // "Cannot update a component while rendering a different component".
        const cur = rubber
        setRubber(null)
        if (cur) {
          const el = containerRef.current
          if (el) {
            const rect = el.getBoundingClientRect()
            const { zoom, panX, panY } = tfRef.current
            const toNat = (sx: number, sy: number) => ({
              x: (sx - rect.left - panX) / zoom,
              y: (sy - rect.top - panY) / zoom,
            })
            const a = toNat(cur.sx, cur.sy)
            const b = toNat(cur.ex, cur.ey)
            const rx0 = Math.min(a.x, b.x), rx1 = Math.max(a.x, b.x)
            const ry0 = Math.min(a.y, b.y), ry1 = Math.max(a.y, b.y)
            const next = new Set(e.shiftKey ? selectedRef.current : new Set<number>())
            shapesRef.current.forEach((shape, i) => {
              const bb = shapeBbox(shape)
              if (bb.x0 < rx1 && bb.x1 > rx0 && bb.y0 < ry1 && bb.y1 > ry0) next.add(i)
            })
            onSelectRef.current(next)
          }
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [rubber, onAddShape, drawColor, onEditPoints, onUpdateText, snapField]) // rubber in dep so onUp closure sees latest rubber for the rubber-band case

  // ── Baud playback ──────────────────────────────────────────────────────────
  // Encode once on start; advance the byte position in real time; render the
  // decoded PREFIX each frame. Truncated tails decode safely (streaming
  // decoder drops the incomplete command), so any byte position is valid —
  // this shows exactly what a caller saw as the file painted over the modem.
  useEffect(() => {
    if (!playing) { playBytesRef.current = null; setPlayPos(0); setPlayPaused(false); return }
    try {
      playBytesRef.current = encodeNaplpsStandard(shapes, { texts }).bytes
    } catch { onStopPlaying?.(); return }
    setPlayPos(0)
    setPlayPaused(false)
  }, [playing, shapes, texts, onStopPlaying])

  useEffect(() => {
    if (!playing || playPaused) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const total = playBytesRef.current?.length ?? 0
      const dt = (now - last) / 1000
      last = now
      setPlayPos(p => Math.min(total, p + dt * BAUD_BYTES_PER_S))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, playPaused])

  useEffect(() => {
    if (!playing) return
    const bytes = playBytesRef.current
    const canvas = previewCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!bytes || !canvas || !ctx) return
    const slice = bytes.slice(0, Math.floor(playPos))
    const dec = decodeNaplpsStandard(slice)
    const frame = renderTurshowSim(dec.shapes)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0)
    for (const t of dec.texts) {
      const fontSize = (t.charH ?? 0.028) * (SIM_H / 0.75)
      const charW = (t.charW ?? 0.0145) * SIM_W
      const c = t.color ?? { r: 255, g: 255, b: 255 }
      ctx.font = `${fontSize}px Courier, monospace`
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`
      try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${charW - 0.6 * fontSize}px` } catch { /* older engines */ }
      t.lines.forEach((line, k) => {
        ctx.fillText(line, t.x * SIM_W, (1 - (t.y - (k + 0.8) * (t.charH ?? 0.028)) / 0.75) * (SIM_H - 1))
      })
    }
  }, [playing, playPos])

  // TURSHOW preview raster
  useEffect(() => {
    if (!preview) return
    const canvas = previewCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const frame = renderTurshowSim(shapes)
    // copy into a fresh buffer: ImageData's typing rejects ArrayBufferLike
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0)
    // font-text placement guide: real letterforms come from the viewer
    // (TURSHOW's built-in font), so this monospace approximation is for
    // position/size only — same caveat as the Text Placer.
    for (const t of texts) {
      const fontSize = (t.charH ?? 0.028) * (SIM_H / 0.75)
      const charW = (t.charW ?? 0.0145) * SIM_W
      const c = t.color ?? { r: 255, g: 255, b: 255 }
      ctx.font = `${fontSize}px Courier, monospace`
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`
      try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${charW - 0.6 * fontSize}px` } catch { /* older engines */ }
      t.lines.forEach((line, k) => {
        ctx.fillText(line, t.x * SIM_W, (1 - (t.y - (k + 0.8) * (t.charH ?? 0.028)) / 0.75) * (SIM_H - 1))
      })
    }
  }, [preview, shapes, texts])

  // screen coords → NAPLPS field coords (snapped when the grid is on)
  const screenToField = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const { zoom, panX, panY } = tfRef.current
    const natX = (clientX - rect.left - panX) / zoom
    const natY = (clientY - rect.top - panY) / zoom
    return snapField({ x: natX / NW, y: 0.75 - natY / NW })
  }, [snapField])

  // Tool-point resolver shared by the live preview and the actual clicks, so
  // what you see is exactly what commits. With Shift held:
  //  1. snap to the nearest existing vertex within ~8 screen px (registration
  //     against already-drawn geometry), else
  //  2. constrain the segment from the previous draft point to 45° increments
  //     (Illustrator's shift behaviour).
  const resolveToolPoint = useCallback((clientX: number, clientY: number, shift: boolean): NapPoint | null => {
    const p = screenToField(clientX, clientY)
    if (!p || !shift) return p
    const { zoom } = tfRef.current
    const threshold = 8 / (zoom * NW) // 8 screen px in field units
    let best: NapPoint | null = null
    let bestD = threshold
    for (const s of shapesRef.current) {
      for (const q of s.points) {
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        if (d < bestD) { bestD = d; best = q }
      }
    }
    if (best) return { x: best.x, y: best.y }
    const last = draftRef.current[draftRef.current.length - 1]
    if (last) {
      const dx = p.x - last.x, dy = p.y - last.y
      const len = Math.hypot(dx, dy)
      if (len > 1e-6) {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
        return { x: last.x + len * Math.cos(ang), y: last.y + len * Math.sin(ang) }
      }
    }
    return p
  }, [screenToField])

  // Live cursor point for the drawing tools (drives the Illustrator-style
  // rubber-band segment preview behind the cursor).
  const [cursorPt, setCursorPt] = useState<NapPoint | null>(null)
  useEffect(() => { if (tool === 'select' || preview || playing) setCursorPt(null) }, [tool, preview, playing])

  const parseDrawColor = useCallback(() => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(drawColor)
    return snapToVgaColor(m
      ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
      : { r: 255, g: 255, b: 255 })
  }, [drawColor])

  const commitDraft = useCallback(() => {
    const d = draftRef.current
    setDraft([])
    if (!onAddShape) return
    if (tool === 'poly' && d.length >= 3) {
      onAddShape({ type: 'polygon', filled: true, color: parseDrawColor(), points: d })
    } else if (tool === 'line' && d.length >= 2) {
      onAddShape({ type: 'polyline', filled: false, color: parseDrawColor(), points: d })
    }
  }, [onAddShape, parseDrawColor, tool])

  // line/poly tool keys: Enter commits, Escape cancels
  useEffect(() => {
    if (tool !== 'line' && tool !== 'poly') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); commitDraft() }
      if (e.key === 'Escape') setDraft([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, commitDraft])

  // leaving the tool or entering preview drops any draft
  useEffect(() => {
    if ((tool !== 'line' && tool !== 'poly') || preview) setDraft([])
    if ((tool !== 'rect' && tool !== 'circle') || preview) setDragDraft(null)
  }, [tool, preview])

  const onSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || spaceHeld) {
      e.preventDefault()
      pointerMode.current = 'pan'
      panStart.current = { mx: e.clientX, my: e.clientY, panX: tfRef.current.panX, panY: tfRef.current.panY }
      return
    }
    if (e.button !== 0) return

    if (preview || playing) return // view-only; pan/zoom still available

    if (tool === 'line' || tool === 'poly') {
      const p = resolveToolPoint(e.clientX, e.clientY, e.shiftKey)
      if (p) setDraft(d => [...d, p])
      return
    }

    if (tool === 'rect' || tool === 'circle') {
      const p = screenToField(e.clientX, e.clientY)
      if (p) {
        setDragDraft({ a: p, b: p })
        pointerMode.current = 'shape'
      }
      return
    }

    if (tool === 'text') {
      const p = screenToField(e.clientX, e.clientY)
      if (p && onAddText) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(drawColor)
        onAddText({
          lines: ['TEXT'],
          x: p.x, y: p.y,
          charW: 0.0145, charH: 0.028,
          color: m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 255, b: 255 },
        })
      }
      return
    }

    const target = e.target as SVGElement
    const idxStr = target.dataset.idx
    const shapeIdx = idxStr !== undefined ? Number(idxStr) : NaN

    if (!isNaN(shapeIdx)) {
      // Clicked a shape
      if (e.shiftKey) {
        // Shift-click: toggle membership, no drag
        const next = new Set(selectedIds)
        if (next.has(shapeIdx)) next.delete(shapeIdx)
        else next.add(shapeIdx)
        onSelect(next)
        return
      }

      // Non-shift: ensure this shape is selected, then start potential drag
      const nextSel = selectedIds.has(shapeIdx) ? selectedIds : new Set([shapeIdx])
      if (!selectedIds.has(shapeIdx)) onSelect(nextSel)

      pointerMode.current = 'drag'
      dragState.current = {
        startMx: e.clientX,
        startMy: e.clientY,
        originalShapes: shapes,
        moved: false,
      }
      return
    }

    // Clicked background → leave vertex mode, deselect, rubber band
    setEditIdx(null)
    onSelectText?.(null)
    if (!e.shiftKey) onSelect(new Set())
    pointerMode.current = 'rubber'
    setRubber({ sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY })
  }, [spaceHeld, selectedIds, onSelect, shapes, tool, preview, playing, screenToField, drawColor, onAddText, onSelectText])

  // Double-click: finish a line draft, or enter vertex-edit mode on a shape.
  const onSvgDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (preview) return
    if (tool === 'line' || tool === 'poly') { commitDraft(); return }
    if (tool !== 'select') return
    const target = e.target as SVGElement
    const idxStr = target.dataset.idx
    const shapeIdx = idxStr !== undefined ? Number(idxStr) : NaN
    if (!isNaN(shapeIdx)) {
      setEditIdx(shapeIdx)
      onSelect(new Set([shapeIdx]))
    } else {
      setEditIdx(null)
    }
  }, [preview, tool, commitDraft, onSelect])

  // Vertex mode exits with the tool, the preview toggle, or Escape.
  useEffect(() => { if (tool !== 'select' || preview) setEditIdx(null) }, [tool, preview])
  useEffect(() => {
    if (editIdx === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditIdx(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editIdx])
  // Shape list changed under us (delete/merge/reorder) → drop vertex mode.
  useEffect(() => { setEditIdx(null); setEditPts(null) }, [shapes.length])

  const { zoom, panX, panY } = tf
  const isDragging = dragOffset !== null
  const cursor = spaceHeld
    ? (pointerMode.current === 'pan' ? 'grabbing' : 'grab')
    : tool !== 'select' && !preview && !playing ? 'crosshair'
    : isDragging ? 'move' : 'default'

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor, background: '#111' }}
    >
      {(preview || playing) && (
        <canvas
          ref={previewCanvasRef}
          width={SIM_W}
          height={SIM_H}
          style={{
            position: 'absolute', left: 0, top: 0,
            transformOrigin: '0 0',
            transform: `translate(${panX}px,${panY}px) scale(${(zoom * NW) / SIM_W},${(zoom * NH) / SIM_H})`,
            imageRendering: 'pixelated',
          }}
        />
      )}
      <svg
        width="100%"
        height="100%"
        style={{ display: 'block', position: 'absolute', inset: 0 }}
        onMouseDown={onSvgMouseDown}
        onDoubleClick={onSvgDoubleClick}
        onMouseMove={tool !== 'select' && !preview && !playing
          ? e => setCursorPt(resolveToolPoint(e.clientX, e.clientY, e.shiftKey))
          : undefined}
        onMouseLeave={() => setCursorPt(null)}
      >
        <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
          {!preview && !playing && <rect x={0} y={0} width={NW} height={NH} fill="#000" />}

          {/* field grid: minor 1/128 field, major every 8 minors */}
          {grid && !preview && !playing && (() => {
            const minor = NW / 128
            const lines: React.ReactNode[] = []
            for (let i = 0; i <= 128; i++) {
              const v = i * minor
              const isMajor = i % 8 === 0
              lines.push(<line key={'v' + i} x1={v} y1={0} x2={v} y2={NH}
                stroke={isMajor ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'} strokeWidth={1 / zoom} />)
              if (v <= NH) lines.push(<line key={'h' + i} x1={0} y1={v} x2={NW} y2={v}
                stroke={isMajor ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'} strokeWidth={1 / zoom} />)
            }
            return <g pointerEvents="none">{lines}</g>
          })()}

          {!preview && !playing && shapes.map((shape, i) => {
            const selected = selectedIds.has(i)
            const hov = hovered === i && !selected
            const pts = selected && dragOffset
              ? applyOffset(shape.points, dragOffset.dx, dragOffset.dy)
              : shape.points
            const selStroke = selected ? '#0a84ff' : hov ? 'rgba(255,255,255,0.4)' : undefined
            const selWidth = selected ? 2 / zoom : hov ? 1 / zoom : undefined
            const shared = {
              key: i,
              'data-idx': i,
              points: pointsStr(pts),
              vectorEffect: 'non-scaling-stroke' as const,
              style: { cursor: selected ? 'move' : 'pointer' },
              onMouseEnter: () => setHovered(i),
              onMouseLeave: () => setHovered(null as unknown as number),
            }

            if (shape.type === 'point') {
              const s = toSvg(pts[0] ?? { x: 0, y: 0 })
              return (
                <circle
                  key={i}
                  data-idx={i}
                  cx={s.x} cy={s.y} r={3 / zoom}
                  fill={colorHex(shape.color)}
                  stroke={selStroke ?? 'none'}
                  strokeWidth={selWidth ?? 0}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: selected ? 'move' : 'pointer' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null as unknown as number)}
                />
              )
            }

            if (shape.type === 'polyline' || !shape.filled) {
              return (
                <polygon
                  {...shared}
                  fill="none"
                  stroke={selStroke ?? colorHex(shape.color)}
                  strokeWidth={selWidth ?? (1.5 / zoom)}
                />
              )
            }

            return (
              <polygon
                {...shared}
                fill={colorHex(shape.color)}
                stroke={selStroke ?? 'none'}
                strokeWidth={selWidth ?? 0}
              />
            )
          })}

          {/* font-text blocks */}
          {!preview && !playing && texts.map((t, ti) => {
            const fontSize = (t.charH ?? 0.028) * NW
            const charW = (t.charW ?? 0.0145) * NW
            const spacing = charW - 0.6 * fontSize
            const maxLen = Math.max(1, ...t.lines.map(l => l.length))
            const sel = selectedText === ti
            const topY = (0.75 - t.y) * NW
            const c = t.color ?? { r: 255, g: 255, b: 255 }
            return (
              <g
                key={`t${ti}`}
                style={{ cursor: 'move' }}
                onMouseDown={e => {
                  if (tool !== 'select' || spaceHeld) return
                  e.stopPropagation()
                  onSelectText?.(ti)
                  onSelect(new Set())
                  pointerMode.current = 'text'
                  textDrag.current = { ti, startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y }
                }}
              >
                <rect
                  x={t.x * NW} y={topY}
                  width={maxLen * charW} height={t.lines.length * fontSize}
                  fill="transparent"
                  stroke={sel ? '#0a84ff' : 'none'}
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={sel ? `${4 / zoom} ${3 / zoom}` : undefined}
                />
                {t.lines.map((line, k) => (
                  <text
                    key={k}
                    x={t.x * NW}
                    y={topY + (k + 0.8) * fontSize}
                    fontFamily="Courier, monospace"
                    fontSize={fontSize}
                    letterSpacing={spacing}
                    fill={colorHex(c)}
                    style={{ userSelect: 'none' }}
                  >
                    {line}
                  </text>
                ))}
              </g>
            )
          })}

          {/* vertex-edit handles */}
          {!preview && !playing && editIdx !== null && shapes[editIdx] && (() => {
            const shape = shapes[editIdx]
            const pts = editPts ?? shape.points
            const minPts = shape.type === 'polygon' ? 3 : 2
            const handles: React.ReactNode[] = []
            pts.forEach((p, vi) => {
              const sp = toSvg(p)
              const q = pts[(vi + 1) % pts.length]
              const mid = toSvg({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
              // midpoint inserter (skip the closing edge for open polylines)
              if (shape.type === 'polygon' || vi < pts.length - 1) {
                handles.push(
                  <circle
                    key={`m${vi}`} cx={mid.x} cy={mid.y} r={3 / zoom}
                    fill="#111" stroke="#0a84ff" strokeWidth={1 / zoom}
                    style={{ cursor: 'copy' }}
                    onMouseDown={e => {
                      e.stopPropagation()
                      const next = [...pts]
                      next.splice(vi + 1, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
                      setEditPts(next)
                      vertexDrag.current = { vi: vi + 1 }
                      pointerMode.current = 'vertex'
                    }}
                  />
                )
              }
              handles.push(
                <circle
                  key={`v${vi}`} cx={sp.x} cy={sp.y} r={4.5 / zoom}
                  fill="#0a84ff" stroke="#fff" strokeWidth={1 / zoom}
                  style={{ cursor: 'grab' }}
                  onMouseDown={e => {
                    e.stopPropagation()
                    if (e.altKey) {
                      if (pts.length > minPts && onEditPoints) {
                        onEditPoints(editIdx, pts.filter((_, k) => k !== vi))
                      }
                      return
                    }
                    setEditPts([...pts])
                    vertexDrag.current = { vi }
                    pointerMode.current = 'vertex'
                  }}
                />
              )
            })
            return (
              <g>
                <polygon
                  points={pointsStr(pts)}
                  fill="none" stroke="#0a84ff"
                  strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`}
                  pointerEvents="none"
                />
                {handles}
              </g>
            )
          })()}

          {/* line/poly tool draft */}
          {draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={pointsStr(tool === 'poly' && draft.length >= 3 ? [...draft, draft[0]] : draft)}
                fill={tool === 'poly' && draft.length >= 3 ? drawColor + '33' : 'none'}
                stroke={drawColor}
                strokeWidth={1.5 / zoom}
                strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              />
              {draft.map((p, i) => {
                const sp = toSvg(p)
                return <circle key={i} cx={sp.x} cy={sp.y} r={2.5 / zoom} fill="#0a84ff" />
              })}
            </g>
          )}

          {/* rubber-band preview: last draft point → cursor (Illustrator-style) */}
          {(tool === 'line' || tool === 'poly') && cursorPt && (
            <g pointerEvents="none">
              {draft.length > 0 && (() => {
                const a = toSvg(draft[draft.length - 1]), b = toSvg(cursorPt)
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={drawColor} strokeWidth={1.5 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} opacity={0.7} />
              })()}
              {(() => {
                const c = toSvg(cursorPt)
                return <circle cx={c.x} cy={c.y} r={3 / zoom} fill="none" stroke={drawColor} strokeWidth={1 / zoom} />
              })()}
            </g>
          )}

          {/* rect/circle drag draft */}
          {dragDraft && (() => {
            const a = toSvg(dragDraft.a), b = toSvg(dragDraft.b)
            if (tool === 'circle') {
              const r = Math.hypot(b.x - a.x, b.y - a.y)
              return <circle cx={a.x} cy={a.y} r={r} fill={drawColor + '55'} stroke={drawColor} strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} pointerEvents="none" />
            }
            return (
              <rect
                x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
                width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
                fill={drawColor + '55'} stroke={drawColor}
                strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                pointerEvents="none"
              />
            )
          })()}
        </g>
      </svg>

      {/* Baud playback transport */}
      {playing && (() => {
        const total = playBytesRef.current?.length ?? 0
        const secs = (n: number) => (n / BAUD_BYTES_PER_S).toFixed(1)
        return (
          <div style={{
            position: 'absolute', left: 12, right: 12, bottom: 34,
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(20,20,20,0.85)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '6px 12px',
          }}>
            <button
              className="icon-btn"
              onClick={() => {
                if (!playPaused && playPos >= total) setPlayPos(0) // replay from end
                setPlayPaused(p => !p)
              }}
              title={playPaused ? 'Resume' : 'Pause'}
            >{playPaused || playPos >= total ? '⏵' : '⏸'}</button>
            <input
              type="range"
              min={0} max={total} step={1}
              value={Math.floor(playPos)}
              onChange={e => { setPlayPaused(true); setPlayPos(Number(e.target.value)) }}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              {Math.floor(playPos).toLocaleString()} / {total.toLocaleString()} B · {secs(playPos)}s / {secs(total)}s @ 13k baud
            </span>
            <button className="icon-btn" onClick={() => onStopPlaying?.()} title="Stop">⏹</button>
          </div>
        )
      })()}

      {/* Rubber band overlay */}
      {rubber && (() => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              left: Math.min(rubber.sx, rubber.ex) - rect.left,
              top: Math.min(rubber.sy, rubber.ey) - rect.top,
              width: Math.abs(rubber.ex - rubber.sx),
              height: Math.abs(rubber.ey - rubber.sy),
              border: '1px dashed #0a84ff',
              background: 'rgba(10, 132, 255, 0.06)',
            }}
          />
        )
      })()}

      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        fontSize: 11, color: 'rgba(255,255,255,0.35)',
        pointerEvents: 'none',
      }}>
        {Math.round(zoom * 100)}%
        {isDragging && <span style={{ marginLeft: 8 }}>moving…</span>}
        {preview && <span style={{ marginLeft: 8, color: '#e6a23c' }}>TURSHOW preview</span>}
        {playing && <span style={{ marginLeft: 8, color: '#e6a23c' }}>baud playback</span>}
        {draft.length > 0 && <span style={{ marginLeft: 8 }}>{draft.length} pts — Enter/double-click to finish, Esc to cancel</span>}
      </div>
    </div>
  )
}

function zoomAround(t: Transform, cx: number, cy: number, factor: number, el: HTMLElement | null): Transform {
  if (!el) return t
  const rect = el.getBoundingClientRect()
  const px = cx || rect.width / 2
  const py = cy || rect.height / 2
  const newZoom = Math.max(0.05, Math.min(50, t.zoom * factor))
  return {
    zoom: newZoom,
    panX: px - (px - t.panX) * (newZoom / t.zoom),
    panY: py - (py - t.panY) * (newZoom / t.zoom),
  }
}
