import { useState } from 'react'
import { fmtDateShortUTC, fmtNum, fmtSignedPct } from '../lib/format'
import { legPrice } from '../lib/position'
import { newLegId } from '../lib/strategies'
import type { Forecast, Leg, OptionKind } from '../lib/types'

interface Props {
  legs: Leg[]
  spot: number
  rate: number
  now: number
  forecast: Forecast
  onChange: (legs: Leg[]) => void
}

export default function LegsPanel({ legs, spot, rate, now, forecast, onChange }: Props) {
  const [showForm, setShowForm] = useState(false)

  const patchLeg = (id: string, patch: Partial<Leg>) =>
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  return (
    <div>
      {legs.length === 0 ? (
        <div className="legs-empty">
          No legs yet. Pick contracts from the option chain, start from a strategy template, or
          add a custom leg.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="legs-table">
            <thead>
              <tr>
                <th>Leg</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Est. now</th>
                <th>Est. forecast</th>
                <th>Diff</th>
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
                        {leg.side === 1 ? 'BUY' : 'SELL'}
                      </span>
                      <span className="leg-desc">
                        {fmtNum(leg.strike, leg.strike % 1 ? 2 : 0)}
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
                    <td>{fmtNum(leg.entryPrice, 2)}</td>
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
          {showForm ? 'Close custom leg' : '+ Custom leg'}
        </button>
        {legs.length > 0 && (
          <button className="btn" onClick={() => onChange([])}>
            Clear all
          </button>
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
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as OptionKind)}>
          <option value="call">Call</option>
          <option value="put">Put</option>
        </select>
      </label>
      <label>
        Side
        <select value={side} onChange={(e) => setSide(+e.target.value as 1 | -1)}>
          <option value={1}>Buy</option>
          <option value={-1}>Sell</option>
        </select>
      </label>
      <label>
        Qty
        <input type="number" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} />
      </label>
      <label>
        Strike
        <input type="number" step="0.5" value={strike} onChange={(e) => setStrike(+e.target.value)} />
      </label>
      <label>
        Expiry
        <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </label>
      <label>
        IV %
        <input type="number" step="0.5" min={1} value={ivPct} onChange={(e) => setIvPct(+e.target.value)} />
      </label>
      <label>
        Entry price
        <input
          type="number"
          step="0.01"
          min={0}
          placeholder="model"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <div className="span-all">
        <button className="btn primary" onClick={submit}>
          Add leg
        </button>
      </div>
    </div>
  )
}
