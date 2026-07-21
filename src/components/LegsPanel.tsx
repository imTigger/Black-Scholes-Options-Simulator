import { useState } from 'react'
import { impliedVol } from '../lib/blackScholes'
import { fmtDateShortUTC, fmtNum, fmtSignedPct } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { legExpiryClose, legPrice, yearsBetween } from '../lib/position'
import { newLegId } from '../lib/strategies'
import { midPrice, type ChainSlice, type Forecast, type Leg, type OptionKind } from '../lib/types'

interface Props {
  legs: Leg[]
  slices: Record<number, ChainSlice>
  spot: number
  rate: number
  now: number
  forecast: Forecast
  onChange: (legs: Leg[]) => void
}

function optionsFor(slices: Record<number, ChainSlice>, leg: Pick<Leg, 'kind' | 'expiry'>) {
  const slice = slices[leg.expiry]
  return slice ? (leg.kind === 'call' ? slice.calls : slice.puts) : []
}

/** Re-select the contract at strike K, pulling entry price and IV from the chain. */
function repriceLeg(
  leg: Leg,
  K: number,
  slices: Record<number, ChainSlice>,
  spot: number,
  rate: number,
  now: number,
): Leg {
  const o = optionsFor(slices, leg).find((c) => c.strike === K)
  if (!o) return { ...leg, strike: K }
  const mid = midPrice(o)
  const T = yearsBetween(now, legExpiryClose(leg))
  const iv =
    o.iv > 0.005
      ? o.iv
      : mid > 0 && spot > 0
        ? (impliedVol(leg.kind, mid, spot, K, T, rate) ?? 0.3)
        : 0.3
  return { ...leg, strike: K, entryPrice: mid, iv, contractSymbol: o.contractSymbol }
}

/**
 * Strike picker that cannot break the strategy's shape. Legs sharing this
 * leg's strike (straddle / iron-butterfly bodies) move together; a candidate
 * is offered only when every strike ordering between legs stays the same and
 * every moved leg has a quoted contract at the new strike.
 */
function StrikeSelect({
  leg,
  legs,
  slices,
  spot,
  rate,
  now,
  onChange,
}: {
  leg: Leg
  legs: Leg[]
  slices: Record<number, ChainSlice>
  spot: number
  rate: number
  now: number
  onChange: (legs: Leg[]) => void
}) {
  const dp = (k: number) => (k % 1 ? 2 : 0)
  const quoted = [
    ...new Set(
      optionsFor(slices, leg)
        .filter((o) => midPrice(o) > 0)
        .map((o) => o.strike),
    ),
  ]
  if (!quoted.length) return <>{fmtNum(leg.strike, dp(leg.strike))}</>

  const tiedIds = new Set(legs.filter((l) => l.strike === leg.strike).map((l) => l.id))
  const hasQuote = (l: Leg, K: number) => {
    const o = optionsFor(slices, l).find((c) => c.strike === K)
    return !!o && midPrice(o) > 0
  }
  const valid = (K: number) =>
    legs.every((other) =>
      tiedIds.has(other.id)
        ? hasQuote(other, K)
        : Math.sign(K - other.strike) === Math.sign(leg.strike - other.strike),
    )

  const opts = quoted.includes(leg.strike)
    ? quoted
    : [...quoted, leg.strike].sort((a, b) => a - b)

  return (
    <select
      className="strike-select"
      value={leg.strike}
      aria-label="Leg strike"
      onChange={(e) => {
        const K = +e.target.value
        onChange(
          legs.map((l) => (tiedIds.has(l.id) ? repriceLeg(l, K, slices, spot, rate, now) : l)),
        )
      }}
    >
      {opts.sort((a, b) => a - b).map((K) => (
        <option key={K} value={K} disabled={K !== leg.strike && !valid(K)}>
          {fmtNum(K, dp(K))}
        </option>
      ))}
    </select>
  )
}

export default function LegsPanel({ legs, slices, spot, rate, now, forecast, onChange }: Props) {
  const { t } = useI18n()
  const [showForm, setShowForm] = useState(false)

  const patchLeg = (id: string, patch: Partial<Leg>) =>
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  return (
    <div>
      {legs.length === 0 ? (
        <div className="legs-empty">{t('legs.empty')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="legs-table">
            <thead>
              <tr>
                <th>{t('legs.leg')}</th>
                <th>{t('legs.qty')}</th>
                <th>{t('legs.entry')}</th>
                <th>{t('legs.estNow')}</th>
                <th>{t('legs.estForecast')}</th>
                <th>{t('legs.diff')}</th>
                <th>IV</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => {
                const estNow = legPrice(leg, spot, now, 0, rate)
                const estFc = legPrice(leg, forecast.price, forecast.date, forecast.ivShift, rate)
                const diff = leg.entryPrice > 0 ? estFc / leg.entryPrice - 1 : NaN
                const gain = (estFc - leg.entryPrice) * leg.side >= 0
                return (
                  <tr key={leg.id}>
                    <td>
                      <span className={`side-pill ${leg.side === 1 ? 'long' : 'short'}`}>
                        {leg.side === 1 ? t('long') : t('short')}
                      </span>
                      <span className="leg-desc">
                        <StrikeSelect
                          leg={leg}
                          legs={legs}
                          slices={slices}
                          spot={spot}
                          rate={rate}
                          now={now}
                          onChange={onChange}
                        />
                        <span className="k">{leg.kind === 'call' ? 'C' : 'P'}</span>{' '}
                        <span className="k">{fmtDateShortUTC(leg.expiry)}</span>
                      </span>
                    </td>
                    <td>
                      <span className="qty-ctl">
                        <button
                          onClick={() => patchLeg(leg.id, { qty: Math.max(1, leg.qty - 1) })}
                          aria-label="Decrease quantity"
                        >
                          –
                        </button>
                        <span className="q num">{leg.qty}</span>
                        <button
                          onClick={() => patchLeg(leg.id, { qty: leg.qty + 1 })}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </span>
                    </td>
                    <td>
                      <input
                        className="cell-input num"
                        type="number"
                        step="0.01"
                        min={0}
                        value={+leg.entryPrice.toFixed(2)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          if (Number.isFinite(v) && v >= 0) patchLeg(leg.id, { entryPrice: v })
                        }}
                        aria-label={t('legs.entry')}
                      />
                    </td>
                    <td className="muted">{fmtNum(estNow, 2)}</td>
                    <td style={{ color: 'var(--amber)' }}>{fmtNum(estFc, 2)}</td>
                    <td className={gain ? 'up' : 'down'}>
                      {Number.isFinite(diff) ? fmtSignedPct(diff, 1) : '—'}
                    </td>
                    <td className="muted">{fmtNum(leg.iv * (1 + forecast.ivShift) * 100, 1)}%</td>
                    <td>
                      <button
                        className="icon-btn"
                        onClick={() => onChange(legs.filter((l) => l.id !== leg.id))}
                        aria-label="Remove leg"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="legs-actions">
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('legs.customClose') : t('legs.custom')}
        </button>
        {legs.length > 0 && (
          <>
            <button
              className="btn"
              title={t('legs.flipTip')}
              onClick={() =>
                onChange(legs.map((l) => ({ ...l, side: -l.side as 1 | -1 })))
              }
            >
              {t('legs.flip')}
            </button>
            <button className="btn" onClick={() => onChange([])}>
              {t('legs.clear')}
            </button>
          </>
        )}
      </div>

      {showForm && (
        <CustomLegForm
          spot={spot}
          rate={rate}
          now={now}
          onAdd={(leg) => {
            onChange([...legs, leg])
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function CustomLegForm({
  spot,
  rate,
  now,
  onAdd,
}: {
  spot: number
  rate: number
  now: number
  onAdd: (leg: Leg) => void
}) {
  const { t } = useI18n()
  const defaultExpiry = new Date(now + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const [kind, setKind] = useState<OptionKind>('call')
  const [side, setSide] = useState<1 | -1>(1)
  const [qty, setQty] = useState(1)
  const [strike, setStrike] = useState(spot > 0 ? Math.round(spot) : 100)
  const [dateStr, setDateStr] = useState(defaultExpiry)
  const [ivPct, setIvPct] = useState(30)
  const [price, setPrice] = useState('')

  const submit = () => {
    const [y, m, d] = dateStr.split('-').map(Number)
    if (!y || !m || !d) return
    const expiry = Date.UTC(y, m - 1, d)
    const iv = Math.max(0.1, ivPct) / 100
    const leg: Leg = {
      id: newLegId(),
      kind,
      side,
      qty: Math.max(1, Math.round(qty)),
      strike,
      expiry,
      iv,
      entryPrice: 0,
    }
    const parsed = parseFloat(price)
    leg.entryPrice =
      Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : +legPrice(leg, spot, now, 0, rate).toFixed(2)
    onAdd(leg)
  }

  return (
    <div className="custom-form">
      <label>
        {t('form.type')}
        <select value={kind} onChange={(e) => setKind(e.target.value as OptionKind)}>
          <option value="call">{t('form.call')}</option>
          <option value="put">{t('form.put')}</option>
        </select>
      </label>
      <label>
        {t('form.side')}
        <select value={side} onChange={(e) => setSide(+e.target.value as 1 | -1)}>
          <option value={1}>{t('form.long')}</option>
          <option value={-1}>{t('form.short')}</option>
        </select>
      </label>
      <label>
        {t('legs.qty')}
        <input type="number" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} />
      </label>
      <label>
        {t('form.strike')}
        <input type="number" step="0.5" value={strike} onChange={(e) => setStrike(+e.target.value)} />
      </label>
      <label>
        {t('form.expiry')}
        <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </label>
      <label>
        IV %
        <input type="number" step="0.5" min={1} value={ivPct} onChange={(e) => setIvPct(+e.target.value)} />
      </label>
      <label>
        {t('form.entry')}
        <input
          type="number"
          step="0.01"
          min={0}
          placeholder={t('form.model')}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <div className="span-all">
        <button className="btn primary" onClick={submit}>
          {t('form.add')}
        </button>
      </div>
    </div>
  )
}
