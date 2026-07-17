import { bsGreeks, bsPrice, intrinsic } from './blackScholes'
import { CONTRACT_MULTIPLIER, type Leg } from './types'

export const MS_YEAR = 365 * 24 * 3600 * 1000
export const MS_DAY = 24 * 3600 * 1000

/**
 * Leg.expiry stores Yahoo's raw expiration stamp (midnight UTC of the expiry
 * date). Contracts actually die at the 4pm ET close, ~21h later — pricing uses
 * this adjusted instant so expiry-day forecasts keep a few hours of time value.
 */
export function legExpiryClose(leg: Pick<Leg, 'expiry'>): number {
  return leg.expiry + 21 * 3600 * 1000
}

export function yearsBetween(from: number, to: number): number {
  return Math.max(0, to - from) / MS_YEAR
}

export function shiftedIv(iv: number, ivShift: number): number {
  return Math.max(0.001, iv * (1 + ivShift))
}

/** Model price per share of one leg at time `at` and spot `S`. */
export function legPrice(leg: Leg, S: number, at: number, ivShift: number, r: number): number {
  const T = yearsBetween(at, legExpiryClose(leg))
  if (T <= 0) return intrinsic(leg.kind, S, leg.strike)
  return bsPrice(leg.kind, S, leg.strike, T, shiftedIv(leg.iv, ivShift), r)
}

/** Mark value of the whole position in dollars (signed by side). */
export function positionValue(
  legs: Leg[],
  S: number,
  at: number,
  ivShift: number,
  r: number,
): number {
  return legs.reduce(
    (sum, leg) =>
      sum + leg.side * leg.qty * CONTRACT_MULTIPLIER * legPrice(leg, S, at, ivShift, r),
    0,
  )
}

/** Net entry cost in dollars: positive = debit paid, negative = credit received. */
export function positionCost(legs: Leg[]): number {
  return legs.reduce(
    (sum, leg) => sum + leg.side * leg.qty * CONTRACT_MULTIPLIER * leg.entryPrice,
    0,
  )
}

export interface PositionGreeks {
  delta: number
  gamma: number
  theta: number // $ per calendar day
  vega: number // $ per vol point
  rho: number // $ per 1% rate move
}

export function positionGreeks(
  legs: Leg[],
  S: number,
  at: number,
  ivShift: number,
  r: number,
): PositionGreeks {
  const out: PositionGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }
  for (const leg of legs) {
    const T = yearsBetween(at, legExpiryClose(leg))
    const g = bsGreeks(leg.kind, S, leg.strike, T, shiftedIv(leg.iv, ivShift), r)
    const scale = leg.side * leg.qty * CONTRACT_MULTIPLIER
    out.delta += scale * g.delta
    out.gamma += scale * g.gamma
    out.theta += scale * g.theta
    out.vega += scale * g.vega
    out.rho += scale * g.rho
  }
  return out
}

/**
 * Reg-T-style initial margin estimate. Defined-risk positions require their
 * max loss; uncovered short tails use the standard naked formula —
 * premium + max(nakedPct of underlying − OTM amount, nakedPct/2 floor) —
 * with coverage assigned long-vs-short per side and the opposite naked
 * side's premium added (short-straddle rule). nakedPct defaults to Reg-T's
 * 20%; brokers differ, so it's a setting.
 */
export function marginEstimate(
  legs: Leg[],
  spot: number,
  maxLoss: number,
  nakedPct = 0.2,
): number {
  const side = (kind: 'call' | 'put') => {
    const shorts = legs
      .filter((l) => l.kind === kind && l.side === -1)
      .sort((a, b) => (kind === 'call' ? b.strike - a.strike : a.strike - b.strike))
    const longQty = legs
      .filter((l) => l.kind === kind && l.side === 1)
      .reduce((s, l) => s + l.qty, 0)
    let uncovered = Math.max(0, shorts.reduce((s, l) => s + l.qty, 0) - longQty)
    let req = 0
    let premium = 0
    for (const l of shorts) {
      if (uncovered <= 0) break
      const n = Math.min(uncovered, l.qty)
      uncovered -= n
      const otm = kind === 'call' ? Math.max(0, l.strike - spot) : Math.max(0, spot - l.strike)
      const floor = (nakedPct / 2) * (kind === 'call' ? spot : l.strike)
      req += n * CONTRACT_MULTIPLIER * (l.entryPrice + Math.max(nakedPct * spot - otm, floor))
      premium += n * CONTRACT_MULTIPLIER * l.entryPrice
    }
    return { req, premium }
  }

  const c = side('call')
  const p = side('put')
  if (c.req === 0 && p.req === 0) return Number.isFinite(maxLoss) ? Math.abs(Math.min(0, maxLoss)) : 0
  return Math.max(c.req + p.premium, p.req + c.premium)
}

/** Price range that comfortably contains all strikes and the spot. */
export function priceDomain(legs: Leg[], spot: number): [number, number] {
  const anchors = [spot, ...legs.map((l) => l.strike)]
  const lo = Math.min(...anchors)
  const hi = Math.max(...anchors)
  const pad = Math.max((hi - lo) * 0.45, spot * 0.18)
  return [Math.max(0.01, lo - pad), hi + pad]
}

/** Zero crossings of the P/L curve `pl(S)` over the domain, linearly interpolated. */
export function findBreakevens(
  pl: (s: number) => number,
  [lo, hi]: [number, number],
  samples = 600,
): number[] {
  const out: number[] = []
  let prevS = lo
  let prevY = pl(lo)
  for (let i = 1; i <= samples; i++) {
    const s = lo + ((hi - lo) * i) / samples
    const y = pl(s)
    if ((prevY < 0 && y >= 0) || (prevY >= 0 && y < 0)) {
      const t = Math.abs(prevY) / (Math.abs(prevY) + Math.abs(y) || 1)
      out.push(prevS + (s - prevS) * t)
    }
    prevS = s
    prevY = y
  }
  return out
}
