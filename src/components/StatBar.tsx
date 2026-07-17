import { useMemo } from 'react'
import { fmtMoney, fmtNum, fmtSignedMoney } from '../lib/format'
import {
  findBreakevens,
  legExpiryClose,
  positionCost,
  positionGreeks,
  positionValue,
  priceDomain,
} from '../lib/position'
import type { Forecast, Leg } from '../lib/types'

interface Props {
  legs: Leg[]
  spot: number
  rate: number
  forecast: Forecast
}

export default function StatBar({ legs, spot, rate, forecast }: Props) {
  const stats = useMemo(() => {
    if (!legs.length || !(spot > 0)) return null
    const cost = positionCost(legs)
    const domain = priceDomain(legs, spot)
    const frontExpiry = Math.min(...legs.map(legExpiryClose))
    const plExpiry = (s: number) =>
      positionValue(legs, s, frontExpiry, forecast.ivShift, rate) - cost

    const [lo, hi] = domain
    let maxP = -Infinity
    let maxL = Infinity
    for (let i = 0; i <= 400; i++) {
      const y = plExpiry(lo + ((hi - lo) * i) / 400)
      if (y > maxP) maxP = y
      if (y < maxL) maxL = y
    }
    // Unbounded tails: nonzero slope at the domain edges
    const eps = (hi - lo) / 400
    const slopeHi = (plExpiry(hi) - plExpiry(hi - eps)) / eps
    const slopeLo = (plExpiry(lo + eps) - plExpiry(lo)) / eps
    const upUnbounded = slopeHi > 0.5
    const downUnboundedHi = slopeHi < -0.5
    const upUnboundedLo = slopeLo < -0.5 // rises toward S→0
    const downUnboundedLo = slopeLo > 0.5 // falls toward S→0

    const greeks = positionGreeks(legs, forecast.price, forecast.date, forecast.ivShift, rate)
    return {
      cost,
      breakevens: findBreakevens(plExpiry, domain),
      maxProfit: upUnbounded || upUnboundedLo ? Infinity : maxP,
      maxLoss: downUnboundedHi || downUnboundedLo ? -Infinity : maxL,
      greeks,
    }
  }, [legs, spot, rate, forecast])

  if (!stats) return null

  return (
    <div className="stat-rows">
      <div className="stat-grid">
        <div className="stat">
          <div className="sl">{stats.cost >= 0 ? 'Net debit' : 'Net credit'}</div>
          <div className="sv">{fmtMoney(Math.abs(stats.cost))}</div>
        </div>
        <div className="stat">
          <div className="sl">Max profit</div>
          <div className="sv up">
            {stats.maxProfit === Infinity ? 'Unlimited' : fmtSignedMoney(stats.maxProfit)}
          </div>
        </div>
        <div className="stat">
          <div className="sl">Max loss</div>
          <div className="sv down">
            {stats.maxLoss === -Infinity ? 'Unlimited' : fmtSignedMoney(stats.maxLoss)}
          </div>
        </div>
        <div className="stat">
          <div className="sl">Breakeven</div>
          <div className="sv">
            {stats.breakevens.length
              ? stats.breakevens.map((b) => fmtNum(b, 2)).join(' / ')
              : '—'}
          </div>
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat">
          <div className="sl">Delta</div>
          <div className="sv">
            {fmtNum(stats.greeks.delta, 1)} <small>sh</small>
          </div>
        </div>
        <div className="stat">
          <div className="sl">Gamma</div>
          <div className="sv">{fmtNum(stats.greeks.gamma, 2)}</div>
        </div>
        <div className="stat">
          <div className="sl">Theta</div>
          <div className="sv">
            {fmtSignedMoney(stats.greeks.theta)} <small>/day</small>
          </div>
        </div>
        <div className="stat">
          <div className="sl">Vega</div>
          <div className="sv">
            {fmtSignedMoney(stats.greeks.vega)} <small>/vol pt</small>
          </div>
        </div>
      </div>
    </div>
  )
}
