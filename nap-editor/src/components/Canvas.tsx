import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'
import type { NapShape } from '@lib/naplps-std-decoder'

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
}

export default function Canvas({ shapes, selectedIds, onSelect, onMove, handle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tf, setTf] = useState<Transform>({ zoom: 1, panX: 0, panY: 0 })
  const [rubber, setRubber] = useState<RubberBand | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null)

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
  const pointerMode = useRef<'none' | 'pan' | 'drag' | 'rubber'>('none')

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
  }, [rubber]) // rubber in dep so onUp closure sees latest rubber for the rubber-band case

  const onSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || spaceHeld) {
      e.preventDefault()
      pointerMode.current = 'pan'
      panStart.current = { mx: e.clientX, my: e.clientY, panX: tfRef.current.panX, panY: tfRef.current.panY }
      return
    }
    if (e.button !== 0) return

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

    // Clicked background → rubber band
    if (!e.shiftKey) onSelect(new Set())
    pointerMode.current = 'rubber'
    setRubber({ sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY })
  }, [spaceHeld, selectedIds, onSelect, shapes])

  const { zoom, panX, panY } = tf
  const isDragging = dragOffset !== null
  const cursor = spaceHeld
    ? (pointerMode.current === 'pan' ? 'grabbing' : 'grab')
    : isDragging ? 'move' : 'default'

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor, background: '#111' }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ display: 'block', position: 'absolute', inset: 0 }}
        onMouseDown={onSvgMouseDown}
      >
        <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
          <rect x={0} y={0} width={NW} height={NH} fill="#000" />

          {shapes.map((shape, i) => {
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
        </g>
      </svg>

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
