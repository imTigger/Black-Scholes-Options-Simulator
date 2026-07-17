import type { ChainOption, ChainSlice, Quote } from './types'

export interface FullChain {
  quote: Quote
  expirations: number[] // ms, midnight UTC (same convention as Yahoo)
  slices: Record<number, ChainSlice>
}

interface CboeOption {
  option: string // OCC symbol, e.g. AAPL261120P00160000
  bid: number
  ask: number
  iv: number
  open_interest: number
  volume: number
  last_trade_price: number | null
}

// OCC symbol: root + yymmdd + C|P + strike×1000 padded to 8 digits
const OCC_RE = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/

async function fetchRaw(symbol: string): Promise<any> {
  const res = await fetch(`/api/cboe/${encodeURIComponent(symbol)}.json`)
  if (!res.ok) throw new Error(`Cboe responded ${res.status}`)
  return res.json()
}

export async function fetchCboeChain(symbol: string): Promise<FullChain> {
  const sym = symbol.trim().toUpperCase()
  let json: any
  try {
    json = await fetchRaw(sym)
  } catch (first) {
    // Indexes (SPX, VIX, …) live under an underscore prefix
    try {
      json = await fetchRaw(`_${sym}`)
    } catch {
      throw first
    }
  }
  const d = json?.data
  if (!d?.options?.length) throw new Error(`No option data for “${sym}”`)

  const quote: Quote = {
    symbol: d.symbol?.replace(/^_/, '') ?? sym,
    name: d.security_type === 'index' ? 'Index · Cboe delayed' : 'Cboe delayed quotes',
    price: d.current_price ?? 0,
    change: d.price_change ?? 0,
    changePct: (d.price_change_percent ?? 0) / 100,
    currency: 'USD',
    marketTime: d.last_trade_time ? Date.parse(d.last_trade_time) : 0,
  }

  const slices: Record<number, ChainSlice> = {}
  for (const raw of d.options as CboeOption[]) {
    const m = OCC_RE.exec(raw.option)
    if (!m) continue
    const [, , yy, mm, dd, cp, strikeRaw] = m
    const expiry = Date.UTC(2000 + +yy, +mm - 1, +dd)
    const strike = +strikeRaw / 1000
    const opt: ChainOption = {
      contractSymbol: raw.option,
      kind: cp === 'C' ? 'call' : 'put',
      strike,
      bid: raw.bid ?? 0,
      ask: raw.ask ?? 0,
      last: raw.last_trade_price ?? 0,
      iv: raw.iv ?? 0,
      volume: raw.volume ?? 0,
      openInterest: raw.open_interest ?? 0,
      inTheMoney: cp === 'C' ? strike < quote.price : strike > quote.price,
    }
    const slice = (slices[expiry] ??= { expiry, calls: [], puts: [] })
    ;(opt.kind === 'call' ? slice.calls : slice.puts).push(opt)
  }

  const expirations = Object.keys(slices)
    .map(Number)
    .sort((a, b) => a - b)
  for (const e of expirations) {
    slices[e].calls.sort((a, b) => a.strike - b.strike)
    slices[e].puts.sort((a, b) => a.strike - b.strike)
  }
  if (!expirations.length) throw new Error(`No parsable contracts for “${sym}”`)
  return { quote, expirations, slices }
}
