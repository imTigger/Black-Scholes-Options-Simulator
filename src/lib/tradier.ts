import type { ChainOption, ChainSlice, Quote } from './types'
import type { ChainResult } from './yahoo'

/**
 * Tradier market data — the pure client-side source. Their API sends CORS
 * headers, so a static deployment can fetch chains directly from the browser
 * with a free personal token. Sandbox and production accept different tokens;
 * whichever answers first is remembered for the session.
 */
const BASES = ['https://api.tradier.com', 'https://sandbox.tradier.com']
let workingBase: string | null = null

async function tradierGet(path: string, token: string): Promise<any> {
  const bases = workingBase ? [workingBase] : BASES
  let lastErr: unknown = new Error('Tradier unreachable')
  for (const base of bases) {
    try {
      const res = await fetch(base + path, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token.trim()}` },
      })
      if (res.status === 401) {
        lastErr = new Error('Tradier rejected the token (401)')
        continue
      }
      if (!res.ok) {
        lastErr = new Error(`Tradier responded ${res.status}`)
        continue
      }
      workingBase = base
      return res.json()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/** "2026-08-21" → ms at midnight UTC (same convention as the other sources). */
function expiryMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function expiryStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
}

function asArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

export async function fetchTradierChain(
  symbol: string,
  token: string,
  expiry?: number,
): Promise<ChainResult> {
  const sym = symbol.trim().toUpperCase()
  const [quotesJson, expJson] = await Promise.all([
    tradierGet(`/v1/markets/quotes?symbols=${encodeURIComponent(sym)}`, token),
    tradierGet(
      `/v1/markets/options/expirations?symbol=${encodeURIComponent(sym)}&includeAllRoots=true&strikes=false`,
      token,
    ),
  ])

  const q = asArray<any>(quotesJson?.quotes?.quote)[0]
  if (!q?.symbol) throw new Error(`No quote for “${sym}”`)
  const dates: string[] = asArray<any>(expJson?.expirations?.date)
  if (!dates.length) throw new Error(`No option expirations for “${sym}”`)

  const expirations = dates.map(expiryMs).sort((a, b) => a - b)
  const chosen = expiry && expirations.includes(expiry) ? expiry : expirations[0]

  const chainJson = await tradierGet(
    `/v1/markets/options/chains?symbol=${encodeURIComponent(sym)}&expiration=${expiryStr(chosen)}&greeks=true`,
    token,
  )
  const rawOptions = asArray<any>(chainJson?.options?.option)

  const quote: Quote = {
    symbol: q.symbol,
    name: q.description || q.symbol,
    price: q.last ?? q.close ?? 0,
    change: q.change ?? 0,
    changePct: (q.change_percentage ?? 0) / 100,
    currency: 'USD',
    marketTime: (q.trade_date ?? 0) || Date.now(),
  }

  const slice: ChainSlice = { expiry: chosen, calls: [], puts: [] }
  for (const o of rawOptions) {
    const opt: ChainOption = {
      contractSymbol: o.symbol,
      kind: o.option_type === 'call' ? 'call' : 'put',
      strike: o.strike,
      bid: o.bid ?? 0,
      ask: o.ask ?? 0,
      last: o.last ?? 0,
      iv: o.greeks?.mid_iv ?? o.greeks?.smv_vol ?? 0,
      volume: o.volume ?? 0,
      openInterest: o.open_interest ?? 0,
      inTheMoney: o.option_type === 'call' ? o.strike < quote.price : o.strike > quote.price,
    }
    ;(opt.kind === 'call' ? slice.calls : slice.puts).push(opt)
  }
  slice.calls.sort((a, b) => a.strike - b.strike)
  slice.puts.sort((a, b) => a.strike - b.strike)

  return { quote, expirations, slice }
}
