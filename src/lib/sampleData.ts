import { bsPrice } from './blackScholes'
import type { ChainOption, OptionKind, Quote } from './types'
import type { ChainResult } from './yahoo'
import { MS_DAY } from './position'

/**
 * Synthetic chain used when live data is unreachable. A fictional ticker so it
 * can't be mistaken for a real quote: DEMO at $187.40 with a gentle vol smile.
 */
export function sampleChain(expiry?: number): ChainResult {
  const spot = 187.4
  const now = Date.now()
  const expirations = [7, 14, 28, 56, 91, 182, 365].map((d) => {
    const dt = new Date(now + d * MS_DAY)
    dt.setHours(16, 0, 0, 0)
    return dt.getTime()
  })
  const exp = expiry && expirations.includes(expiry) ? expiry : expirations[2]
  const T = Math.max(1 * MS_DAY, exp - now) / (365 * MS_DAY)

  const quote: Quote = {
    symbol: 'DEMO',
    name: 'Sample data (offline)',
    price: spot,
    change: 1.62,
    changePct: 0.0087,
    currency: 'USD',
    marketTime: now,
  }

  const strikes: number[] = []
  for (let k = 130; k <= 250; k += 5) strikes.push(k)

  const smile = (k: number) => {
    const m = Math.log(k / spot)
    return 0.24 + 0.35 * m * m + (m < 0 ? 0.1 * -m : 0)
  }

  const make = (kind: OptionKind, k: number): ChainOption => {
    const iv = smile(k)
    const mid = bsPrice(kind, spot, k, T, iv, 0.045)
    const spread = Math.max(0.02, mid * 0.03)
    return {
      contractSymbol: `DEMO-${kind === 'call' ? 'C' : 'P'}-${k}`,
      kind,
      strike: k,
      bid: Math.max(0, mid - spread / 2),
      ask: mid + spread / 2,
      last: mid,
      iv,
      volume: Math.round(2000 * Math.exp(-Math.abs(k - spot) / 15)),
      openInterest: Math.round(9000 * Math.exp(-Math.abs(k - spot) / 20)),
      inTheMoney: kind === 'call' ? k < spot : k > spot,
    }
  }

  return {
    quote,
    expirations,
    slice: {
      expiry: exp,
      calls: strikes.map((k) => make('call', k)),
      puts: strikes.map((k) => make('put', k)),
    },
  }
}
