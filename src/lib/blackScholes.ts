import type { OptionKind } from './types'

const SQRT_2PI = Math.sqrt(2 * Math.PI)

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI
}

// Zelen & Severo approximation of the standard normal CDF, |error| < 7.5e-8
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.2316419 * ax)
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const tail = normPdf(ax) * poly
  return sign === 1 ? 1 - tail : tail
}

export interface Greeks {
  price: number
  delta: number
  gamma: number
  theta: number // per calendar day, per share
  vega: number // per 1 vol point (0.01), per share
  rho: number // per 1% rate move, per share
}

export function intrinsic(kind: OptionKind, S: number, K: number): number {
  return kind === 'call' ? Math.max(0, S - K) : Math.max(0, K - S)
}

/**
 * Black-Scholes-Merton price for a European option on a dividend-paying stock.
 * T in years, sigma/r/q as decimals. T<=0 or sigma<=0 degrades to intrinsic.
 */
export function bsPrice(
  kind: OptionKind,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r = 0,
  q = 0,
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return intrinsic(kind, S, K)
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const dfr = Math.exp(-r * T)
  const dfq = Math.exp(-q * T)
  if (kind === 'call') return S * dfq * normCdf(d1) - K * dfr * normCdf(d2)
  return K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1)
}

export function bsGreeks(
  kind: OptionKind,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r = 0,
  q = 0,
): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const price = intrinsic(kind, S, K)
    const itm = price > 0
    return {
      price,
      delta: kind === 'call' ? (itm ? 1 : 0) : itm ? -1 : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    }
  }
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const dfr = Math.exp(-r * T)
  const dfq = Math.exp(-q * T)
  const pdf = normPdf(d1)

  const price =
    kind === 'call'
      ? S * dfq * normCdf(d1) - K * dfr * normCdf(d2)
      : K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1)
  const delta = kind === 'call' ? dfq * normCdf(d1) : -dfq * normCdf(-d1)
  const gamma = (dfq * pdf) / (S * sigma * sqrtT)
  const vega = (S * dfq * pdf * sqrtT) / 100
  const thetaYear =
    kind === 'call'
      ? (-S * dfq * pdf * sigma) / (2 * sqrtT) -
        r * K * dfr * normCdf(d2) +
        q * S * dfq * normCdf(d1)
      : (-S * dfq * pdf * sigma) / (2 * sqrtT) +
        r * K * dfr * normCdf(-d2) -
        q * S * dfq * normCdf(-d1)
  const rho =
    kind === 'call' ? (K * T * dfr * normCdf(d2)) / 100 : (-K * T * dfr * normCdf(-d2)) / 100

  return { price, delta, gamma, theta: thetaYear / 365, vega, rho }
}

/** Implied volatility via bisection on [0.1%, 500%]. Returns null when unsolvable. */
export function impliedVol(
  kind: OptionKind,
  target: number,
  S: number,
  K: number,
  T: number,
  r = 0,
  q = 0,
): number | null {
  if (T <= 0 || target <= intrinsic(kind, S, K) - 1e-9) return null
  let lo = 0.001
  let hi = 5
  if (bsPrice(kind, S, K, T, hi, r, q) < target) return null
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (bsPrice(kind, S, K, T, mid, r, q) > target) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}
