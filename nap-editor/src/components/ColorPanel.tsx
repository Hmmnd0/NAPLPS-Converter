import React, { useMemo, useState, useRef, useEffect } from 'react'
import { dpSimplify } from '@lib/regionTrace'
import type { NapShape } from '@lib/naplps-std-decoder'
import type { NapText } from '@lib/naplps-std-encoder'

// Simplify tolerance is shown in "pixels" of a 640px-wide display; shape
// coordinates are 0..1 field units.
const FIELD_PX = 1 / 640

function hexColor(c: { r: number; g: number; b: number }): string {
  return `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`
}

function colorKey(c: { r: number; g: number; b: number }): string {
  return `${c.r},${c.g},${c.b}`
}

interface PaletteEntry {
  key: string
  color: { r: number; g: number; b: number }
  count: number
  indices: number[]
}

interface Props {
  shapes: NapShape[]
  selectedIds: Set<number>
  onSelect: (ids: Set<number>) => void
  onDelete: () => void
  onMerge: () => void
  onRecolor: (r: number, g: number, b: number) => void
  onSortByColor: () => void
  /** tolerance in field units (0..1 space) */
  onSimplify: (tolerance: number) => void
  onConvertToLines: () => void
  onReorder: (where: 'back' | 'front' | 'down' | 'up') => void
  texts: NapText[]
  selectedText: number | null
  onSelectText: (i: number | null) => void
  onUpdateText: (i: number, patch: Partial<NapText>) => void
  onDeleteText: (i: number) => void
}

export default function ColorPanel({
  shapes, selectedIds, onSelect, onDelete, onMerge, onRecolor, onSortByColor, onSimplify, onConvertToLines, onReorder,
  texts, selectedText, onSelectText, onUpdateText, onDeleteText,
}: Props) {
  const [recolorHex, setRecolorHex] = useState('#ffffff')
  const [simplifyPx, setSimplifyPx] = useState(1)
  const [tab, setTab] = useState<'colors' | 'shapes'>('colors')
  const selectedListRef = useRef<HTMLDivElement>(null)

  // Scroll the shapes list to keep the first selected item visible
  useEffect(() => {
    if (tab !== 'shapes') return
    const firstSel = selectedIds.size ? Math.min(...selectedIds) : -1
    if (firstSel < 0) return
    const el = selectedListRef.current?.querySelector(`[data-shape="${firstSel}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIds, tab])

  const palette = useMemo<PaletteEntry[]>(() => {
    const map = new Map<string, PaletteEntry>()
    shapes.forEach((s, i) => {
      const k = colorKey(s.color)
      if (!map.has(k)) map.set(k, { key: k, color: s.color, count: 0, indices: [] })
      const e = map.get(k)!
      e.count++
      e.indices.push(i)
    })
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [shapes])

  const selCount = selectedIds.size

  // Live preview of what the current tolerance would do to the selection.
  const simplifyPreview = useMemo(() => {
    if (!selCount) return null
    let before = 0, after = 0
    shapes.forEach((s, i) => {
      if (!selectedIds.has(i)) return
      before += s.points.length
      if (s.points.length <= 3) { after += s.points.length; return }
      const pts = dpSimplify(s.points, simplifyPx * FIELD_PX)
      after += pts.length >= 3 ? pts.length : s.points.length
    })
    return { before, after }
  }, [shapes, selectedIds, selCount, simplifyPx])

  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    if (!m) return null
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
  }

  return (
    <div style={{
      width: 220,
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Selection summary */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
          {selCount === 0
            ? `${shapes.length} shapes total`
            : `${selCount} selected of ${shapes.length}`}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={onDelete}
            disabled={selCount === 0}
            className="danger"
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            Delete
          </button>
          <button
            onClick={onMerge}
            disabled={selCount < 2}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            Merge
          </button>
          <button
            onClick={onSortByColor}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            Sort by color
          </button>
          <button
            onClick={onConvertToLines}
            disabled={selCount === 0}
            title="Turn filled shapes into 1px closed line loops (SET&LINE). Best for straight strokes — TURSHOW draws tight curves dashed."
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            To lines
          </button>
        </div>
        {/* Draw order: shapes later in the file draw later = on top */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Draw order
          </span>
          <button onClick={() => onReorder('back')} disabled={selCount === 0} title="Draw first — bottom of the stack, everything else paints over it" style={{ fontSize: 11, padding: '3px 8px' }}>⤒</button>
          <button onClick={() => onReorder('down')} disabled={selCount === 0} title="Draw one step earlier" style={{ fontSize: 11, padding: '3px 8px' }}>↑</button>
          <button onClick={() => onReorder('up')} disabled={selCount === 0} title="Draw one step later" style={{ fontSize: 11, padding: '3px 8px' }}>↓</button>
          <button onClick={() => onReorder('front')} disabled={selCount === 0} title="Draw last — top of the stack, paints over everything" style={{ fontSize: 11, padding: '3px 8px' }}>⤓</button>
        </div>
      </div>

      {/* Recolor */}
      {selCount > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Recolor selected
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={recolorHex}
              onChange={e => setRecolorHex(e.target.value)}
              style={{ width: 32, height: 28, padding: 2 }}
            />
            <button
              className="primary"
              style={{ fontSize: 11, padding: '3px 10px', flex: 1 }}
              onClick={() => {
                const rgb = hexToRgb(recolorHex)
                if (rgb) onRecolor(rgb.r, rgb.g, rgb.b)
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Simplify */}
      {selCount > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Simplify selected
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="range"
              min={0.25} max={4} step={0.25}
              value={simplifyPx}
              onChange={e => setSimplifyPx(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 34, textAlign: 'right' }}>{simplifyPx.toFixed(2)}px</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flex: 1 }}>
              {simplifyPreview ? `${simplifyPreview.before.toLocaleString()} → ${simplifyPreview.after.toLocaleString()} vertices` : ''}
            </span>
            <button
              className="primary"
              style={{ fontSize: 11, padding: '3px 10px' }}
              disabled={!simplifyPreview || simplifyPreview.after >= simplifyPreview.before}
              onClick={() => onSimplify(simplifyPx * FIELD_PX)}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Font-text blocks */}
      {texts.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Text blocks ({texts.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {texts.map((t, i) => (
              <button
                key={i}
                onClick={() => onSelectText(selectedText === i ? null : i)}
                style={{
                  fontSize: 10, padding: '2px 8px', maxWidth: 120,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  background: selectedText === i ? 'var(--accent)' : undefined,
                  color: selectedText === i ? '#fff' : undefined,
                }}
              >
                {t.lines[0] || '(empty)'}
              </button>
            ))}
          </div>
          {selectedText !== null && texts[selectedText] && (() => {
            const t = texts[selectedText]
            const hx = (c?: { r: number; g: number; b: number }) => hexColor(c ?? { r: 255, g: 255, b: 255 })
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={t.lines.join('\n')}
                  onChange={e => onUpdateText(selectedText, { lines: e.target.value.split('\n') })}
                  rows={Math.min(6, Math.max(2, t.lines.length))}
                  style={{ fontSize: 11, fontFamily: 'monospace', resize: 'vertical', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: 4 }}
                />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
                  W
                  <input
                    type="range" min={0.008} max={0.04} step={0.0005}
                    value={t.charW ?? 0.0145}
                    onChange={e => onUpdateText(selectedText, { charW: Number(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  H
                  <input
                    type="range" min={0.014} max={0.07} step={0.001}
                    value={t.charH ?? 0.028}
                    onChange={e => onUpdateText(selectedText, { charH: Number(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="color"
                    value={hx(t.color)}
                    onChange={e => {
                      const m = hexToRgb(e.target.value)
                      if (m) onUpdateText(selectedText, { color: m })
                    }}
                    style={{ width: 24, height: 20, padding: 1 }}
                  />
                  <button className="danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => onDeleteText(selectedText)}>✕</button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['colors', 'shapes'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: 11,
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t === 'colors' ? `Colors (${palette.length})` : `Shapes (${shapes.length})`}
          </button>
        ))}
      </div>

      {/* Colors tab */}
      {tab === 'colors' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {palette.map(entry => {
            const allSelected = entry.indices.every(i => selectedIds.has(i))
            const someSelected = entry.indices.some(i => selectedIds.has(i))
            return (
              <div
                key={entry.key}
                onClick={e => {
                  if (e.shiftKey) {
                    const next = new Set(selectedIds)
                    if (allSelected) entry.indices.forEach(i => next.delete(i))
                    else entry.indices.forEach(i => next.add(i))
                    onSelect(next)
                  } else {
                    onSelect(allSelected ? new Set() : new Set(entry.indices))
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 12px', cursor: 'pointer',
                  background: allSelected ? 'rgba(10,132,255,0.2)' : someSelected ? 'rgba(10,132,255,0.08)' : 'transparent',
                  borderLeft: allSelected ? '2px solid var(--accent)' : someSelected ? '2px solid rgba(10,132,255,0.4)' : '2px solid transparent',
                }}
              >
                <span className="swatch" style={{ background: hexColor(entry.color), width: 16, height: 16, borderRadius: 3 }} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', flex: 1 }}>{hexColor(entry.color)}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.count}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Shapes tab */}
      {tab === 'shapes' && (
        <div ref={selectedListRef} style={{ flex: 1, overflowY: 'auto' }}>
          {shapes.map((shape, i) => {
            const sel = selectedIds.has(i)
            return (
              <div
                key={i}
                data-shape={i}
                onClick={e => {
                  if (e.shiftKey) {
                    const next = new Set(selectedIds)
                    if (sel) { next.delete(i) } else { next.add(i) }
                    onSelect(next)
                  } else {
                    onSelect(sel && selectedIds.size === 1 ? new Set() : new Set([i]))
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 12px', cursor: 'pointer',
                  background: sel ? 'rgba(10,132,255,0.2)' : 'transparent',
                  borderLeft: sel ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <span className="swatch" style={{ background: hexColor(shape.color), width: 12, height: 12, borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>#{i}</span>
                <span style={{ fontSize: 10, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shape.type}{shape.type === 'polygon' ? ` ${shape.points.length}v` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
