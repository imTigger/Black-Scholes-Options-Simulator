import { useEffect, useRef, useState } from 'react'
import { fmtNum, fmtSignedPct } from '../lib/format'
import type { Quote } from '../lib/types'
import { searchSymbols, type SearchHit } from '../lib/yahoo'

interface Props {
  quote: Quote | null
  loading: boolean
  offline: boolean
  rate: number
  onRate: (r: number) => void
  onLoad: (symbol: string) => void
}

export default function TickerBar({ quote, loading, offline, rate, onRate, onLoad }: Props) {
  const [text, setText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = text.trim()
    if (q.length < 1) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      searchSymbols(q)
        .then((r) => {
          setHits(r)
          setHi(0)
          setOpen(true)
        })
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])

  const choose = (symbol: string) => {
    setOpen(false)
    setText('')
    onLoad(symbol)
  }

  return (
    <div className="ticker-bar">
      <div className="search" ref={boxRef}>
        <span className="glyph" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
        </span>
        <input
          value={text}
          placeholder="Search ticker — AAPL, SPY…"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHi((v) => Math.min(hits.length - 1, v + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((v) => Math.max(0, v - 1))
            } else if (e.key === 'Enter') {
              if (open && hits[hi]) choose(hits[hi].symbol)
              else if (text.trim()) choose(text.trim().toUpperCase())
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          aria-label="Search ticker symbol"
        />
        {open && hits.length > 0 && (
          <div className="search-pop">
            {hits.map((h, i) => (
              <button
                key={h.symbol}
                className={i === hi ? 'active' : ''}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(h.symbol)}
              >
                <span className="sym">{h.symbol}</span>
                <span className="nm">{h.name}</span>
                <span className="ex">{h.exchange}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <span className="spin" aria-label="Loading quote" />}

      {quote && (
        <div className="quote">
          <span className="qsym">{quote.symbol}</span>
          <span className="qname">{quote.name}</span>
          <span className="qpx">{fmtNum(quote.price, 2)}</span>
          <span className={`qchg ${quote.change >= 0 ? 'up' : 'down'}`}>
            {quote.change >= 0 ? '+' : ''}
            {fmtNum(quote.change, 2)} ({fmtSignedPct(quote.changePct)})
          </span>
        </div>
      )}

      {offline && <span className="badge-offline">Sample data</span>}

      <label className="rate-ctl">
        Risk-free rate
        <input
          type="number"
          step="0.1"
          value={+(rate * 100).toFixed(2)}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (Number.isFinite(v)) onRate(v / 100)
          }}
          aria-label="Risk-free rate percent"
        />
        %
      </label>
    </div>
  )
}
