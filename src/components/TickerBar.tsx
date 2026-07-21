import { useEffect, useRef, useState } from 'react'
import type { Source } from '../App'
import { fmtNum, fmtSignedPct } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { LANGS, type Lang } from '../lib/locales'
import type { Quote } from '../lib/types'
import { searchSymbols, type SearchHit } from '../lib/yahoo'

const SOURCE_LABELS: Record<Source, string> = {
  cboe: 'Cboe',
  yahoo: 'Yahoo',
  marketdata: 'MarketData',
  sample: 'sample',
}

interface Props {
  quote: Quote | null
  spot: number
  overridden: boolean
  loading: boolean
  offline: boolean
  rate: number
  marginPct: number
  sources: Source[]
  source: Source | null
  mdToken: string
  searchEnabled: boolean
  onSpot: (v: number) => void
  onResetSpot: () => void
  onSource: (s: Source) => void
  onMdToken: (t: string) => void
  onRate: (r: number) => void
  onMarginPct: (p: number) => void
  onLoad: (symbol: string) => void
}

export default function TickerBar({
  quote,
  spot,
  overridden,
  loading,
  offline,
  rate,
  marginPct,
  sources,
  source,
  mdToken,
  searchEnabled,
  onSpot,
  onResetSpot,
  onSource,
  onMdToken,
  onRate,
  onMarginPct,
  onLoad,
}: Props) {
  const { t, lang, setLang } = useI18n()
  const [text, setText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = text.trim()
    if (q.length < 1 || !searchEnabled) {
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
  }, [text, searchEnabled])

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
          placeholder={t('search.placeholder')}
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

      <select
        className="lang-select"
        value={source ?? 'marketdata'}
        onChange={(e) => onSource(e.target.value as Source)}
        aria-label={t('source.aria')}
        title={t('source.aria')}
      >
        {sources.map((s) => (
          <option key={s} value={s}>
            {s === 'sample' ? t('badge.sample') : SOURCE_LABELS[s]}
          </option>
        ))}
      </select>

      {source === 'marketdata' && (
        <input
          className="token-input"
          type="password"
          autoComplete="off"
          placeholder={t('md.tokenPh')}
          value={mdToken}
          onChange={(e) => onMdToken(e.target.value)}
          aria-label="marketdata.app API token"
        />
      )}

      {loading && <span className="spin" aria-label="Loading quote" />}

      {quote &&
        (() => {
          const prevClose = quote.price - quote.change
          const chg = overridden ? spot - prevClose : quote.change
          const pct = overridden
            ? prevClose > 0
              ? (spot - prevClose) / prevClose
              : 0
            : quote.changePct
          return (
            <div className="quote">
              <span className="qsym">{quote.symbol}</span>
              <span className="qname">{quote.name}</span>
              <input
                className={`qpx-input num ${overridden ? 'overridden' : ''}`}
                type="number"
                step="0.01"
                min={0}
                value={+spot.toFixed(2)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) onSpot(v)
                }}
                title={t('quote.override')}
                aria-label={t('quote.override')}
              />
              {overridden && (
                <button
                  className="qpx-reset"
                  onClick={onResetSpot}
                  title={t('quote.reset')}
                  aria-label={t('quote.reset')}
                >
                  ↺
                </button>
              )}
              <span className={`qchg ${chg >= 0 ? 'up' : 'down'}`}>
                {chg >= 0 ? '+' : ''}
                {fmtNum(chg, 2)} ({fmtSignedPct(pct)})
              </span>
            </div>
          )
        })()}

      {offline && <span className="badge-offline">{t('badge.sample')}</span>}

      <span className="rate-group">
        <label className="rate-ctl">
          {t('rate.label')}
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
        <label className="rate-ctl" title={t('margin.tooltip')}>
          {t('margin.label')}
          <input
            type="number"
            step="1"
            min={1}
            value={+(marginPct * 100).toFixed(1)}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v > 0) onMarginPct(v / 100)
            }}
            aria-label="Naked short margin percent of underlying"
          />
          %
        </label>
        <select
          className="lang-select"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          aria-label="Language"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}
