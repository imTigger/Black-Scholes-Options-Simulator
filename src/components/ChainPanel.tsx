import { useMemo, useState } from 'react'
import { fmtDateShortUTC, fmtNum } from '../lib/format'
import { STRATEGY_PRESETS } from '../lib/strategies'
import { midPrice, type ChainOption, type ChainSlice, type Leg } from '../lib/types'

interface Props {
  expirations: number[]
  activeExpiry: number | null
  slice: ChainSlice | null
  loading: boolean
  spot: number
  onSelectExpiry: (ms: number) => void
  onAddLeg: (opt: ChainOption, expiry: number, side: 1 | -1) => void
  onApplyPreset: (legs: Leg[]) => void
}

interface Row {
  strike: number
  call?: ChainOption
  put?: ChainOption
}

export default function ChainPanel({
  expirations,
  activeExpiry,
  slice,
  loading,
  spot,
  onSelectExpiry,
  onAddLeg,
  onApplyPreset,
}: Props) {
  const [showAll, setShowAll] = useState(false)
  const [presetError, setPresetError] = useState<string | null>(null)

  const rows = useMemo(() => {
    if (!slice) return []
    const map = new Map<number, Row>()
    for (const c of slice.calls) map.set(c.strike, { strike: c.strike, call: c })
    for (const p of slice.puts) {
      const r = map.get(p.strike)
      if (r) r.put = p
      else map.set(p.strike, { strike: p.strike, put: p })
    }
    return [...map.values()].sort((a, b) => a.strike - b.strike)
  }, [slice])

  const atmIdx = useMemo(() => {
    let best = -1
    rows.forEach((r, i) => {
      if (best < 0 || Math.abs(r.strike - spot) < Math.abs(rows[best].strike - spot)) best = i
    })
    return best
  }, [rows, spot])

  const visible = useMemo(() => {
    if (showAll || rows.length <= 25 || atmIdx < 0) return rows
    return rows.slice(Math.max(0, atmIdx - 12), atmIdx + 13)
  }, [rows, showAll, atmIdx])

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="eyebrow">Strategy templates</span>
        <span className="panel-sub">replaces current legs</span>
      </div>
      <div className="preset-grid">
        {STRATEGY_PRESETS.map((p) => (
          <button
            key={p.key}
            className="preset"
            onClick={() => {
              if (!slice) return
              const legs = p.build(slice, spot)
              if (legs) {
                setPresetError(null)
                onApplyPreset(legs)
              } else {
                setPresetError('Not enough quoted strikes at this expiry to build that strategy.')
              }
            }}
            disabled={!slice}
          >
            <div className="pn">{p.name}</div>
            <div className="ph">{p.hint}</div>
          </button>
        ))}
      </div>
      {presetError && (
        <p className="chain-note" style={{ color: 'var(--down)' }}>
          {presetError}
        </p>
      )}

      <div className="panel-head" style={{ marginTop: 20 }}>
        <span className="eyebrow">Option chain</span>
        {loading && <span className="spin" aria-label="Loading" />}
      </div>

      <div className="expiry-row">
        {expirations.map((ms) => (
          <button
            key={ms}
            ref={(el) => {
              if (el && ms === activeExpiry)
                el.scrollIntoView({ inline: 'center', block: 'nearest' })
            }}
            className={`chip ${ms === activeExpiry ? 'active' : ''}`}
            onClick={() => onSelectExpiry(ms)}
          >
            {fmtDateShortUTC(ms)}
          </button>
        ))}
      </div>

      {slice && (
        <>
          <div className="chain-wrap">
            <table className="chain">
              <thead>
                <tr>
                  <th className="side-head" colSpan={3}>
                    Calls
                  </th>
                  <th style={{ textAlign: 'center' }}>Strike</th>
                  <th className="side-head" colSpan={3}>
                    Puts
                  </th>
                </tr>
                <tr>
                  <th />
                  <th>Mid</th>
                  <th className="col-iv">IV</th>
                  <th />
                  <th className="col-iv">IV</th>
                  <th>Mid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr
                    key={r.strike}
                    className={[
                      r.strike < spot ? 'itm-call' : 'itm-put',
                      visible[i - 1] &&
                      visible[i - 1].strike <= spot &&
                      r.strike > spot
                        ? 'atm'
                        : '',
                    ].join(' ')}
                  >
                    <td className="c">
                      {r.call && <SideButtons opt={r.call} expiry={slice.expiry} onAdd={onAddLeg} />}
                    </td>
                    <td className="c">{r.call ? fmtNum(midPrice(r.call), 2) : '—'}</td>
                    <td className="c muted col-iv">
                      {r.call?.iv ? fmtNum(r.call.iv * 100, 1) : '—'}
                    </td>
                    <td className="strike">{fmtNum(r.strike, r.strike % 1 ? 2 : 0)}</td>
                    <td className="p muted col-iv">
                      {r.put?.iv ? fmtNum(r.put.iv * 100, 1) : '—'}
                    </td>
                    <td className="p">{r.put ? fmtNum(midPrice(r.put), 2) : '—'}</td>
                    <td className="p">
                      {r.put && <SideButtons opt={r.put} expiry={slice.expiry} onAdd={onAddLeg} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="chain-note">
            L adds a long leg at the mid price, S a short one.{' '}
            {rows.length > visible.length ? (
              <button className="reset-link" style={{ margin: 0 }} onClick={() => setShowAll(true)}>
                Show all {rows.length} strikes
              </button>
            ) : rows.length > 25 ? (
              <button className="reset-link" style={{ margin: 0 }} onClick={() => setShowAll(false)}>
                Show fewer strikes
              </button>
            ) : null}
          </p>
        </>
      )}
    </div>
  )
}

function SideButtons({
  opt,
  expiry,
  onAdd,
}: {
  opt: ChainOption
  expiry: number
  onAdd: (opt: ChainOption, expiry: number, side: 1 | -1) => void
}) {
  const disabled = midPrice(opt) <= 0
  return (
    <span className="bs-btns">
      <button
        className="buy"
        title={`Long @ ${fmtNum(midPrice(opt), 2)}`}
        disabled={disabled}
        onClick={() => onAdd(opt, expiry, 1)}
      >
        L
      </button>
      <button
        className="sell"
        title={`Short @ ${fmtNum(midPrice(opt), 2)}`}
        disabled={disabled}
        onClick={() => onAdd(opt, expiry, -1)}
      >
        S
      </button>
    </span>
  )
}
