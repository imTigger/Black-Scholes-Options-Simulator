import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChainPanel from './components/ChainPanel'
import ForecastPanel from './components/ForecastPanel'
import LegsPanel from './components/LegsPanel'
import PayoffChart from './components/PayoffChart'
import StatBar from './components/StatBar'
import TickerBar from './components/TickerBar'
import { impliedVol } from './lib/blackScholes'
import { fetchCboeChain } from './lib/cboe'
import { fmtDateShortUTC } from './lib/format'
import { legExpiryClose, yearsBetween } from './lib/position'
import { sampleChain } from './lib/sampleData'
import { describePosition, legFromChain } from './lib/strategies'
import type { ChainOption, ChainSlice, Forecast, Leg, Quote } from './lib/types'
import { fetchChain } from './lib/yahoo'

const STORAGE_KEY = 'options-lab-v1'

type Source = 'cboe' | 'yahoo' | 'sample'

interface Persisted {
  symbol: string
  legs: Leg[]
  forecast: Forecast
  rate: number
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Persisted
    if (!p.symbol || !Array.isArray(p.legs)) return null
    return p
  } catch {
    return null
  }
}

export default function App() {
  const persisted = useRef(loadPersisted())
  const now = useMemo(() => Date.now(), [])

  const [symbol, setSymbol] = useState(persisted.current?.symbol ?? 'AAPL')
  const [source, setSource] = useState<Source | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [expirations, setExpirations] = useState<number[]>([])
  const [slices, setSlices] = useState<Record<number, ChainSlice>>({})
  const [activeExpiry, setActiveExpiry] = useState<number | null>(null)
  const [legs, setLegs] = useState<Leg[]>(persisted.current?.legs ?? [])
  const [rate, setRate] = useState(persisted.current?.rate ?? 0.045)
  const [forecast, setForecast] = useState<Forecast>(
    persisted.current?.forecast ?? { date: now, price: 0, ivShift: 0 },
  )
  const [loading, setLoading] = useState(false)
  const [chainLoading, setChainLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // When live data is unavailable, anchor the simulation on the forecast price
  // so restored positions still chart and price sensibly.
  const liveSpot = quote?.price ?? 0
  const spot = liveSpot > 0 ? liveSpot : forecast.price

  // Persisted forecast dates age out — never simulate into the past
  useEffect(() => {
    setForecast((f) => ({ ...f, date: Math.max(f.date, now) }))
  }, [now])

  useEffect(() => {
    const data: Persisted = { symbol, legs, forecast, rate }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [symbol, legs, forecast, rate])

  /** Deep-ITM contracts often come back with iv=0 — recover it from the mid price. */
  const sanitizeLegs = useCallback(
    (list: Leg[], spotPx: number): Leg[] =>
      list.map((leg) => {
        if (leg.iv > 0.005) return leg
        const T = yearsBetween(now, legExpiryClose(leg))
        const solved =
          leg.entryPrice > 0 && spotPx > 0
            ? impliedVol(leg.kind, leg.entryPrice, spotPx, leg.strike, T, rate)
            : null
        return { ...leg, iv: solved ?? 0.3 }
      }),
    [now, rate],
  )

  const applyLoaded = useCallback(
    (
      next: {
        quote: Quote
        expirations: number[]
        slices: Record<number, ChainSlice>
        source: Source
      },
      keepLegs: boolean,
    ) => {
      setQuote(next.quote)
      setExpirations(next.expirations)
      setSlices(next.slices)
      setSource(next.source)
      // Prefer an expiry with at least ~3h of life left; same-day chains near the
      // close are mostly stale zero-bids.
      const firstLive =
        next.expirations.find((e) => legExpiryClose({ expiry: e }) > now + 3 * 3600 * 1000) ??
        next.expirations[next.expirations.length - 1] ??
        null
      setActiveExpiry(firstLive)
      if (!keepLegs) {
        setLegs([])
        setForecast({ date: now, price: next.quote.price, ivShift: 0 })
      } else {
        setForecast((f) => ({ ...f, price: f.price > 0 ? f.price : next.quote.price }))
      }
    },
    [now],
  )

  const loadSymbol = useCallback(
    async (sym: string, keepLegs = false) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchCboeChain(sym)
        setSymbol(res.quote.symbol)
        applyLoaded({ ...res, source: 'cboe' }, keepLegs)
      } catch (cboeErr) {
        try {
          const res = await fetchChain(sym)
          setSymbol(res.quote.symbol)
          applyLoaded(
            {
              quote: res.quote,
              expirations: res.expirations,
              slices: { [res.slice.expiry]: res.slice },
              source: 'yahoo',
            },
            keepLegs,
          )
        } catch {
          setError(
            `Could not load live data for “${sym}” — ` +
              `${cboeErr instanceof Error ? cboeErr.message : cboeErr}. ` +
              'Check the ticker (US-listed, optionable), retry, or explore with sample data.',
          )
        }
      } finally {
        setLoading(false)
      }
    },
    [applyLoaded],
  )

  // Boot: restore last symbol, keeping restored legs
  useEffect(() => {
    void loadSymbol(symbol, (persisted.current?.legs.length ?? 0) > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadExpiry = useCallback(
    async (ms: number) => {
      if (slices[ms] || source !== 'yahoo') {
        if (slices[ms]) setActiveExpiry(ms)
        return
      }
      setChainLoading(true)
      try {
        const res = await fetchChain(symbol, ms)
        setSlices((s) => ({ ...s, [res.slice.expiry]: res.slice }))
        setActiveExpiry(res.slice.expiry)
        setQuote(res.quote)
      } catch {
        setError(`Could not load the ${fmtDateShortUTC(ms)} expiry. Try again.`)
      } finally {
        setChainLoading(false)
      }
    },
    [slices, source, symbol],
  )

  const useSample = useCallback(() => {
    const res = sampleChain()
    const all: Record<number, ChainSlice> = { [res.slice.expiry]: res.slice }
    for (const e of res.expirations) {
      if (!all[e]) all[e] = sampleChain(e).slice
    }
    setSymbol(res.quote.symbol)
    setError(null)
    applyLoaded({ quote: res.quote, expirations: res.expirations, slices: all, source: 'sample' }, false)
  }, [applyLoaded])

  const addLeg = useCallback(
    (opt: ChainOption, expiry: number, side: 1 | -1) => {
      setLegs((ls) => [...ls, ...sanitizeLegs([legFromChain(opt, expiry, side)], spot)])
    },
    [sanitizeLegs, spot],
  )

  const activeSlice = activeExpiry !== null ? (slices[activeExpiry] ?? null) : null
  const positionName = describePosition(legs)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="mark">
            options<span>·</span>lab
          </span>
          <span className="tag">Black-Scholes simulator</span>
        </div>
        <TickerBar
          quote={quote}
          loading={loading}
          offline={source === 'sample'}
          rate={rate}
          onRate={setRate}
          onLoad={(s) => void loadSymbol(s)}
        />
      </header>

      {error && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <span>
            <strong>Data unavailable.</strong> {error}
          </span>
          <button className="btn" onClick={() => void loadSymbol(symbol, true)}>
            Retry
          </button>
          <button className="btn primary" onClick={useSample}>
            Use sample data
          </button>
        </div>
      )}

      <div className="layout">
        <div className="col col-market">
          <ChainPanel
            expirations={expirations}
            activeExpiry={activeExpiry}
            slice={activeSlice}
            loading={chainLoading}
            spot={spot}
            onSelectExpiry={(ms) => void loadExpiry(ms)}
            onAddLeg={addLeg}
            onApplyPreset={(newLegs) => {
              setLegs(sanitizeLegs(newLegs, spot))
              setForecast({ date: now, price: spot, ivShift: 0 })
            }}
          />
        </div>

        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">Position</span>
              <span className="panel-sub">{positionName}</span>
            </div>
            <LegsPanel
              legs={legs}
              slices={slices}
              spot={spot}
              rate={rate}
              now={now}
              forecast={forecast}
              onChange={setLegs}
            />
          </section>

          <section className="panel chart-panel">
            <div className="panel-head">
              <span className="eyebrow">Payoff</span>
              <div className="chart-legend">
                <span className="li">
                  <span className="swatch" style={{ borderColor: 'var(--blue-chart)' }} />
                  At expiry
                </span>
                <span className="li">
                  <span className="swatch dashed" style={{ borderColor: 'var(--amber-chart)' }} />
                  On forecast date
                </span>
              </div>
            </div>
            <PayoffChart legs={legs} spot={spot} forecast={forecast} rate={rate} />
          </section>

          {legs.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <span className="eyebrow">Price forecast</span>
                <span className="panel-sub">what-if: time · price · volatility</span>
              </div>
              <ForecastPanel
                legs={legs}
                spot={spot}
                rate={rate}
                now={now}
                forecast={forecast}
                onChange={(patch) => setForecast((f) => ({ ...f, ...patch }))}
              />
            </section>
          )}

          <StatBar legs={legs} spot={spot} rate={rate} forecast={forecast} />
        </div>
      </div>
    </div>
  )
}
