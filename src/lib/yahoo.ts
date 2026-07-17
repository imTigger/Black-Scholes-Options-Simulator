import type { ChainOption, ChainSlice, OptionKind, Quote } from './types'

interface RawOption {
  contractSymbol: string
  strike: number
  bid?: number
  ask?: number
  lastPrice?: number
  impliedVolatility?: number
  volume?: number
  openInterest?: number
  inTheMoney?: boolean
}

export interface ChainResult {
  quote: Quote
  expirations: number[] // ms
  slice: ChainSlice
}

function toChainOption(kind: OptionKind, raw: RawOption): ChainOption {
  return {
    contractSymbol: raw.contractSymbol,
    kind,
    strike: raw.strike,
    bid: raw.bid ?? 0,
    ask: raw.ask ?? 0,
    last: raw.lastPrice ?? 0,
    iv: raw.impliedVolatility ?? 0,
    volume: raw.volume ?? 0,
    openInterest: raw.openInterest ?? 0,
    inTheMoney: raw.inTheMoney ?? false,
  }
}

/**
 * Fetch quote + option chain for one expiry. `expiry` in ms; omit for the
 * nearest expiration. Yahoo expiration timestamps are kept as-is (seconds→ms).
 */
export async function fetchChain(symbol: string, expiry?: number): Promise<ChainResult> {
  const dateParam = expiry ? `?date=${Math.floor(expiry / 1000)}` : ''
  const res = await fetch(`/api/yahoo/v7/finance/options/${encodeURIComponent(symbol)}${dateParam}`)
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`)
  const json = await res.json()
  const result = json?.optionChain?.result?.[0]
  if (!result?.quote) throw new Error(`No option data for “${symbol}”`)

  const q = result.quote
  const quote: Quote = {
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePct: (q.regularMarketChangePercent ?? 0) / 100,
    currency: q.currency || 'USD',
    marketTime: (q.regularMarketTime ?? 0) * 1000,
  }

  const expirations: number[] = (result.expirationDates ?? []).map((s: number) => s * 1000)
  const opt = result.options?.[0]
  const slice: ChainSlice = {
    expiry: (opt?.expirationDate ?? 0) * 1000,
    calls: (opt?.calls ?? []).map((c: RawOption) => toChainOption('call', c)),
    puts: (opt?.puts ?? []).map((p: RawOption) => toChainOption('put', p)),
  }
  return { quote, expirations, slice }
}

export interface SearchHit {
  symbol: string
  name: string
  exchange: string
}

export async function searchSymbols(query: string): Promise<SearchHit[]> {
  const res = await fetch(
    `/api/yahoo/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`,
  )
  if (!res.ok) return []
  const json = await res.json()
  return (json?.quotes ?? [])
    .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
    .map((q: any) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchDisp || q.exchange || '',
    }))
}
