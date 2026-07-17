import type { ChainOption, ChainSlice, Quote } from './types'

/**
 * marketdata.app adapter — the pure client-side source. CORS is open
 * (Access-Control-Allow-Origin: *) and tokenless requests are served from
 * their cached/trial feed (HTTP 203). An optional API token lifts limits.
 */
const BASE = 'https://api.marketdata.app/v1'

function authHeaders(token?: string): HeadersInit {
  return token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}
}

async function getJson(path: string, token?: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', ...authHeaders(token) },
  })
  if (!res.ok && res.status !== 203) throw new Error(`marketdata.app responded ${res.status}`)
  const json = await res.json()
  if (json?.s === 'error') throw new Error(String(json.errmsg ?? 'marketdata.app error'))
  return json
}

/** "YYYY-MM-DD" → ms at midnight UTC (the app's expiry-key convention). */
function expiryMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export interface MarketdataResult {
  quote: Quote
  expirations: number[] // ms
  slice: ChainSlice
}

async function fetchQuote(symbol: string, token?: string): Promise<Quote | null> {
  try {
    const q = await getJson(`/stocks/quotes/${encodeURIComponent(symbol)}/`, token)
    const last = q.last?.[0] ?? q.mid?.[0] ?? 0
    if (!(last > 0)) return null
    return {
      symbol,
      name: 'marketdata.app delayed',
      price: last,
      change: q.change?.[0] ?? 0,
      changePct: q.changepct?.[0] ?? 0,
      currency: 'USD',
      marketTime: (q.updated?.[0] ?? 0) * 1000,
    }
  } catch {
    return null
  }
}

interface SliceResult {
  slice: ChainSlice
  underlyingPrice: number
}

export async function fetchMarketdataSlice(
  symbol: string,
  expiry: number,
  token?: string,
): Promise<SliceResult> {
  const c = await getJson(
    `/options/chain/${encodeURIComponent(symbol)}/?expiration=${msToDate(expiry)}`,
    token,
  )
  const n = c.optionSymbol?.length ?? 0
  if (!n) throw new Error(`No contracts for ${msToDate(expiry)}`)
  const spot = c.underlyingPrice?.[0] ?? 0
  const slice: ChainSlice = { expiry, calls: [], puts: [] }
  for (let i = 0; i < n; i++) {
    const kind = c.side[i] === 'call' ? 'call' : 'put'
    const strike = c.strike[i]
    const opt: ChainOption = {
      contractSymbol: c.optionSymbol[i],
      kind,
      strike,
      bid: c.bid?.[i] ?? 0,
      ask: c.ask?.[i] ?? 0,
      last: c.last?.[i] ?? 0,
      iv: c.iv?.[i] ?? 0,
      volume: c.volume?.[i] ?? 0,
      openInterest: c.openInterest?.[i] ?? 0,
      inTheMoney:
        c.inTheMoney?.[i] ?? (kind === 'call' ? strike < spot : strike > spot),
    }
    ;(kind === 'call' ? slice.calls : slice.puts).push(opt)
  }
  slice.calls.sort((a, b) => a.strike - b.strike)
  slice.puts.sort((a, b) => a.strike - b.strike)
  return { slice, underlyingPrice: spot }
}

/**
 * Quote + expirations + one expiry's chain. `expiry` (ms) targets a specific
 * expiration; omitted, the first one with more than ~3h of life is loaded.
 */
export async function fetchMarketdataChain(
  symbol: string,
  expiry?: number,
  token?: string,
): Promise<MarketdataResult> {
  const sym = symbol.trim().toUpperCase()
  const [exps, quote] = await Promise.all([
    getJson(`/options/expirations/${encodeURIComponent(sym)}/`, token),
    fetchQuote(sym, token),
  ])
  const expirations: number[] = (exps.expirations ?? []).map(expiryMs)
  if (!expirations.length) throw new Error(`No option data for “${sym}”`)

  const target =
    expiry && expirations.includes(expiry)
      ? expiry
      : (expirations.find((e) => e + 21 * 3600 * 1000 > Date.now() + 3 * 3600 * 1000) ??
        expirations[expirations.length - 1])
  const { slice, underlyingPrice } = await fetchMarketdataSlice(sym, target, token)

  return {
    quote: quote ?? {
      symbol: sym,
      name: 'marketdata.app delayed',
      price: underlyingPrice,
      change: 0,
      changePct: 0,
      currency: 'USD',
      marketTime: 0,
    },
    expirations,
    slice,
  }
}

/** True when the dev/preview proxy (Cboe & Yahoo routes) answers with JSON. */
export async function probeProxy(): Promise<boolean> {
  try {
    const res = await fetch('/api/cboe/SPY.json', {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    })
    return res.ok && (res.headers.get('content-type') ?? '').includes('json')
  } catch {
    return false
  }
}
