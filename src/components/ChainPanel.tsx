import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDateShortUTC, fmtNum } from '../lib/format'
import { useI18n } from '../lib/i18n'
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
  const { t, tStrat, tHint } = useI18n()
  const [showAll, setShowAll] = useState(false)
  const [presetError, setPresetError] = useState(false)
  const expiryRowRef = useRef<HTMLDivElement>(null)

  // Center the active chip by moving only the chip row's own scroller —
  // scrollIntoView would also scroll the page (a jolt on mobile, where the
  // chain sits below the fold) and re-fire on every render.
  useEffect(() => {
    const row = expiryRowRef.current
    if (!row || activeExpiry === null) return
    const chip = row.querySelector<HTMLElement>(`[data-exp="${activeExpiry}"]`)
    if (chip) {
      row.scrollLeft = chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2
    }
  }, [activeExpiry, expirations])

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
        <span className="eyebrow">{t('panel.templates')}</span>
        <span className="panel-sub">{t('panel.templates.sub')}</span>
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
                setPresetError(false)
                onApplyPreset(legs)
              } else {
                setPresetError(true)
              }
            }}
            disabled={!slice}
          >
            <div className="pn">{tStrat(p.name)}</div>
            <div className="ph">{tHint(p.key, p.hint)}</div>
          </button>
        ))}
      </div>
      {presetError && (
        <p className="chain-note" style={{ color: 'var(--down)' }}>
          {t('chain.presetError')}
        </p>
      )}

      <div className="panel-head" style={{ marginTop: 20 }}>
        <span className="eyebrow">{t('panel.chain')}</span>
        {loading && <span className="spin" aria-label="Loading" />}
      </div>

      <div className="expiry-row" ref={expiryRowRef}>
        {expirations.map((ms) => (
          <button
            key={ms}
            data-exp={ms}
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
                    {t('chain.calls')}
                  </th>
                  <th style={{ textAlign: 'center' }}>{t('chain.strike')}</th>
                  <th className="side-head" colSpan={3}>
                    {t('chain.puts')}
                  </th>
                </tr>
                <tr>
                  <th />
                  <th>{t('chain.mid')}</th>
                  <th className="col-iv">IV</th>
                  <th />
                  <th className="col-iv">IV</th>
                  <th>{t('chain.mid')}</th>
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
            {t('chain.note')}{' '}
            {rows.length > visible.length ? (
              <button className="reset-link" style={{ margin: 0 }} onClick={() => setShowAll(true)}>
                {t('chain.showAll', { n: rows.length })}
              </button>
            ) : rows.length > 25 ? (
              <button className="reset-link" style={{ margin: 0 }} onClick={() => setShowAll(false)}>
                {t('chain.showFewer')}
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
  const { t } = useI18n()
  const disabled = midPrice(opt) <= 0
  return (
    <span className="bs-btns">
      <button
        className="buy"
        title={t('chain.long', { p: fmtNum(midPrice(opt), 2) })}
        disabled={disabled}
        onClick={() => onAdd(opt, expiry, 1)}
      >
        L
      </button>
      <button
        className="sell"
        title={t('chain.short', { p: fmtNum(midPrice(opt), 2) })}
        disabled={disabled}
        onClick={() => onAdd(opt, expiry, -1)}
      >
        S
      </button>
    </span>
  )
}
