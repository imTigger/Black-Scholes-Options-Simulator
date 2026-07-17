import { useMemo } from 'react'
import { fmtDateShort, fmtNum, fmtSignedMoney, fmtSignedPct } from '../lib/format'
import {
  legExpiryClose,
  MS_DAY,
  positionCost,
  positionValue,
  priceDomain,
} from '../lib/position'
import { CONTRACT_MULTIPLIER, type Forecast, type Leg } from '../lib/types'

interface Props {
  legs: Leg[]
  spot: number
  rate: number
  now: number
  forecast: Forecast
  onChange: (patch: Partial<Forecast>) => void
}

function trackFill(frac: number): React.CSSProperties {
  const p = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`
  return {
    ['--track-bg' as string]: `linear-gradient(90deg, rgba(245,184,65,.65) ${p}, var(--surface-3) ${p})`,
  }
}

export default function ForecastPanel({ legs, spot, rate, now, forecast, onChange }: Props) {
  const maxDate = useMemo(
    () => (legs.length ? Math.max(...legs.map(legExpiryClose)) : now + 30 * MS_DAY),
    [legs, now],
  )
  const totalDays = Math.max(1, Math.round((maxDate - now) / MS_DAY))
  const dayIndex = Math.min(
    totalDays,
    Math.max(0, Math.round((forecast.date - now) / MS_DAY)),
  )

  const [priceLo, priceHi] = useMemo(() => priceDomain(legs, spot), [legs, spot])
  const priceStep = Math.max(0.01, +((priceHi - priceLo) / 500).toFixed(2))

  const singleLeg = legs.length === 1 ? legs[0] : null

  const value = positionValue(legs, forecast.price, forecast.date, forecast.ivShift, rate)
  const cost = positionCost(legs)
  const pl = value - cost
  const plPct = cost !== 0 ? pl / Math.abs(cost) : NaN

  const estPerShare = singleLeg
    ? value / (CONTRACT_MULTIPLIER * singleLeg.qty) / singleLeg.side
    : null
  const singleDiff =
    singleLeg && singleLeg.entryPrice > 0 && estPerShare !== null
      ? estPerShare / singleLeg.entryPrice - 1
      : null

  const effIvPct = singleLeg ? singleLeg.iv * (1 + forecast.ivShift) * 100 : null

  const setDay = (k: number) => onChange({ date: Math.min(now + k * MS_DAY, maxDate) })

  return (
    <div>
      <div className="forecast-rows">
        {/* When */}
        <div className="frow">
          <div className="flabel">
            When <small>T+{dayIndex}d</small>
          </div>
          <div className="fval" aria-label="Forecast date">
            {fmtDateShort(Math.min(forecast.date, maxDate))}
          </div>
          <div className="ftrack">
            <input
              type="range"
              className="slider"
              min={0}
              max={totalDays}
              step={1}
              value={dayIndex}
              style={trackFill(dayIndex / totalDays)}
              onChange={(e) => setDay(+e.target.value)}
              aria-label="Days forward"
            />
            <div className="fends">
              <span>{fmtDateShort(now)}</span>
              <span>{fmtDateShort(maxDate)}</span>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="frow">
          <div className="flabel">
            Price{' '}
            <small>
              {spot > 0 && forecast.price > 0
                ? fmtSignedPct(forecast.price / spot - 1, 1) + ' vs spot'
                : ''}
            </small>
          </div>
          <input
            type="number"
            className="fval"
            value={fmtNum(forecast.price, 2).replace(/,/g, '')}
            step={priceStep}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v > 0) onChange({ price: v })
            }}
            aria-label="Forecast underlying price"
          />
          <div className="ftrack">
            <input
              type="range"
              className="slider"
              min={priceLo}
              max={priceHi}
              step={priceStep}
              value={Math.min(priceHi, Math.max(priceLo, forecast.price))}
              style={trackFill((forecast.price - priceLo) / (priceHi - priceLo))}
              onChange={(e) => onChange({ price: +e.target.value })}
              aria-label="Forecast underlying price slider"
            />
            <div className="fends">
              <span>{fmtNum(priceLo, 2)}</span>
              <span>{fmtNum(priceHi, 2)}</span>
            </div>
          </div>
        </div>

        {/* IV */}
        <div className="frow">
          <div className="flabel">
            {singleLeg ? 'IV%' : 'IV shift'}{' '}
            <small>{singleLeg ? `entry ${fmtNum(singleLeg.iv * 100, 1)}%` : 'all legs, relative'}</small>
          </div>
          {singleLeg ? (
            <input
              type="number"
              className="fval"
              value={effIvPct !== null ? +effIvPct.toFixed(2) : 0}
              step={0.5}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v) && v > 0 && singleLeg.iv > 0)
                  onChange({ ivShift: v / 100 / singleLeg.iv - 1 })
              }}
              aria-label="Forecast implied volatility percent"
            />
          ) : (
            <div className="fval">{fmtSignedPct(forecast.ivShift, 0)}</div>
          )}
          <div className="ftrack">
            <input
              type="range"
              className="slider"
              min={-50}
              max={50}
              step={1}
              value={Math.round(forecast.ivShift * 100)}
              style={trackFill((forecast.ivShift + 0.5) / 1)}
              onChange={(e) => onChange({ ivShift: +e.target.value / 100 })}
              aria-label="Implied volatility shift"
            />
            <div className="fends">
              {singleLeg ? (
                <>
                  <span>{fmtNum(singleLeg.iv * 50, 2)}%</span>
                  <span>{fmtNum(singleLeg.iv * 150, 2)}%</span>
                </>
              ) : (
                <>
                  <span>-50%</span>
                  <span>+50%</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="forecast-result">
        {singleLeg && estPerShare !== null ? (
          <>
            <div className="fr-item">
              <span className="fr-label">Option price (est.)</span>
              <span className="fr-num accent">{fmtNum(estPerShare, 2)}</span>
            </div>
            {singleDiff !== null && (
              <div className="fr-item">
                <span className="fr-label">Difference</span>
                <span className={`fr-num ${singleDiff >= 0 ? 'up' : 'down'}`}>
                  {fmtSignedPct(singleDiff)}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="fr-item">
            <span className="fr-label">Strategy value (est.)</span>
            <span className="fr-num accent">{fmtSignedMoney(value).replace('+', '')}</span>
          </div>
        )}
        <div className="fr-item">
          <span className="fr-label">P/L</span>
          <span className={`fr-num ${pl >= 0 ? 'up' : 'down'}`}>
            {fmtSignedMoney(pl)}
            {Number.isFinite(plPct) ? ` (${fmtSignedPct(plPct, 1)})` : ''}
          </span>
        </div>
        <button
          className="reset-link"
          onClick={() => onChange({ date: now, price: spot, ivShift: 0 })}
        >
          Reset to today
        </button>
      </div>

      <p className="disclaimer">
        Prices are theoretical values from the Black-Scholes model with your inputs — for
        reference only, not investment advice.
      </p>
    </div>
  )
}
