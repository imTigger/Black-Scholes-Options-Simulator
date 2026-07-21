import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChainPanel from './components/ChainPanel'
import ForecastPanel from './components/ForecastPanel'
import FullChainModal from './components/FullChainModal'
import LegsPanel from './components/LegsPanel'
import PayoffChart from './components/PayoffChart'
import StatBar from './components/StatBar'
import TickerBar from './components/TickerBar'
import { impliedVol } from './lib/blackScholes'
import { fetchCboeChain } from './lib/cboe'
import { fmtDateShortUTC } from './lib/format'
import { useI18n } from './lib/i18n'
import {
  fetchMarketdataChain,
  fetchMarketdataSlice,
  probeProxy,
} from './lib/marketdata'
import { legExpiryClose, yearsBetween } from './lib/position'
import { sampleChain } from './lib/sampleData'
import { describePosition, legFromChain } from './lib/strategies'
import type { ChainOption, ChainSlice, Forecast, Leg, Quote } from './lib/types'
import { fetchChain } from './lib/yahoo'

const STORAGE_KEY = 'options-lab-v1'

export type Source = 'cboe' | 'yahoo' | 'marketdata' | 'sample'

interface Persisted {
  symbol: string
  legs: Leg[]
  forecast: Forecast
  rate: number
  marginPct?: number
  source?: Source
  mdToken?: string
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
  const { t, tStrat } = useI18n()
  const persisted = useRef(loadPersisted())
  const now = useMemo(() => Date.now(), [])

  const [symbol, setSymbol] = useState(persisted.current?.symbol ?? 'AAPL')
  const [source, setSource] = useState<Source | null>(null)
  const [proxyAvailable, setProxyAvailable] = useState<boolean | null>(null)
  const [mdToken, setMdToken] = useState(persisted.current?.mdToken ?? '')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [expirations, setExpirations] = useState<number[]>([])
  const [slices, setSlices] = useState<Record<number, ChainSlice>>({})
  const [activeExpiry, setActiveExpiry] = useState<number | null>(null)
  const [legs, setLegs] = useState<Leg[]>(persisted.current?.legs ?? [])
  const [rate, setRate] = useState(persisted.current?.rate ?? 0.045)
  const [marginPct, setMarginPct] = useState(persisted.current?.marginPct ?? 0.2)
  const [forecast, setForecast] = useState<Forecast>(
    persisted.current?.forecast ?? { date: now, price: 0, ivShift: 0 },
  )
  const [loading, setLoading] = useState(false)
  const [chainLoading, setChainLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullOpen, setFullOpen] = useState(false)

  // When live data is unavailable, anchor the simulation on the forecast price
  // so restored positions still chart and price sensibly.
  const liveSpot = quote?.price ?? 0
  const spot = liveSpot > 0 ? liveSpot : forecast.price

  // Persisted forecast dates age out — never simulate into the past
  useEffect(() => {
    setForecast((f) => ({ ...f, date: Math.max(f.date, now) }))
  }, [now])

  useEffect(() => {
    const data: Persisted = {
      symbol,
      legs,
      forecast,
      rate,
      marginPct,
      source: source ?? undefined,
      mdToken: mdToken || undefined,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [symbol, legs, forecast, rate, marginPct, source, mdToken])

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

  const useSample = useCallback(() => {
    const res = sampleChain()
    const all: Record<number, ChainSlice> = { [res.slice.expiry]: res.slice }
    for (const e of res.expirations) {
      if (!all[e]) all[e] = sampleChain(e).slice
    }
    setSymbol(res.quote.symbol)
    setError(null)
    applyLoaded(
      { quote: res.quote, expirations: res.expirations, slices: all, source: 'sample' },
      false,
    )
  }, [applyLoaded])

  const loadSymbol = useCallback(
    async (sym: string, keepLegs = false, src?: Source) => {
      const from = src ?? source ?? 'marketdata'
      if (from === 'sample') {
        useSample()
        return
      }
      setLoading(true)
      setError(null)
      try {
        if (from === 'cboe') {
          const res = await fetchCboeChain(sym)
          setSymbol(res.quote.symbol)
          applyLoaded({ ...res, source: 'cboe' }, keepLegs)
        } else if (from === 'yahoo') {
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
        } else {
          const res = await fetchMarketdataChain(sym, undefined, mdToken)
          setSymbol(res.quote.symbol)
          applyLoaded(
            {
              quote: res.quote,
              expirations: res.expirations,
              slices: { [res.slice.expiry]: res.slice },
              source: 'marketdata',
            },
            keepLegs,
          )
        }
      } catch (err) {
        setError(
          t('error.body', { sym, msg: String(err instanceof Error ? err.message : err) }),
        )
      } finally {
        setLoading(false)
      }
    },
    [applyLoaded, t, source, mdToken, useSample],
  )

  // Boot: detect whether the proxy routes exist, pick a source, restore state
  useEffect(() => {
    void (async () => {
      const hasProxy = await probeProxy()
      setProxyAvailable(hasProxy)
      const saved = persisted.current?.source
      const src: Source =
        saved && (hasProxy || saved === 'marketdata' || saved === 'sample')
          ? saved
          : hasProxy
            ? 'cboe'
            : 'marketdata'
      setSource(src)
      void loadSymbol(symbol, (persisted.current?.legs.length ?? 0) > 0, src)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadExpiry = useCallback(
    async (ms: number) => {
      if (slices[ms]) {
        setActiveExpiry(ms)
        return
      }
      if (source !== 'yahoo' && source !== 'marketdata') return
      setChainLoading(true)
      try {
        if (source === 'yahoo') {
          const res = await fetchChain(symbol, ms)
          setSlices((s) => ({ ...s, [res.slice.expiry]: res.slice }))
          setActiveExpiry(res.slice.expiry)
          setQuote(res.quote)
        } else {
          const { slice } = await fetchMarketdataSlice(symbol, ms, mdToken)
          setSlices((s) => ({ ...s, [slice.expiry]: slice }))
          setActiveExpiry(slice.expiry)
        }
      } catch {
        setError(t('error.expiry', { date: fmtDateShortUTC(ms) }))
      } finally {
        setChainLoading(false)
      }
    },
    [slices, source, symbol, mdToken, t],
  )

  // Load a slice into `slices` without changing the active expiry — used by the
  // full-chain modal to lazily fill in expirations on demand.
  const ensureExpiryLoaded = useCallback(
    async (ms: number) => {
      if (slices[ms]) return
      if (source === 'yahoo') {
        const res = await fetchChain(symbol, ms)
        setSlices((s) => ({ ...s, [res.slice.expiry]: res.slice }))
      } else if (source === 'marketdata') {
        const { slice } = await fetchMarketdataSlice(symbol, ms, mdToken)
        setSlices((s) => ({ ...s, [slice.expiry]: slice }))
      }
      // cboe / sample already hold every expiry
    },
    [slices, source, symbol, mdToken],
  )

  const changeSource = useCallback(
    (src: Source) => {
      setSource(src)
      if (src === 'sample') {
        useSample()
      } else {
        const sym = symbol === 'DEMO' ? 'AAPL' : symbol
        void loadSymbol(sym, true, src)
      }
    },
    [symbol, loadSymbol, useSample],
  )

  const addLeg = useCallback(
    (opt: ChainOption, expiry: number, side: 1 | -1) => {
      setLegs((ls) => [...ls, ...sanitizeLegs([legFromChain(opt, expiry, side)], spot)])
    },
    [sanitizeLegs, spot],
  )

  const activeSlice = activeExpiry !== null ? (slices[activeExpiry] ?? null) : null
  const positionName = describePosition(legs)
  const availableSources: Source[] =
    proxyAvailable === true
      ? ['cboe', 'yahoo', 'marketdata', 'sample']
      : ['marketdata', 'sample']

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="mark">
            options<span>·</span>lab
          </span>
          <span className="tag">{t('tagline')}</span>
        </div>
        <TickerBar
          quote={quote}
          loading={loading}
          offline={source === 'sample'}
          rate={rate}
          marginPct={marginPct}
          sources={availableSources}
          source={source}
          mdToken={mdToken}
          searchEnabled={proxyAvailable === true}
          onSource={changeSource}
          onMdToken={setMdToken}
          onRate={setRate}
          onMarginPct={setMarginPct}
          onLoad={(s) => void loadSymbol(s)}
        />
      </header>

      {error && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <span>
            <strong>{t('error.title')}</strong> {error}
          </span>
          <button className="btn" onClick={() => void loadSymbol(symbol, true)}>
            {t('btn.retry')}
          </button>
          <button className="btn primary" onClick={useSample}>
            {t('btn.sample')}
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
            onOpenFull={() => setFullOpen(true)}
          />
        </div>

        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">{t('panel.position')}</span>
              <span className="panel-sub">{tStrat(positionName)}</span>
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
              <span className="eyebrow">{t('panel.payoff')}</span>
              <div className="chart-legend">
                <span className="li">
                  <span className="swatch" style={{ borderColor: 'var(--blue-chart)' }} />
                  {t('legend.expiry')}
                </span>
                <span className="li">
                  <span className="swatch dashed" style={{ borderColor: 'var(--amber-chart)' }} />
                  {t('legend.forecast')}
                </span>
              </div>
            </div>
            <PayoffChart legs={legs} spot={spot} forecast={forecast} rate={rate} />
          </section>

          {legs.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <span className="eyebrow">{t('panel.forecast')}</span>
                <span className="panel-sub">{t('panel.forecast.sub')}</span>
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

          <StatBar
            legs={legs}
            spot={spot}
            rate={rate}
            marginPct={marginPct}
            forecast={forecast}
          />
        </div>
      </div>

      <footer className="footer">
        <a
          href="https://github.com/imTigger/Black-Scholes-Options-Simulator"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          {t('footer.source')}
        </a>
        <span className="dot">·</span>
        <a
          href="https://github.com/imTigger/Black-Scholes-Options-Simulator/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
        >
          MIT License
        </a>
      </footer>

      {fullOpen && (
        <FullChainModal
          symbol={symbol}
          expirations={expirations}
          slices={slices}
          spot={spot}
          rate={rate}
          now={now}
          legs={legs}
          onEnsureExpiry={ensureExpiryLoaded}
          onAddLeg={addLeg}
          onSetLegs={setLegs}
          onRefresh={() => void loadSymbol(symbol, true)}
          onClose={() => setFullOpen(false)}
        />
      )}
    </div>
  )
}
