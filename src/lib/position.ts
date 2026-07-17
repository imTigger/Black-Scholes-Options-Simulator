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
}

export function positionGreeks(
  legs: Leg[],
  S: number,
  at: number,
  ivShift: number,
  r: number,
): PositionGreeks {
  const out: PositionGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 }
  for (const leg of legs) {
    const T = yearsBetween(at, legExpiryClose(leg))
    const g = bsGreeks(leg.kind, S, leg.strike, T, shiftedIv(leg.iv, ivShift), r)
    const scale = leg.side * leg.qty * CONTRACT_MULTIPLIER
    out.delta += scale * g.delta
    out.gamma += scale * g.gamma
    out.theta += scale * g.theta
    out.vega += scale * g.vega
  }
  return out
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
