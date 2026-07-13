import React, { useEffect, useRef, useState } from 'react'
import { snapToVgaHex } from '@lib/turshowSim'

// Swatch-only colour picker constrained to what NAPLPS-era hardware can show.
// No native <input type="color">: its UI is inherently full-gamut. Sections:
//  - the document's current palette (staying inside the 16-slot budget)
//  - the period default palette (RHINO defmap — what files without SET-COLOR get)
//  - a 6-level VGA colour cube + grey ramp for new colours (every swatch is a
//    legal 6-bit-per-channel DAC colour)
const PERIOD_DEFAULT = [
  '#000000', '#202020', '#404040', '#606060', '#808080', '#9f9f9f', '#bfbfbf', '#ffffff',
  '#0000df', '#9f00df', '#df0080', '#df4000', '#dfdf00', '#40df00', '#00df80', '#009fdf',
].map(snapToVgaHex)

const LEVELS = [0, 51, 102, 153, 204, 255]
const CUBE: string[] = []
for (const r of LEVELS) for (const g of LEVELS) for (const b of LEVELS) {
  CUBE.push(snapToVgaHex(`#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`))
}
const GREYS = Array.from({ length: 16 }, (_, i) =>
  snapToVgaHex(`#${[0, 0, 0].map(() => Math.round((i * 255) / 15).toString(16).padStart(2, '0')).join('')}`))

interface Props {
  value: string
  onChange: (hex: string) => void
  /** current document palette (hex), shown first */
  docPalette?: string[]
  /** which side the popover opens toward */
  side?: 'right' | 'left'
  size?: number
  title?: string
}

function Swatch({ hex, active, onPick, big }: { hex: string; active: boolean; onPick: (h: string) => void; big?: boolean }) {
  return (
    <button
      onClick={() => onPick(hex)}
      title={hex}
      style={{
        width: big ? 18 : 13, height: big ? 18 : 13, padding: 0,
        background: hex, borderRadius: 2,
        border: active ? '2px solid #0a84ff' : '1px solid rgba(255,255,255,0.25)',
        cursor: 'pointer',
      }}
    />
  )
}

export default function NapColorPicker({ value, onChange, docPalette = [], side = 'right', size = 28, title }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const pick = (h: string) => { onChange(h); setOpen(false) }
  const docUnique = [...new Set(docPalette)]

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={title ?? 'Colour (NAPLPS/VGA gamut only)'}
        style={{
          width: size, height: size * 0.92, padding: 2,
          background: value, borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.35)', cursor: 'pointer',
        }}
      />
      {open && (
        <div style={{
          position: 'absolute',
          top: 0,
          [side === 'right' ? 'left' : 'right']: size + 8,
          zIndex: 50,
          width: 262,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          padding: 10,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {docUnique.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
                Document palette ({docUnique.length}/16)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {docUnique.slice(0, 24).map(h => <Swatch key={'d' + h} hex={h} active={h === value} onPick={pick} big />)}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
              Period default palette
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {PERIOD_DEFAULT.map(h => <Swatch key={'p' + h} hex={h} active={h === value} onPick={pick} big />)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 4 }}>
              VGA colours
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(18, 13px)', gap: 1 }}>
              {CUBE.map((h, i) => <Swatch key={'c' + i + h} hex={h} active={h === value} onPick={pick} />)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 14px)', gap: 1, marginTop: 4 }}>
              {GREYS.map((h, i) => <Swatch key={'g' + i + h} hex={h} active={h === value} onPick={pick} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
