import { useCallback, useEffect, useMemo, useState } from 'react'
import { bsGreeks, type Greeks } from '../lib/blackScholes'
import { fmtDateShortUTC, fmtDateUTC, fmtNum } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { legExpiryClose, MS_DAY, yearsBetween } from '../lib/position'
import { midPrice, type ChainOption, type ChainSlice, type Leg } from '../lib/types'

interface Props {
  symbol: string
  expirations: number[]
  slices: Record<number, ChainSlice>
  spot: number
  rate: number
  now: number
  legs: Leg[]
  onEnsureExpiry: (ms: number) => Promise<void>
  onAddLeg: (opt: ChainOption, expiry: number, side: 1 | -1) => void
  onSetLegs: (legs: Leg[]) => void
  onRefresh: () => void
  onClose: () => void
}

interface StrikeRow {
  strike: number
  call?: ChainOption
  put?: ChainOption
}

function buildRows(slice: ChainSlice): StrikeRow[] {
  const map = new Map<number, StrikeRow>()
  for (const c of slice.calls) map.set(c.strike, { strike: c.strike, call: c })
  for (const p of slice.puts) {
    const r = map.get(p.strike)
    if (r) r.put = p
    else map.set(p.strike, { strike: p.strike, put: p })
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike)
}

/** Monthly options expire on the 3rd Friday; everything else is weekly. */
function isMonthly(ms: number): boolean {
  const d = new Date(ms)
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  const firstFri = 1 + ((5 - first.getUTCDay() + 7) % 7)
  return d.getUTCDate() === firstFri + 14
}

function dteDays(ms: number, now: number): number {
  return Math.max(0, Math.ceil((legExpiryClose({ expiry: ms }) - now) / MS_DAY))
}

export default function FullChainModal({
  symbol,
  expirations,
  slices,
  spot,
  rate,
  now,
  legs,
  onEnsureExpiry,
  onAddLeg,
  onSetLegs,
  onRefresh,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loadingExp, setLoadingExp] = useState<Set<number>>(new Set())

  const ensure = useCallback(
    async (ms: number) => {
      if (slices[ms]) return
      setLoadingExp((s) => new Set(s).add(ms))
      try {
        await onEnsureExpiry(ms)
      } finally {
        setLoadingExp((s) => {
          const n = new Set(s)
          n.delete(ms)
          return n
        })
      }
    },
    [slices, onEnsureExpiry],
  )

  // Expand the first live expiration on open; lock body scroll; Esc closes.
  useEffect(() => {
    const first =
      expirations.find((e) => legExpiryClose({ expiry: e }) > now + 3 * 3600 * 1000) ??
      expirations[0]
    if (first != null) {
      setExpanded(new Set([first]))
      void ensure(first)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (ms: number) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(ms)) n.delete(ms)
      else {
        n.add(ms)
        void ensure(ms)
      }
      return n
    })
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-full" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="mh-left">
            <button className="mh-icon" onClick={onRefresh} title={t('full.refresh')} aria-label={t('full.refresh')}>
              ⟳
            </button>
            <span className="mh-title">
              {symbol} · <span className="muted">{t('panel.chain')}</span>
            </span>
            {spot > 0 && <span className="mh-spot num">{fmtNum(spot, 2)}</span>}
          </div>
          <button className="mh-icon" onClick={onClose} title={t('full.close')} aria-label={t('full.close')}>
            ✕
          </button>
        </div>

        <div className="modal-body">
        <div className="modal-scroll">
          <table className="full-chain">
            <thead>
              <tr className="grp">
                <th colSpan={7}>{t('chain.calls')}</th>
                <th className="strike-h">{t('chain.strike')}</th>
                <th colSpan={7}>{t('chain.puts')}</th>
              </tr>
              <tr className="cols">
                <th>Vega</th>
                <th>Theta</th>
                <th>Gamma</th>
                <th>Delta</th>
                <th>IV</th>
                <th>{t('full.bid')}</th>
                <th>{t('full.ask')}</th>
                <th className="strike-h" />
                <th>{t('full.bid')}</th>
                <th>{t('full.ask')}</th>
                <th>IV</th>
                <th>Delta</th>
                <th>Gamma</th>
                <th>Theta</th>
                <th>Vega</th>
              </tr>
            </thead>
            {expirations.map((exp) => {
              const open = expanded.has(exp)
              const slice = slices[exp]
              const rows = open && slice ? buildRows(slice) : []
              return (
                <tbody key={exp}>
                  <tr className="exp-row" onClick={() => toggle(exp)}>
                    <td colSpan={15}>
                      <span className={`chev ${open ? 'open' : ''}`}>▸</span>
                      <span className="exp-date">{fmtDateUTC(exp)}</span>
                      <span className={`exp-tag ${isMonthly(exp) ? 'm' : 'w'}`}>
                        {isMonthly(exp) ? t('full.monthly') : t('full.weekly')}
                      </span>
                      <span className="exp-dte">
                        {(() => {
                          const n = dteDays(exp, now)
                          return t(n === 1 ? 'full.dte1' : 'full.dte', { n })
                        })()}
                      </span>
                      {loadingExp.has(exp) && <span className="spin" style={{ marginLeft: 10 }} />}
                    </td>
                  </tr>
                  {open &&
                    rows.map((r) => (
                      <ChainRow
                        key={r.strike}
                        row={r}
                        expiry={exp}
                        spot={spot}
                        rate={rate}
                        now={now}
                        onAddLeg={onAddLeg}
                      />
                    ))}
                  {open && slice && !rows.length && (
                    <tr>
                      <td colSpan={15} className="full-empty">
                        {t('full.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              )
            })}
          </table>
        </div>

        <aside className="modal-side">
          <div className="side-head">
            <span className="eyebrow">{t('full.legs')}</span>
            {legs.length > 0 && <span className="side-count num">{legs.length}</span>}
          </div>
          <div className="side-list">
            {legs.length === 0 ? (
              <div className="side-empty">
                <span className="i">ⓘ</span> {t('full.legsEmpty')}
              </div>
            ) : (
              legs.map((l) => (
                <div className="side-leg" key={l.id}>
                  <span className={`side-pill ${l.side === 1 ? 'long' : 'short'}`}>
                    {l.side === 1 ? t('long') : t('short')}
                  </span>
                  <span className="side-desc">
                    {fmtNum(l.strike, l.strike % 1 ? 2 : 0)}
                    <span className="k">{l.kind === 'call' ? 'C' : 'P'}</span>{' '}
                    <span className="k">{fmtDateShortUTC(l.expiry)}</span>
                  </span>
                  <span className="side-px num">{fmtNum(l.entryPrice, 2)}</span>
                  <button
                    className="side-x"
                    onClick={() => onSetLegs(legs.filter((x) => x.id !== l.id))}
                    aria-label={t('full.close')}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
          {legs.length > 0 && (
            <div className="side-foot">
              <button className="btn" onClick={() => onSetLegs([])}>
                {t('legs.clear')}
              </button>
            </div>
          )}
        </aside>
        </div>
      </div>
    </div>
  )
}

function greeksOf(o: ChainOption | undefined, spot: number, rate: number, T: number): Greeks | null {
  if (!o || !(spot > 0) || o.iv <= 0) return null
  return bsGreeks(o.kind, spot, o.strike, T, o.iv, rate)
}

function PxCell({
  o,
  side,
  itm,
  onClick,
}: {
  o: ChainOption | undefined
  side: 'bid' | 'ask'
  itm: boolean
  onClick?: () => void
}) {
  if (!o) return <td className={`px ${side} ${itm ? 'itm' : ''}`}>—</td>
  const px = side === 'bid' ? o.bid : o.ask
  const sz = side === 'bid' ? o.bidSize : o.askSize
  return (
    <td
      className={`px ${side} ${itm ? 'itm' : ''} ${onClick ? 'click' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      title={onClick ? (side === 'bid' ? 'Sell (short)' : 'Buy (long)') : undefined}
    >
      <span className="px-v">{px > 0 ? fmtNum(px, 2) : '—'}</span>
      {sz ? <span className="px-sz">×{fmtNum(sz, 0)}</span> : null}
    </td>
  )
}

function ChainRow({
  row,
  expiry,
  spot,
  rate,
  now,
  onAddLeg,
}: {
  row: StrikeRow
  expiry: number
  spot: number
  rate: number
  now: number
  onAddLeg: (opt: ChainOption, expiry: number, side: 1 | -1) => void
}) {
  const T = useMemo(() => yearsBetween(now, legExpiryClose({ expiry })), [now, expiry])
  const cg = useMemo(() => greeksOf(row.call, spot, rate, T), [row.call, spot, rate, T])
  const pg = useMemo(() => greeksOf(row.put, spot, rate, T), [row.put, spot, rate, T])
  const g = (x: number | undefined) => (x === undefined ? '—' : fmtNum(x, 4))
  const iv = (o?: ChainOption) => (o?.iv ? `${fmtNum(o.iv * 100, 2)}%` : '—')
  const itmCall = row.strike < spot
  const itmPut = row.strike > spot
  const dp = row.strike % 1 ? 2 : 0

  return (
    <tr>
      <td className={itmCall ? 'itm' : ''}>{g(cg?.vega)}</td>
      <td className={itmCall ? 'itm' : ''}>{g(cg?.theta)}</td>
      <td className={itmCall ? 'itm' : ''}>{g(cg?.gamma)}</td>
      <td className={itmCall ? 'itm' : ''}>{g(cg?.delta)}</td>
      <td className={`iv ${itmCall ? 'itm' : ''}`}>{iv(row.call)}</td>
      <PxCell
        o={row.call}
        side="bid"
        itm={itmCall}
        onClick={row.call && midPrice(row.call) > 0 ? () => onAddLeg(row.call!, expiry, -1) : undefined}
      />
      <PxCell
        o={row.call}
        side="ask"
        itm={itmCall}
        onClick={row.call && midPrice(row.call) > 0 ? () => onAddLeg(row.call!, expiry, 1) : undefined}
      />
      <td className="strike-col">{fmtNum(row.strike, dp)}</td>
      <PxCell
        o={row.put}
        side="bid"
        itm={itmPut}
        onClick={row.put && midPrice(row.put) > 0 ? () => onAddLeg(row.put!, expiry, -1) : undefined}
      />
      <PxCell
        o={row.put}
        side="ask"
        itm={itmPut}
        onClick={row.put && midPrice(row.put) > 0 ? () => onAddLeg(row.put!, expiry, 1) : undefined}
      />
      <td className={`iv ${itmPut ? 'itm' : ''}`}>{iv(row.put)}</td>
      <td className={itmPut ? 'itm' : ''}>{g(pg?.delta)}</td>
      <td className={itmPut ? 'itm' : ''}>{g(pg?.gamma)}</td>
      <td className={itmPut ? 'itm' : ''}>{g(pg?.theta)}</td>
      <td className={itmPut ? 'itm' : ''}>{g(pg?.vega)}</td>
    </tr>
  )
}
