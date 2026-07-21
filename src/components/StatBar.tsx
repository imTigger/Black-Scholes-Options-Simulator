import { useMemo } from 'react'
import { fmtMoney, fmtNum, fmtSigned, fmtSignedMoney } from '../lib/format'
import { useI18n } from '../lib/i18n'
import {
  findBreakevens,
  legExpiryClose,
  marginEstimate,
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
  marginPct: number
  forecast: Forecast
}

export default function StatBar({ legs, spot, rate, marginPct, forecast }: Props) {
  const { t } = useI18n()
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
    // Upside tail: nonzero slope past the highest strike means truly unbounded.
    // Downside is never unbounded — the underlying stops at zero, so evaluate
    // P/L exactly at S=0 (puts worth their strike, calls worthless).
    const eps = (hi - lo) / 400
    const slopeHi = (plExpiry(hi) - plExpiry(hi - eps)) / eps
    const upUnbounded = slopeHi > 0.5
    const downUnbounded = slopeHi < -0.5
    const plZero = plExpiry(0)

    const greeks = positionGreeks(legs, forecast.price, forecast.date, forecast.ivShift, rate)
    const maxLoss = downUnbounded ? -Infinity : Math.min(maxL, plZero)
    return {
      cost,
      breakevens: findBreakevens(plExpiry, domain),
      maxProfit: upUnbounded ? Infinity : Math.max(maxP, plZero),
      maxLoss,
      margin: marginEstimate(legs, spot, maxLoss, marginPct),
      greeks,
    }
  }, [legs, spot, rate, marginPct, forecast])

  if (!stats) return null

  return (
    <div className="stat-rows">
      <div className="stat-grid">
        <div className="stat">
          <div className="sl">{stats.cost >= 0 ? t('stat.netDebit') : t('stat.netCredit')}</div>
          <div className="sv">{fmtMoney(Math.abs(stats.cost))}</div>
        </div>
        <div className="stat">
          <div className="sl">{t('stat.maxProfit')}</div>
          <div className="sv up">
            {stats.maxProfit === Infinity ? t('stat.unlimited') : fmtSignedMoney(stats.maxProfit)}
          </div>
        </div>
        <div className="stat">
          <div className="sl">{t('stat.maxLoss')}</div>
          <div className="sv down">
            {stats.maxLoss === -Infinity ? t('stat.unlimited') : fmtSignedMoney(stats.maxLoss)}
          </div>
        </div>
        <div className="stat">
          <div className="sl">{t('stat.breakeven')}</div>
          <div className="sv">
            {stats.breakevens.length
              ? stats.breakevens.map((b) => fmtNum(b, 2)).join(' / ')
              : '—'}
          </div>
        </div>
        <div className="stat" title={t('stat.marginTip')}>
          <div className="sl">{t('stat.margin')}</div>
          <div className="sv">{fmtMoney(stats.margin)}</div>
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat" title={t('stat.deltaTip', { sh: fmtNum(stats.greeks.delta, 0) })}>
          <div className="sl">Delta</div>
          <div className="sv">
            {fmtSigned(stats.greeks.delta / 100, 2)}{' '}
            <small>· {fmtNum(stats.greeks.delta, 0)} {t('stat.sh')}</small>
          </div>
        </div>
        <div className="stat">
          <div className="sl">Gamma</div>
          <div className="sv">{fmtNum(stats.greeks.gamma, 2)}</div>
        </div>
        <div className="stat">
          <div className="sl">Theta</div>
          <div className="sv">
            {fmtSignedMoney(stats.greeks.theta)} <small>{t('stat.day')}</small>
          </div>
        </div>
        <div className="stat">
          <div className="sl">Vega</div>
          <div className="sv">
            {fmtSignedMoney(stats.greeks.vega)} <small>{t('stat.volpt')}</small>
          </div>
        </div>
        <div className="stat">
          <div className="sl">Rho</div>
          <div className="sv">
            {fmtSignedMoney(stats.greeks.rho)} <small>{t('stat.ratept')}</small>
          </div>
        </div>
      </div>
    </div>
  )
}
