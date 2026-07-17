export type OptionKind = 'call' | 'put'

export interface Leg {
  id: string
  kind: OptionKind
  side: 1 | -1 // +1 long, -1 short
  qty: number // contracts
  strike: number
  expiry: number // ms epoch at market close on expiration day
  iv: number // implied volatility, decimal (0.25 = 25%)
  entryPrice: number // premium per share paid/received at entry
  contractSymbol?: string
}

export interface Quote {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  currency: string
  marketTime: number
}

export interface ChainOption {
  contractSymbol: string
  kind: OptionKind
  strike: number
  bid: number
  ask: number
  last: number
  iv: number // decimal
  volume: number
  openInterest: number
  inTheMoney: boolean
}

export interface ChainSlice {
  expiry: number // ms
  calls: ChainOption[]
  puts: ChainOption[]
}

export interface Forecast {
  date: number // ms epoch — "when"
  price: number // forecast underlying price
  ivShift: number // relative shift applied to every leg's IV: 0.1 = +10%
}

export const CONTRACT_MULTIPLIER = 100

export function midPrice(o: ChainOption): number {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2
  return o.last > 0 ? o.last : Math.max(o.bid, o.ask, 0)
}
